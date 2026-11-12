import Foundation

private final class TestCloudTokenStore: CloudTokenStorage {
    var value: String?
    var writes = 0
    var removals = 0
    init(_ value: String?) { self.value = value }
    func read() throws -> String? { value }
    func save(_ value: String) throws { self.value = value; writes += 1 }
    func remove() throws { value = nil; removals += 1 }
}

func runCloudCredentialTests() throws {
    let time = Date(timeIntervalSince1970: 2_000_000_000)
    let original = try CloudCredentials.response(["access_token": "test_access_old", "refresh_token": "test_refresh_old",
                                                  "expires_in": 30, "refresh_token_expires_in": 10000], clientId: "test_client_id", now: time)
    guard original.needsRefresh(now: time), !original.refreshExpired(now: time),
          try CloudCredentials.decode(original.encode()) == original else { throw Store.failure("Cloud expiring credential round trip failed") }
    let legacy = try CloudCredentials.decode("test_legacy_token")
    guard legacy.accessToken == "test_legacy_token", legacy.refreshToken == nil, !legacy.needsRefresh(now: time) else { throw Store.failure("Legacy cloud credential migration failed") }
    for invalid in ([0, -1, true, "28800"] as [Any]) {
        var rejected = false
        do {
            _ = try CloudCredentials.response(["access_token": "test_access", "expires_in": invalid], clientId: "test_client_id", now: time)
        } catch { rejected = true }
        guard rejected else { throw Store.failure("Invalid token lifetime accepted") }
    }
    for missing in ["expires_in", "refresh_token_expires_in"] {
        var response: [String: Any] = ["access_token": "test_access", "refresh_token": "test_refresh", "expires_in": 28800, "refresh_token_expires_in": 15897600]
        response.removeValue(forKey: missing)
        var rejected = false
        do { _ = try CloudCredentials.response(response, clientId: "test_client_id", now: time) }
        catch { rejected = true }
        guard rejected else { throw Store.failure("Refresh token without both lifetimes accepted") }
    }

    func bytes(_ value: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: value) }
    let renewed = bytes(["access_token": "test_access_new", "refresh_token": "test_refresh_new", "expires_in": 28800, "refresh_token_expires_in": 15897600])
    func wait(_ predicate: () -> Bool) throws {
        let deadline = Date().addingTimeInterval(5)
        while !predicate() && Date() < deadline { _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01)) }
        guard predicate() else { throw Store.failure("Cloud test timed out") }
    }
    func result(_ cloud: GitHubCloud, _ action: String) throws -> [String: Any] {
        var response: [String: Any]?
        cloud.handle(["requestId": UUID().uuidString, "action": action]) { response = $0 }
        try wait { response != nil }
        return response!
    }
    func assertAuthenticated(_ response: [String: Any]) throws {
        guard response["error"] == nil, let data = response["data"] as? [String: Any], data["authenticated"] as? Bool == true else {
            throw Store.failure("Cloud refresh did not authenticate")
        }
    }

    let store = TestCloudTokenStore(try original.encode())
    var refreshes = 0
    let cloud = GitHubCloud(store: store, clientId: { "test_client_id" }, now: { time }) { request, complete in
        if request.url?.host == "github.com" {
            refreshes += 1
            let body = String(data: request.httpBody ?? Data(), encoding: .utf8) ?? ""
            guard body.contains("grant_type=refresh_token"), body.contains("refresh_token=test_refresh_old"), !body.contains("client_secret") else {
                complete(.failure(Store.failure("Invalid refresh request"))); return
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) { complete(.success(renewed)) }
        } else { complete(.success(bytes(["login": "octocat"]))) }
    }
    var results: [[String: Any]] = []
    cloud.handle(["requestId": "a", "action": "status"]) { results.append($0) }
    cloud.handle(["requestId": "b", "action": "status"]) { results.append($0) }
    try wait { results.count == 2 }
    try results.forEach(assertAuthenticated)
    let stored = try CloudCredentials.decode(store.value!)
    guard refreshes == 1, stored.accessToken == "test_access_new", stored.refreshToken == "test_refresh_new",
          stored.account == "octocat" else { throw Store.failure("Concurrent refresh rotation was not coalesced") }

    let originalEncoded = try original.encode()
    let offlineStore = TestCloudTokenStore(originalEncoded)
    let offline = GitHubCloud(store: offlineStore, clientId: { "test_client_id" }, now: { time }) { _, complete in
        complete(.failure(URLError(.notConnectedToInternet)))
    }
    let offlineResponse = try result(offline, "status")
    guard offlineResponse["error"] is String, offlineStore.value == originalEncoded, offlineStore.removals == 0 else {
        throw Store.failure("Transient refresh error erased credentials")
    }

    let invalidStore = TestCloudTokenStore(try original.encode())
    let invalid = GitHubCloud(store: invalidStore, clientId: { "test_client_id" }, now: { time }) { request, complete in
        complete(GitHubCloud.responseData(status: 400, url: request.url, data: bytes(["error": "bad_refresh_token"])))
    }
    let expired = try result(invalid, "status")
    guard (expired["data"] as? [String: Any])?["authenticated"] as? Bool == false, invalidStore.value == nil else {
        throw Store.failure("Invalid refresh token did not clear login")
    }
    let errorBody = bytes(["error": "bad_refresh_token"])
    for address in ["https://api.github.com/user", "https://github.com/other", "http://github.com/login/oauth/access_token", "https://other.example/login/oauth/access_token"] {
        if case .success = GitHubCloud.responseData(status: 401, url: URL(string: address), data: errorBody) {
            throw Store.failure("Non-OAuth HTTP error was treated as success")
        }
    }
    if case .success = GitHubCloud.responseData(status: 500, url: URL(string: "https://github.com/login/oauth/access_token"), data: errorBody) {
        throw Store.failure("OAuth server error was treated as success")
    }

    var stillFresh = original
    stillFresh.expiresAt = time.addingTimeInterval(500)
    let retryStore = TestCloudTokenStore(try stillFresh.encode())
    var retries = 0
    let retry = GitHubCloud(store: retryStore, clientId: { "test_client_id" }, now: { time }) { request, complete in
        if request.url?.host == "github.com" { retries += 1; complete(.success(renewed)) }
        else if request.value(forHTTPHeaderField: "Authorization") == "Bearer test_access_old" {
            complete(.failure(CloudFailure("Unauthorized", status: 401)))
        } else { complete(.success(bytes(["login": "octocat"]))) }
    }
    try assertAuthenticated(result(retry, "status"))
    guard retries == 1 else { throw Store.failure("401 refresh retried more than once") }

    var owned = original
    owned.account = "octocat"
    let differentStore = TestCloudTokenStore(try owned.encode())
    let different = GitHubCloud(store: differentStore, clientId: { "test_client_id" }, now: { time }) { request, complete in
        complete(.success(request.url?.host == "github.com" ? renewed : bytes(["login": "another-user"])))
    }
    let changedAccount = try result(different, "status")
    guard (changedAccount["data"] as? [String: Any])?["authenticated"] as? Bool == false, differentStore.value == nil else {
        throw Store.failure("Refreshed token changed the linked account")
    }

    let verificationStore = TestCloudTokenStore(try original.encode())
    let verificationOffline = GitHubCloud(store: verificationStore, clientId: { "test_client_id" }, now: { time }) { request, complete in
        if request.url?.host == "github.com" { complete(.success(renewed)) }
        else { complete(.failure(URLError(.notConnectedToInternet))) }
    }
    let verificationResponse = try result(verificationOffline, "status")
    guard verificationResponse["error"] is String,
          try CloudCredentials.decode(verificationStore.value!).refreshToken == "test_refresh_new" else {
        throw Store.failure("Identity network failure lost rotated refresh token")
    }

    let logoutStore = TestCloudTokenStore(try original.encode())
    var delayed: ((Result<Data, Error>) -> Void)?
    let logoutCloud = GitHubCloud(store: logoutStore, clientId: { "test_client_id" }, now: { time }) { request, complete in
        if request.url?.host == "github.com" { DispatchQueue.main.async { delayed = complete } }
        else { complete(.success(bytes(["login": "octocat"]))) }
    }
    var oldResponse: [String: Any]?
    logoutCloud.handle(["requestId": "pending", "action": "status"]) { oldResponse = $0 }
    try wait { delayed != nil }
    _ = try result(logoutCloud, "logout")
    delayed?(.success(renewed))
    _ = try result(logoutCloud, "status")
    try wait { oldResponse != nil }
    guard logoutStore.value == nil, logoutStore.writes == 0 else { throw Store.failure("Late refresh restored logged-out credentials") }
    let cancelStore = TestCloudTokenStore(originalEncoded)
    var cancelledRefresh: ((Result<Data, Error>) -> Void)?
    let cancelCloud = GitHubCloud(store: cancelStore, clientId: { "test_client_id" }, now: { time }) { _, complete in
        DispatchQueue.main.async { cancelledRefresh = complete }
    }
    var cancelledResponse: [String: Any]?
    cancelCloud.handle(["requestId": "cancelled", "action": "status"]) { cancelledResponse = $0 }
    try wait { cancelledRefresh != nil }
    _ = try result(cancelCloud, "cancelLogin")
    cancelledRefresh?(.success(renewed))
    _ = try result(cancelCloud, "cancelLogin")
    try wait { cancelledResponse != nil }
    guard cancelStore.value == originalEncoded, cancelStore.writes == 0 else { throw Store.failure("Late refresh changed cancelled authentication") }
    print("PASS macOS cloud: legacy tokens, expiry, rotation, concurrent refresh, offline, invalid refresh, 401, account identity, logout and cancellation")
}
