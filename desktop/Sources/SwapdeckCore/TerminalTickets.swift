import CryptoKit
import Foundation
import Security

/// Single-use tickets for `--env`. "Open in Terminal" issues one for the workspace and
/// puts it in the `.command` file Terminal runs; `--env <workspace> --ticket <t>` redeems
/// it once, within `lifetime`, and only for that workspace. Without a valid ticket `--env`
/// asks for Touch ID or the Mac's password instead (in the app), so another program can't
/// quietly read a workspace's tokens through Swapdeck.
///
/// A ticket is 32 random bytes in hex. It is kept in a file named after its SHA-256 (a
/// listing of the folder gives nothing away), mode 0600, in a 0700 folder; redeeming
/// renames the file first, so two processes can't both use it.
public struct TerminalTickets: Sendable {
    public static let lifetime: TimeInterval = 60
    /// Clocks may differ by a moment between the app and the process that redeems.
    private static let skew: TimeInterval = 5

    public let directory: URL
    private let now: @Sendable () -> Date

    public init(directory: URL, now: @escaping @Sendable () -> Date = { Date() }) {
        self.directory = directory
        self.now = now
    }

    /// ~/Library/Application Support/Swapdeck Desktop/tickets
    public static func standard() -> TerminalTickets {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return TerminalTickets(directory: support.appendingPathComponent("Swapdeck Desktop/tickets", isDirectory: true))
    }

    public enum Failure: Error, Equatable {
        case unsafeDirectory
        case randomness
        case write
    }

    /// A new ticket for a workspace, valid for `lifetime` and one use.
    public func issue(workspaceId: String) throws -> String {
        try prepareDirectory()
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw Failure.randomness }
        let ticket = Self.hex(bytes)
        let record: [String: Any] = ["workspace": workspaceId, "issuedAt": now().timeIntervalSince1970]
        let data = try JSONSerialization.data(withJSONObject: record)
        let path = file(for: ticket).path
        let descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw Failure.write }
        let written = data.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress, $0.count) }
        close(descriptor)
        guard written == data.count else {
            unlink(path)
            throw Failure.write
        }
        return ticket
    }

    /// Uses up a ticket: true when it was issued for `workspaceId` less than `lifetime` ago
    /// and nobody used it before. Whatever the answer, the ticket can't be used again.
    public func redeem(_ ticket: String, workspaceId: String) -> Bool {
        guard Self.isWellFormed(ticket) else { return false }
        let claimed = directory.appendingPathComponent(".redeeming-\(UUID().uuidString)")
        guard rename(file(for: ticket).path, claimed.path) == 0 else { return false }
        defer { unlink(claimed.path) }
        var info = stat()
        guard lstat(claimed.path, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid(),
              let record = Self.record(at: claimed), record.workspace == workspaceId
        else { return false }
        return isFresh(record.issuedAt)
    }

    /// Removes tickets that can't be used any more (at launch).
    @discardableResult
    public func purgeExpired() -> Int {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return 0 }
        var removed = 0
        for name in names {
            let url = directory.appendingPathComponent(name)
            let keep = !name.hasPrefix(".") && (Self.record(at: url).map { isFresh($0.issuedAt) } ?? false)
            if !keep, unlink(url.path) == 0 { removed += 1 }
        }
        return removed
    }

    /// 64 lowercase hex digits.
    public static func isWellFormed(_ ticket: String) -> Bool {
        ticket.utf8.count == 64 && ticket.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private func isFresh(_ issuedAt: TimeInterval) -> Bool {
        let age = now().timeIntervalSince1970 - issuedAt
        return age >= -Self.skew && age <= Self.lifetime
    }

    private func file(for ticket: String) -> URL {
        directory.appendingPathComponent(Self.hex(Array(SHA256.hash(data: Data(ticket.utf8)))))
    }

    private static func record(at url: URL) -> (workspace: String, issuedAt: TimeInterval)? {
        guard let data = FileManager.default.contents(atPath: url.path),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let workspace = root["workspace"] as? String,
              let issuedAt = (root["issuedAt"] as? NSNumber)?.doubleValue
        else { return nil }
        return (workspace, issuedAt)
    }

    /// The folder, created 0700 if needed; refuses a symbolic link or someone else's folder.
    private func prepareDirectory() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var info = stat()
        guard lstat(directory.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR, info.st_uid == getuid() else {
            throw Failure.unsafeDirectory
        }
        if info.st_mode & 0o777 != 0o700, chmod(directory.path, 0o700) != 0 { throw Failure.unsafeDirectory }
    }

    private static func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }
}
