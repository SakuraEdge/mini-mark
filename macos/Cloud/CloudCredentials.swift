import Foundation
import CoreFoundation

protocol CloudTokenStorage {
    func read() throws -> String?
    func save(_ value: String) throws
    func remove() throws
}

struct CloudCredentials: Codable, Equatable {
    var accessToken: String
    var refreshToken: String?
    var expiresAt: Date?
    var refreshExpiresAt: Date?
    var clientId: String?
    var account: String?

    static func decode(_ value: String) throws -> CloudCredentials {
        if value.first == "{" {
            let result = try JSONDecoder().decode(CloudCredentials.self, from: Data(value.utf8))
            guard validToken(result.accessToken), result.refreshToken.map(validToken) ?? true else { throw failure() }
            return result
        }
        guard validToken(value) else { throw failure() }
        return CloudCredentials(accessToken: value)
    }
    func encode() throws -> String {
        guard let value = String(data: try JSONEncoder().encode(self), encoding: .utf8) else { throw Self.failure() }
        return value
    }
    static func response(_ json: [String: Any], clientId: String, now: Date = Date()) throws -> CloudCredentials {
        guard let access = json["access_token"] as? String, validToken(access) else { throw failure() }
        if let type = json["token_type"] as? String, type.lowercased() != "bearer" { throw failure() }
        let refresh = json["refresh_token"] as? String
        if let refresh = refresh, !validToken(refresh) { throw failure() }
        let expiresAt = try expiration(json["expires_in"], now: now)
        let refreshExpiresAt = try expiration(json["refresh_token_expires_in"], now: now)
        if refresh != nil, expiresAt == nil || refreshExpiresAt == nil { throw failure() }
        return CloudCredentials(accessToken: access, refreshToken: refresh,
                                expiresAt: expiresAt, refreshExpiresAt: refreshExpiresAt, clientId: clientId)
    }
    func needsRefresh(now: Date = Date()) -> Bool {
        guard refreshToken != nil, let expiresAt = expiresAt else { return false }
        return expiresAt <= now.addingTimeInterval(60)
    }
    func refreshExpired(now: Date = Date()) -> Bool { refreshExpiresAt.map { $0 <= now } ?? false }
    private static func validToken(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 8192 && !value.unicodeScalars.contains { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }
    }
    private static func expiration(_ value: Any?, now: Date) throws -> Date? {
        guard let value = value else { return nil }
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { throw failure() }
        let seconds = number.doubleValue
        guard seconds.isFinite, seconds > 0, seconds.rounded() == seconds, seconds <= 366 * 24 * 60 * 60 else { throw failure() }
        return now.addingTimeInterval(seconds)
    }
    private static func failure() -> Error { Store.failure("GitHub 登录凭据无效，请重新登录。") }
}
