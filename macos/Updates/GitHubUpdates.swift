import Foundation

struct UpdateAsset: Codable { let url: String; let sha256: String; let size: Int }
struct UpdateManifest: Codable {
    let schemaVersion: Int
    let version: String
    let windows: UpdateAsset
    let windowsV2: UpdateAsset?
    let releaseVersion: String?
    let tag: String?
    private static func validVersion(_ value: String) -> Bool {
        let pattern = #"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z"#
        let numbers = value.components(separatedBy: ".").compactMap(Int.init)
        return value.range(of: pattern, options: .regularExpression) != nil &&
            numbers.count == 3 && numbers.allSatisfy { $0 <= Int32.max }
    }
    func validate() throws {
        guard Self.validVersion(version), windows.size > 0, windows.size <= 256 * 1024 * 1024,
              windows.sha256.range(of: #"\A[a-fA-F0-9]{64}\z"#, options: .regularExpression) != nil else { throw Store.failure("更新清单无效。") }
        switch schemaVersion {
        case 1:
            guard ["https://github.com/SakuraEdge/moye-markdown/releases/download/v\(version)/Moye-Setup-\(version)-windows-x64.exe",
                   "https://github.com/SakuraEdge/mini-mark/releases/download/v\(version)/MiniMark-Setup-\(version)-windows-x64.exe"].contains(windows.url) else {
                throw Store.failure("更新清单无效。")
            }
        case 2:
            guard windowsV2 == nil, let releaseVersion = releaseVersion, Self.validVersion(releaseVersion), tag == "rev-v\(releaseVersion)",
                  windows.url == "https://github.com/SakuraEdge/mini-mark/releases/download/rev-v\(releaseVersion)/MiniMark-Rev-\(releaseVersion)-Setup-windows-x64.exe" else {
                throw Store.failure("更新清单无效。")
            }
        default: throw Store.failure("更新清单版本不受支持。")
        }
    }
    var release: [String: Any] {
        var result: [String: Any] = ["tag_name": "v" + version, "version": version, "draft": false, "prerelease": false]
        if schemaVersion == 2, let releaseVersion = releaseVersion, let tag = tag {
            result["tag_name"] = tag
            result["releaseVersion"] = releaseVersion
            result["name"] = "Mini Mark Rev v" + releaseVersion
        }
        return result
    }
}
struct CachedUpdate: Codable { let manifest: UpdateManifest; let checkedAt: Date }
struct UpdateCheck {
    let cached: CachedUpdate
    let offline: Bool
    var releases: [[String: Any]] { [cached.manifest.release] }
    var cacheNotice: String? {
        guard offline else { return nil }
        let formatter = DateFormatter(); formatter.dateFormat = "MM-dd HH:mm"
        return "网络暂不可用，以下为 \(formatter.string(from: cached.checkedAt)) 的检测记录。"
    }
}
final class GitHubUpdates: NSObject, URLSessionTaskDelegate {
    private var pending: [(Result<UpdateCheck, Error>) -> Void] = []
    private var lastResult: UpdateCheck?
    private let key = "moye.updateManifest.v1"
    private let feeds = [
        "https://raw.githubusercontent.com/SakuraEdge/mini-mark/updates/rev-stable.json",
        "https://github.com/SakuraEdge/mini-mark/releases/latest/download/update.json"
    ]
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: .main)
    func check(_ completion: @escaping (Result<UpdateCheck, Error>) -> Void) {
        if let last = lastResult, !last.offline, (0..<10).contains(Date().timeIntervalSince(last.cached.checkedAt)) { completion(.success(last)); return }
        pending.append(completion)
        if pending.count == 1 { fetch(0) }
    }
    private func fetch(_ index: Int) {
        if index == feeds.count {
            if let bytes = UserDefaults.standard.data(forKey: key),
               let cached = try? JSONDecoder().decode(CachedUpdate.self, from: bytes),
               cached.checkedAt <= Date().addingTimeInterval(60),
               (try? cached.manifest.validate()) != nil {
                finish(.success(UpdateCheck(cached: cached, offline: true)))
            } else { finish(.failure(Store.failure("暂时无法连接更新服务，请检查网络后重试。"))) }
            return
        }
        var request = URLRequest(url: URL(string: feeds[index])!, timeoutInterval: 7)
        request.setValue("MiniMark/" + (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "2.0.0"), forHTTPHeaderField: "User-Agent")
        session.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                do {
                    guard error == nil, (response as? HTTPURLResponse)?.statusCode == 200,
                          let data = data, data.count <= 65536 else { throw Store.failure("更新服务暂不可用。") }
                    let manifest = try JSONDecoder().decode(UpdateManifest.self, from: data)
                    try manifest.validate()
                    let cached = CachedUpdate(manifest: manifest, checkedAt: Date())
                    UserDefaults.standard.set(try JSONEncoder().encode(cached), forKey: self.key)
                    self.finish(.success(UpdateCheck(cached: cached, offline: false)))
                } catch { self.fetch(index + 1) }
            }
        }.resume()
    }
    private func finish(_ result: Result<UpdateCheck, Error>) {
        if case .success(let checked) = result { lastResult = checked }
        let callbacks = pending; pending = []
        callbacks.forEach { $0(result) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        let allowed = ["github.com", "raw.githubusercontent.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]
        completionHandler(request.url?.scheme == "https" && allowed.contains(request.url?.host ?? "") ? request : nil)
    }
}
