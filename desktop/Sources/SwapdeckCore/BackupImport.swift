import CommonCrypto
import CryptoKit
import Foundation

/// A workspace taken from a Swapdeck extension backup: its name, look and pages.
/// Saved sign-ins in the backup are never read into Swapdeck Desktop.
public struct ImportedWorkspace: Hashable, Sendable {
    public let name: String
    public let color: String
    public let symbol: String
    public let note: String
    public let links: [WorkspaceLink]
}

/// Reads the workspaces of a Swapdeck extension backup (`swapdeck-backup`,
/// version 1), plain or password-protected (PBKDF2-SHA-256 + AES-256-GCM).
public enum BackupImport {
    public enum Failure: Error, Equatable {
        case notABackup
        case needsPassword
        case wrongPassword
    }

    public static func isEncrypted(_ data: Data) throws -> Bool {
        try envelope(data).encrypted
    }

    public static func workspaces(from data: Data, password: String? = nil) throws -> [ImportedWorkspace] {
        let (encrypted, payload) = try envelope(data)
        let content: [String: Any]
        if encrypted {
            guard let password, !password.isEmpty else { throw Failure.needsPassword }
            guard let box = payload as? [String: Any] else { throw Failure.notABackup }
            let plain = try decrypt(box, password: password)
            guard let object = try? JSONSerialization.jsonObject(with: plain) as? [String: Any] else {
                throw Failure.notABackup
            }
            content = object
        } else {
            guard let object = payload as? [String: Any] else { throw Failure.notABackup }
            content = object
        }
        return (content["workspaces"] as? [Any] ?? []).compactMap(workspace)
    }

    private static func envelope(_ data: Data) throws -> (encrypted: Bool, payload: Any?) {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              root["format"] as? String == "swapdeck-backup",
              (root["version"] as? NSNumber)?.intValue == 1
        else { throw Failure.notABackup }
        return ((root["encrypted"] as? Bool) == true, root["payload"])
    }

    private static func workspace(_ value: Any) -> ImportedWorkspace? {
        guard let input = value as? [String: Any],
              let name = (input["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !name.isEmpty, name.count <= 80
        else { return nil }
        let color = (input["color"] as? String).flatMap { Palette.isHex($0) ? $0.lowercased() : nil } ?? Palette.pigments[0].hex
        let symbol = (input["icon"] as? String).flatMap { Symbols.isKnown($0) ? $0 : nil } ?? ""
        let note = (input["note"] as? String).map { String($0.prefix(500)) } ?? ""
        let links = (input["links"] as? [Any] ?? []).prefix(50).compactMap(DataFile.sanitizeLink)
        return ImportedWorkspace(name: name, color: color, symbol: symbol, note: note, links: Array(links))
    }

    static func decrypt(_ box: [String: Any], password: String) throws -> Data {
        guard box["kdf"] as? String == "PBKDF2-SHA-256",
              let iterations = (box["iterations"] as? NSNumber)?.intValue,
              (100_000...10_000_000).contains(iterations),
              let salt = (box["salt"] as? String).flatMap({ Data(base64Encoded: $0) }), !salt.isEmpty,
              let iv = (box["iv"] as? String).flatMap({ Data(base64Encoded: $0) }), iv.count == 12,
              let sealed = (box["data"] as? String).flatMap({ Data(base64Encoded: $0) }), sealed.count > 16
        else { throw Failure.notABackup }
        let key = try deriveKey(password: password, salt: salt, iterations: iterations)
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: iv),
                ciphertext: sealed.dropLast(16),
                tag: sealed.suffix(16)
            )
            return try AES.GCM.open(box, using: key)
        } catch {
            throw Failure.wrongPassword
        }
    }

    /// PBKDF2-SHA-256 → a 256-bit key, from the NFC form of the password (as the extension does).
    static func deriveKey(password: String, salt: Data, iterations: Int) throws -> SymmetricKey {
        let passwordBytes = Array(password.precomposedStringWithCanonicalMapping.utf8)
        guard !passwordBytes.isEmpty else { throw Failure.wrongPassword }
        var derived = [UInt8](repeating: 0, count: 32)
        let status = passwordBytes.withUnsafeBufferPointer { passwordBuffer in
            salt.withUnsafeBytes { saltBuffer in
                passwordBuffer.baseAddress!.withMemoryRebound(to: CChar.self, capacity: passwordBytes.count) { passwordPointer in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passwordPointer,
                        passwordBytes.count,
                        saltBuffer.bindMemory(to: UInt8.self).baseAddress,
                        salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        UInt32(iterations),
                        &derived,
                        derived.count
                    )
                }
            }
        }
        guard status == kCCSuccess else { throw Failure.notABackup }
        return SymmetricKey(data: derived)
    }
}
