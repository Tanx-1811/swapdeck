import Foundation
import Security

/// Secret values in the login keychain: generic passwords of the service
/// "Swapdeck Desktop CLI", one per workspace and variable ("<workspace>/<NAME>").
/// Only this app (the same signed binary) reads them without asking; its `--env`
/// hands them out only with a single-use ticket or after Touch ID / the Mac's
/// password (see `TerminalTickets`).
public struct KeychainSecretStore: SecretStore {
    public static let service = "Swapdeck Desktop CLI"

    public init() {}

    private func query(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: account,
        ]
    }

    public func value(workspace: String, name: String) throws -> String? {
        var query = query(account: "\(workspace)/\(name)")
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        guard let data = result as? Data, let text = String(data: data, encoding: .utf8) else {
            throw KeychainError(status: errSecDecode)
        }
        return text
    }

    public func set(_ value: String?, workspace: String, name: String) throws {
        let query = query(account: "\(workspace)/\(name)")
        guard let value, !value.isEmpty else {
            try delete(query)
            return
        }
        let data = Data(value.utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrLabel as String] = "Swapdeck Desktop: \(name)"
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw KeychainError(status: added) }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
    }

    public func removeAll(workspace: String) throws {
        let prefix = "\(workspace)/"
        for account in try accounts() where account.hasPrefix(prefix) {
            try delete(query(account: account))
        }
    }

    public func workspaceIds() throws -> Set<String> {
        Set(try accounts().compactMap { account in
            account.split(separator: "/", maxSplits: 1).first.map(String.init)
        })
    }

    /// Every account of the service (attributes only: reading them never asks for permission).
    private func accounts() throws -> [String] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        let items = result as? [[String: Any]] ?? []
        return items.compactMap { $0[kSecAttrAccount as String] as? String }
    }

    private func delete(_ query: [String: Any]) throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}

public struct KeychainError: Error, Equatable, CustomStringConvertible {
    public let status: OSStatus

    public init(status: OSStatus) {
        self.status = status
    }

    public var description: String {
        let message = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus"
        return "\(message) (\(status))"
    }
}
