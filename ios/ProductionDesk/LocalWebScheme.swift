import Foundation
import WebKit

/// Serves the shipped app without a server or network connection. Root-relative
/// CSS, fonts and ES modules all share the productiondesk://app origin.
final class LocalWebScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "productiondesk"
    static let startURL = URL(string: "productiondesk://app/index.html")!
    let root: URL

    init(root: URL) { self.root = root.standardizedFileURL }

    func resourceURL(for url: URL) throws -> URL {
        guard url.scheme == Self.scheme, url.host == "app",
              url.user == nil, url.password == nil, url.port == nil else {
            throw CocoaError(.fileReadNoPermission)
        }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.resolvingSymlinksInPath().path + "/") else {
            throw CocoaError(.fileReadNoPermission)
        }
        return file
    }

    static func mimeType(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        do {
            guard let url = urlSchemeTask.request.url else { throw CocoaError(.fileReadInvalidFileName) }
            let file = try resourceURL(for: url)
            let data = try Data(contentsOf: file)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                "Content-Type": Self.mimeType(for: file),
                "Content-Length": String(data.count),
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-cache"
            ])!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
