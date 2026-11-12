import Foundation
import Security

private struct CloudFailure: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
    init(_ message: String, status: Int = 0) { self.message = message; self.status = status }
}

private final class CloudTokenStore {
    private var query: [String: Any] {
        let suffix = ProcessInfo.processInfo.environment["MOYE_DATA_DIR"].map { "." + Store.hash(Data($0.utf8)) } ?? ""
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "MiniMark.GitHubCloud",
                kSecAttrAccount as String: "github.com" + suffix]
    }
    func read() throws -> String? {
        var query = self.query
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
            throw CloudFailure("无法读取 GitHub 登录凭据，请检查钥匙串权限。")
        }
        return token
    }
    func save(_ token: String) throws {
        let attributes = [kSecValueData as String: Data(token.utf8)]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = Data(token.utf8)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            item[kSecAttrSynchronizable as String] = false
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw CloudFailure("无法保存 GitHub 登录凭据，请检查钥匙串权限。") }
    }
    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CloudFailure("无法清除 GitHub 登录凭据，请检查钥匙串权限。") }
    }
}

final class GitHubCloud: NSObject, URLSessionDataDelegate {
    private struct DeviceLogin {
        let clientId: String
        let code: String
        let expires: Date
        var interval: Int
        var nextPoll: Date
        var polling = false
    }
    private struct PendingRequest {
        let task: URLSessionDataTask
        let completion: (Result<Data, Error>) -> Void
        var data = Data()
        var response: HTTPURLResponse?
        var error: Error?
    }
    private let queue = DispatchQueue(label: "MiniMark.GitHubCloud")
    private let store = CloudTokenStore()
    private let maximumFileSize = 5 * 1024 * 1024
    private let maximumResponseSize = 8 * 1024 * 1024
    private let supportedExtensions = ["md", "markdown", "mdown", "txt", "yaml", "yml", "html", "htm"]
    private var requests: [Int: PendingRequest] = [:]
    private var token: String?
    private var credentialsLoaded = false
    private var login: String?
    private var verifiedAt = Date.distantPast
    private var device: DeviceLogin?
    private var generation = 0
    private lazy var network: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 45
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    func handle(_ body: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        guard let requestId = body["requestId"] as? String, !requestId.isEmpty, requestId.count <= 128 else { return }
        queue.async {
            let finish: (Result<Any, Error>) -> Void = { result in
                var response: [String: Any] = ["type": "cloudResponse", "requestId": requestId]
                switch result {
                case .success(let value): response["data"] = value
                case .failure(let error): response["error"] = error.localizedDescription
                }
                DispatchQueue.main.async { completion(response) }
            }
            do { try self.perform(body, finish) }
            catch { finish(.failure(error)) }
        }
    }

    private var clientId: String? {
        let configured: String?
        if let environment = ProcessInfo.processInfo.environment["MINIMARK_GITHUB_CLIENT_ID"] { configured = environment }
        else if let file = Bundle.main.resourceURL?.appendingPathComponent("wwwroot/github-oauth.json"),
                let data = try? Data(contentsOf: file),
                let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { configured = value["clientId"] as? String }
        else { configured = nil }
        guard let value = configured?.trimmingCharacters(in: .whitespacesAndNewlines),
              value.range(of: "^[A-Za-z0-9_.-]{8,100}$", options: .regularExpression) != nil else { return nil }
        return value
    }

    private func perform(_ body: [String: Any], _ finish: @escaping (Result<Any, Error>) -> Void) throws {
        guard let action = body["action"] as? String else { throw CloudFailure("云文档请求无效。") }
        switch action {
        case "logout":
            generation += 1; device = nil; token = nil; login = nil; verifiedAt = .distantPast
            requests.values.forEach { $0.task.cancel() }
            credentialsLoaded = false
            try store.remove()
            credentialsLoaded = true
            finish(.success(["authenticated": false, "configured": clientId != nil]))
        case "cancelLogin":
            generation += 1; device = nil
            finish(.success(["cancelled": true]))
        case "startLogin": try startLogin(finish)
        case "pollLogin": pollLogin(finish)
        case "status":
            try loadCredentials()
            guard token != nil else { finish(.success(["authenticated": false, "configured": clientId != nil])); return }
            verifiedAt = .distantPast
            authenticate { result in
                switch result {
                case .success(let owner): finish(.success(["authenticated": true, "configured": self.clientId != nil, "login": owner]))
                case .failure(let error):
                    if (error as? CloudFailure)?.status == 401 { finish(.success(["authenticated": false, "configured": self.clientId != nil])) }
                    else { finish(.failure(error)) }
                }
            }
        case "repository", "createRepository", "list", "read", "write", "folder":
            try loadCredentials()
            authenticate { result in
                do {
                    let owner = try result.get()
                    if let expected = body["owner"] as? String, expected.caseInsensitiveCompare(owner) != .orderedSame {
                        throw CloudFailure("当前 GitHub 账号与文档所属账号不同，请切换账号后重试。")
                    }
                    try self.repositoryAction(action, owner: owner, body: body, finish: finish)
                } catch { finish(.failure(error)) }
            }
        default: throw CloudFailure("不支持的云文档操作。")
        }
    }

