import Foundation
import Security

/// Secret values in the login keychain: generic passwords of the service
/// "Swapdeck Desktop CLI", one per workspace and variable ("<workspace>/<NAME>").
/// Only this app (the same signed binary) reads them without asking.
public struct KeychainSecretStore: SecretStore {
    public static let service = "Swapdeck Desktop CLI"

    public init() {}

    private func query(workspace: String, name: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: "\(workspace)/\(name)",
        ]
    }

    public func value(workspace: String, name: String) -> String? {
        var query = query(workspace: workspace, name: name)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    public func set(_ value: String?, workspace: String, name: String) throws {
        let query = query(workspace: workspace, name: name)
        guard let value, !value.isEmpty else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
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

    public func removeAll(workspace: String, names: [String]) throws {
        for name in names { try set(nil, workspace: workspace, name: name) }
    }
}

public struct KeychainError: Error, Equatable {
    public let status: OSStatus
}
