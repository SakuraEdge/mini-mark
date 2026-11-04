import Foundation

final class GitHubUpdates: NSObject, URLSessionTaskDelegate {
    private var pending: [(Result<[[String: Any]], Error>) -> Void] = []
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: .main)
    func check(_ completion: @escaping (Result<[[String: Any]], Error>) -> Void) {
        pending.append(completion)
        if pending.count > 1 { return }
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/SakuraEdge/moye-markdown/releases?per_page=100")!, timeoutInterval: 15)
        request.setValue("Moye/1.0.0", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        session.dataTask(with: request) { data, response, error in
            let result: Result<[[String: Any]], Error>
            do {
                if error != nil { throw Store.failure("无法连接 GitHub，请检查网络后重试。") }
                guard let response = response as? HTTPURLResponse else { throw Store.failure("无法读取 GitHub 响应。") }
                guard response.statusCode == 200 else { throw Store.failure(response.statusCode == 403 || response.statusCode == 429 ? "GitHub 请求次数受限，请稍后重试。" : "GitHub 暂时不可用（HTTP \(response.statusCode)）。") }
                guard let data = data, data.count <= 4 * 1024 * 1024, let releases = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { throw Store.failure("GitHub 返回的版本列表无效。") }
                result = .success(releases.map { ["tag_name": $0["tag_name"] ?? "", "draft": $0["draft"] ?? false, "prerelease": $0["prerelease"] ?? false] })
            } catch { result = .failure(error) }
            DispatchQueue.main.async {
                let callbacks = self.pending; self.pending = []
                callbacks.forEach { $0(result) }
            }
        }.resume()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