    private func loadCredentials() throws {
        if !credentialsLoaded { token = try store.read(); credentialsLoaded = true }
    }

    private func startLogin(_ finish: @escaping (Result<Any, Error>) -> Void) throws {
        guard let clientId = clientId else { throw CloudFailure("当前版本尚未配置 GitHub 登录，请联系 Mini Mark 发布者。") }
        generation += 1; device = nil
        let epoch = generation
        oauth("device/code", fields: ["client_id": clientId, "scope": "repo"]) { result in
            do {
                guard epoch == self.generation else { throw CloudFailure("登录已取消。") }
                let json = try result.get()
                guard let code = json["device_code"] as? String, !code.isEmpty, code.count <= 1024,
                      let userCode = json["user_code"] as? String, userCode.count <= 32,
                      userCode.range(of: "^[A-Za-z0-9-]+$", options: .regularExpression) != nil,
                      let uri = json["verification_uri"] as? String, uri == "https://github.com/login/device",
                      let expires = json["expires_in"] as? Int, (1...3600).contains(expires) else {
                    throw CloudFailure("GitHub 登录暂不可用，请确认 OAuth 应用已开启 Device Flow。")
                }
                let interval = max(5, min(json["interval"] as? Int ?? 5, 60))
                self.device = DeviceLogin(clientId: clientId, code: code, expires: Date().addingTimeInterval(TimeInterval(expires)),
                                          interval: interval, nextPoll: Date().addingTimeInterval(TimeInterval(interval)))
                finish(.success(["userCode": userCode, "verificationUri": uri, "interval": interval, "expiresIn": expires]))
            } catch { finish(.failure(error)) }
        }
    }

