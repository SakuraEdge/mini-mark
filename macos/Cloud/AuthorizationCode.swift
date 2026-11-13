import AppKit

enum AuthorizationCode {
    static func matches(_ requested: String, current: String?, expires: Date?, now: Date) -> Bool {
        guard let current = current, let expires = expires, expires > now, requested == current else { return false }
        return requested.range(of: #"\A[A-Z0-9]{4}-[A-Z0-9]{4}\z"#, options: .regularExpression) != nil
    }
    static func copy(_ code: String) throws {
        precondition(Thread.isMainThread)
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(code, forType: .string) else { throw CloudFailure("授权码复制失败，请重试。") }
    }
}