    private func pollLogin(_ finish: @escaping (Result<Any, Error>) -> Void) {
        guard var current = device else { finish(.failure(CloudFailure("请先发起 GitHub 登录。"))); return }
        if current.expires <= Date() { device = nil; finish(.failure(CloudFailure("登录授权码已过期，请重新登录。"))); return }
        if current.polling || current.nextPoll > Date() { finish(.success(["pending": true, "interval": current.interval])); return }
        current.polling = true; device = current
        let epoch = generation
        oauth("oauth/access_token", fields: ["client_id": current.clientId, "device_code": current.code,
                                            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"]) { result in
            do {
                guard epoch == self.generation else { throw CloudFailure("登录已取消。") }
                let json = try result.get()
                if let code = json["error"] as? String {
                    switch code {
                    case "authorization_pending", "slow_down":
                        if code == "slow_down" { self.device?.interval += 5 }
                        let interval = self.device?.interval ?? 5
                        self.device?.nextPoll = Date().addingTimeInterval(TimeInterval(interval))
                        self.device?.polling = false
                        finish(.success(["pending": true, "interval": interval])); return
                    case "access_denied": throw CloudFailure("GitHub 授权已取消。")
                    case "expired_token": throw CloudFailure("登录授权码已过期，请重新登录。")
                    default: throw CloudFailure("GitHub 登录未完成，请重新登录。")
                    }
                }
                guard let accessToken = json["access_token"] as? String, !accessToken.isEmpty, accessToken.count <= 8192 else {
                    throw CloudFailure("GitHub 未返回有效登录凭据。")
                }
                self.verify(accessToken, epoch: epoch) { verified in
                    do {
                        let owner = try verified.get()
                        guard epoch == self.generation else { throw CloudFailure("登录已取消。") }
                        try self.store.save(accessToken)
                        self.token = accessToken; self.credentialsLoaded = true; self.login = owner; self.verifiedAt = Date(); self.device = nil
                        finish(.success(["authenticated": true, "login": owner, "configured": self.clientId != nil]))
                    } catch {
                        if epoch == self.generation { self.device = nil }
                        finish(.failure(error))
                    }
                }
            } catch {
                if epoch == self.generation {
                    if (error as? CloudFailure)?.status == -1 {
                        let interval = self.device?.interval ?? 5
                        self.device?.polling = false
                        self.device?.nextPoll = Date().addingTimeInterval(TimeInterval(interval))
                    } else { self.device = nil }
                }
                finish(.failure(error))
            }
        }
    }

    private func authenticate(_ completion: @escaping (Result<String, Error>) -> Void) {
        guard let token = token else { completion(.failure(CloudFailure("请先登录 GitHub。", status: 401))); return }
        if let login = login, Date().timeIntervalSince(verifiedAt) < 60 { completion(.success(login)); return }
        let epoch = generation
        verify(token, epoch: epoch) { result in
            if epoch == self.generation {
                switch result {
                case .success(let owner): self.login = owner; self.verifiedAt = Date()
                case .failure(let error):
                    if (error as? CloudFailure)?.status == 401 {
                        self.token = nil; self.login = nil; self.verifiedAt = .distantPast
                        try? self.store.remove()
                    }
                }
            }
            completion(result)
        }
    }

    private func verify(_ token: String, epoch: Int, completion: @escaping (Result<String, Error>) -> Void) {
        api("user", token: token) { result in
            do {
                guard epoch == self.generation else { throw CloudFailure("账号连接已更改，请重试。") }
                guard let user = try result.get() as? [String: Any], let login = user["login"] as? String,
                      login.range(of: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$", options: .regularExpression) != nil else {
                    throw CloudFailure("无法确认 GitHub 账号。")
                }
                completion(.success(login))
            } catch { completion(.failure(error)) }
        }
    }

    private func repositoryAction(_ action: String, owner: String, body: [String: Any], finish: @escaping (Result<Any, Error>) -> Void) throws {
        guard let token = token else { throw CloudFailure("请先登录 GitHub。", status: 401) }
        let prefix = "repos/\(owner)/MiniMarkDisk"
        let epoch = generation
        let complete: (Result<Any, Error>) -> Void = { result in
            guard epoch == self.generation else { finish(.failure(CloudFailure("账号连接已更改，请重新检查云端文件。"))); return }
            finish(result)
        }
        switch action {
        case "repository", "createRepository":
            let receive: (Result<Any, Error>) -> Void = { result in
                do {
                    guard let repository = try result.get() as? [String: Any],
                          let branch = repository["default_branch"] as? String,
                          let isPrivate = repository["private"] as? Bool else { throw CloudFailure("仓库信息无效。") }
                    complete(.success(["exists": true, "owner": owner, "defaultBranch": branch, "private": isPrivate]))
                } catch {
                    if action == "repository" && (error as? CloudFailure)?.status == 404 { complete(.success(["exists": false, "owner": owner])) }
                    else { complete(.failure(error)) }
                }
            }
            if action == "repository" { api(prefix, token: token, completion: receive) }
            else { api("user/repos", method: "POST", token: token, json: ["name": "MiniMarkDisk", "private": true, "auto_init": true, "description": "Mini Mark documents"], completion: receive) }
        case "list":
            let path = try checkedPath(body["path"] as? String ?? "", allowRoot: true)
            api(prefix + "/contents" + (path.isEmpty ? "" : "/" + encodedPath(path)), token: token) { result in
                do {
                    guard let entries = try result.get() as? [[String: Any]] else { throw CloudFailure("该路径不是文件夹。") }
                    let items: [[String: Any]] = entries.compactMap { item in
                        guard let name = item["name"] as? String, let itemPath = item["path"] as? String,
                              let type = item["type"] as? String, ["dir", "file"].contains(type), name != ".gitkeep",
                              (try? self.checkedPath(itemPath)) != nil,
                              type == "dir" || self.isDocument(itemPath) else { return nil }
                        return ["name": name, "path": itemPath, "type": type, "sha": item["sha"] as? String ?? "", "size": item["size"] as? Int ?? 0]
                    }
                    complete(.success(["entries": items, "path": path]))
                } catch {
                    if path.isEmpty && (error as? CloudFailure)?.status == 404 {
                        guard epoch == self.generation else { complete(.failure(CloudFailure("账号连接已更改，请重试。"))); return }
                        self.api(prefix, token: token) { repository in
                            do {
                                guard let repo = try repository.get() as? [String: Any],
                                      repo["name"] as? String == "MiniMarkDisk" else { throw CloudFailure("仓库信息无效。") }
                                complete(.success(["entries": [[String: Any]](), "path": path]))
                            } catch { complete(.failure(error)) }
                        }
                    } else { complete(.failure(error)) }
                }
            }
        case "read":
            let path = try checkedPath(body["path"] as? String ?? "")
            guard isDocument(path) else { throw CloudFailure("该文件类型不支持编辑。") }
            api(prefix + "/contents/" + encodedPath(path), token: token, accept: "application/vnd.github.object+json") { result in
                do {
                    guard epoch == self.generation else { throw CloudFailure("账号连接已更改，请重试。") }
                    guard let item = try result.get() as? [String: Any], item["type"] as? String == "file",
                          item["target"] == nil, item["submodule_git_url"] == nil,
                          let sha = item["sha"] as? String, self.validSha(sha),
                          let size = item["size"] as? Int, (0...self.maximumFileSize).contains(size) else {
                        throw CloudFailure("文件无法读取，或超过 5 MB。")
                    }
                    // Pin the blob to the metadata SHA so a concurrent edit cannot pair new text with an old SHA.
                    self.api(prefix + "/git/blobs/" + sha, token: token) { blobResult in
                        do {
                            guard let blob = try blobResult.get() as? [String: Any], blob["encoding"] as? String == "base64",
                                  blob["sha"] as? String == sha, let content = blob["content"] as? String,
                                  let bytes = Data(base64Encoded: content.filter { !$0.isWhitespace }), bytes.count <= self.maximumFileSize,
                                  let text = String(data: bytes, encoding: .utf8), !text.contains("\0") else {
                                throw CloudFailure("文件不是有效的 UTF-8 文本，或超过 5 MB。")
                            }
                            complete(.success(["path": path, "sha": sha, "text": text]))
                        } catch { complete(.failure(error)) }
                    }
                } catch { complete(.failure(error)) }
            }
        case "write", "folder":
            let path = try checkedPath(body["path"] as? String ?? "")
            if action == "write" && !isDocument(path) { throw CloudFailure("该文件类型不支持保存到云文档。") }
            guard action == "folder" || body["text"] is String else { throw CloudFailure("文档内容缺失。") }
            let text = action == "folder" ? "" : body["text"] as! String
            let bytes = Data(text.utf8)
            guard bytes.count <= maximumFileSize, !text.contains("\0") else { throw CloudFailure("文档内容无效，或超过 5 MB。") }
            let target = action == "folder" ? path + "/.gitkeep" : path
            var payload: [String: Any] = ["message": action == "folder" ? "Create folder \(path) via Mini Mark" : "Update \(path) via Mini Mark",
                                          "content": bytes.base64EncodedString()]
            if let sha = body["sha"] as? String, !sha.isEmpty {
                guard action == "write", validSha(sha) else { throw CloudFailure("云文档版本无效，请重新打开。") }
                payload["sha"] = sha
            }
            api(prefix + "/contents/" + encodedPath(target), method: "PUT", token: token, json: payload) { result in
                do {
                    guard let result = try result.get() as? [String: Any], let content = result["content"] as? [String: Any],
                          let sha = content["sha"] as? String, self.validSha(sha) else { throw CloudFailure("无法确认云端保存结果，请刷新后检查。") }
                    complete(.success(["path": path, "sha": sha]))
                } catch { complete(.failure(error)) }
            }
        default: throw CloudFailure("不支持的云文档操作。")
        }
    }

    private func checkedPath(_ path: String, allowRoot: Bool = false) throws -> String {
        if allowRoot && path.isEmpty { return path }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !path.isEmpty, path.utf8.count <= 1024, !path.contains("\\"), !path.contains(":"),
              !path.contains("?"), !path.contains("#"),
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && $0.lowercased() != ".git" }) else {
            throw CloudFailure("文件路径无效。")
        }
        return path
    }
    private func encodedPath(_ path: String) -> String {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return path.split(separator: "/").map { String($0).addingPercentEncoding(withAllowedCharacters: allowed)! }.joined(separator: "/")
    }
    private func isDocument(_ path: String) -> Bool { supportedExtensions.contains((path as NSString).pathExtension.lowercased()) }
    private func validSha(_ sha: String) -> Bool { sha.range(of: "^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$", options: .regularExpression) != nil }

    private func oauth(_ path: String, fields: [String: String], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        var request = URLRequest(url: URL(string: "https://github.com/login/" + path)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var query = URLComponents()
        query.queryItems = fields.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        request.httpBody = Data((query.percentEncodedQuery ?? "").utf8)
        requestData(request) { result in
            do {
                guard let json = try JSONSerialization.jsonObject(with: result.get()) as? [String: Any] else { throw CloudFailure("GitHub 登录响应无效。") }
                completion(.success(json))
            } catch { completion(.failure(error is CloudFailure ? error : CloudFailure("GitHub 登录响应无效。"))) }
        }
    }
    private func api(_ path: String, method: String = "GET", token: String, json: [String: Any]? = nil,
                     accept: String = "application/vnd.github+json", completion: @escaping (Result<Any, Error>) -> Void) {
        var request = URLRequest(url: URL(string: "https://api.github.com/" + path)!)
        request.httpMethod = method
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue(accept, forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        if let json = json {
            do { request.httpBody = try JSONSerialization.data(withJSONObject: json) }
            catch { completion(.failure(CloudFailure("云文档请求无效。"))); return }
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        requestData(request) { result in
            do { completion(.success(try JSONSerialization.jsonObject(with: result.get()))) }
            catch {
                if (error as? CloudFailure)?.status == 401, self.token == token {
                    self.token = nil; self.login = nil; self.verifiedAt = .distantPast
                    try? self.store.remove()
                }
                completion(.failure(error is CloudFailure ? error : CloudFailure("GitHub 返回了无法识别的数据。")))
            }
        }
    }
    private func requestData(_ request: URLRequest, completion: @escaping (Result<Data, Error>) -> Void) {
        var request = request
        request.timeoutInterval = 30
        request.setValue("MiniMark-Cloud/1.0", forHTTPHeaderField: "User-Agent")
        let task = network.dataTask(with: request)
        requests[task.taskIdentifier] = PendingRequest(task: task, completion: completion)
        task.resume()
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        queue.async {
            guard var pending = self.requests[dataTask.taskIdentifier], let http = response as? HTTPURLResponse else { completionHandler(.cancel); return }
            pending.response = http
            if response.expectedContentLength > Int64(self.maximumResponseSize) {
                pending.error = CloudFailure("云端响应超过大小限制。")
                self.requests[dataTask.taskIdentifier] = pending
                completionHandler(.cancel)
            } else {
                self.requests[dataTask.taskIdentifier] = pending
                completionHandler(.allow)
            }
        }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        queue.async {
            guard var pending = self.requests[dataTask.taskIdentifier] else { return }
            if pending.data.count + data.count > self.maximumResponseSize {
                pending.error = CloudFailure("云端响应超过大小限制。"); pending.task.cancel()
            } else { pending.data.append(data) }
            self.requests[dataTask.taskIdentifier] = pending
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        queue.async {
            guard let pending = self.requests.removeValue(forKey: task.taskIdentifier) else { return }
            if let error = pending.error { pending.completion(.failure(error)); return }
            if error != nil { pending.completion(.failure(CloudFailure("无法连接 GitHub，请检查网络后重试。", status: -1))); return }
            guard let status = pending.response?.statusCode else { pending.completion(.failure(CloudFailure("GitHub 响应无效。"))); return }
            guard (200..<300).contains(status) else {
                let message: String
                switch status {
                case 401: message = "GitHub 登录已失效，请重新登录。"
                case 403, 429: message = "GitHub 拒绝了请求，可能是权限不足或请求过于频繁，请检查授权后重试。"
                case 404: message = "云端文件或仓库不存在，或当前账号没有访问权限。"
                case 409, 422: message = "云端内容已变化或同名文件已存在。请重新打开云端文件，或换一个文件名保存。"
                default: message = "GitHub 暂时无法完成请求，请稍后重试。"
                }
                pending.completion(.failure(CloudFailure(message, status: status))); return
            }
            pending.completion(.success(pending.data))
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
