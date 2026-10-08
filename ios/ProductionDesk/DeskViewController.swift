import UIKit
import WebKit

final class DeskViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    private(set) var webView: WKWebView!
    private let fileQueue = DispatchQueue(label: "local.slate.filmscheduler.files")
    private let store = WorkspaceStore(directory: FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0])
    private var shareInProgress = false
    private var recovering = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private let errorLabel = UILabel()
    private let retryButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        let configuration = WKWebViewConfiguration()
        let root = Bundle.main.url(forResource: "Web", withExtension: nil)!
        configuration.setURLSchemeHandler(LocalWebScheme(root: root), forURLScheme: LocalWebScheme.scheme)
        configuration.userContentController.addScriptMessageHandler(WeakSchedulerHandler(controller: self), contentWorld: .page, name: "scheduler")
        // Keep appearance preferences between launches; workspace data uses the
        // native store rather than browser local storage.
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.accessibilityIdentifier = "production-desk-webview"
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor), webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.accessibilityIdentifier = "native-load-error"
        retryButton.setTitle("Reopen Production Desk", for: .normal)
        retryButton.accessibilityIdentifier = "native-retry"
        retryButton.addTarget(self, action: #selector(reopen), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [errorLabel, retryButton])
        stack.axis = .vertical; stack.spacing = 20; stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: view.centerXAnchor), stack.centerYAnchor.constraint(equalTo: view.centerYAnchor), stack.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48)])
        errorLabel.isHidden = true; retryButton.isHidden = true
        reopen()
    }

    @objc private func reopen() {
        errorLabel.isHidden = true; retryButton.isHidden = true
        webView.load(URLRequest(url: LocalWebScheme.startURL))
    }

    func flushBeforeBackground() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Save Production Desk") { [weak self] in self?.endBackgroundSave() }
        webView.callAsyncJavaScript("return await window.slateDesktop?.flush?.();", arguments: [:], in: nil, in: .page) { [weak self] _ in self?.endBackgroundSave() }
    }

    private func endBackgroundSave() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.scheme == LocalWebScheme.scheme,
              message.frameInfo.request.url?.host == "app",
              let body = message.body as? [String: Any], let operation = body["operation"] as? String else {
            replyHandler(nil, NativeFileError.invalidRequest.localizedDescription); return
        }
        switch operation {
        case "load", "save", "pdf", "export":
            fileQueue.async { [weak self] in
                guard let self else { return }
                do {
                    var result: Any = true
                    var sharedFile: URL?
                    var recovered = false
                    switch operation {
                    case "load":
                        if let data = try self.store.load() { result = try JSONSerialization.jsonObject(with: data) }
                        else { result = NSNull() }
                        recovered = self.store.lastRecovery != nil
                    case "save":
                        guard let workspace = body["workspace"] as? [String: Any] else { throw NativeFileError.invalidRequest }
                        let data = try JSONSerialization.data(withJSONObject: workspace, options: [.sortedKeys])
                        guard data.count <= NativeFiles.maximumBytes else { throw NativeFileError.tooLarge }
                        try self.store.save(data)
                    case "pdf":
                        guard let base64 = body["base64"] as? String, base64.utf8.count <= NativeFiles.maximumBytes * 4 / 3 + 8,
                              let data = Data(base64Encoded: base64) else { throw NativeFileError.invalidRequest }
                        result = try NativeFiles.extractPDF(data)
                    case "export":
                        guard let filename = body["filename"] as? String, let content = body["content"] as? String else { throw NativeFileError.invalidRequest }
                        sharedFile = try NativeFiles.export(Data(content.utf8), filename: filename)
                    default: break
                    }
                    DispatchQueue.main.async {
                        if let sharedFile {
                            do { try self.share(sharedFile, completion: { replyHandler(true, nil) }) }
                            catch { replyHandler(nil, error.localizedDescription) }
                        } else if recovered {
                            let warning = "Production Desk recovered the previous saved workspace. The latest edits may be missing. The original damaged file, if present, was preserved in Documents/Recovered. Export a full backup now."
                            self.webView.callAsyncJavaScript("window.productionDeskRecovery = warning; return true;", arguments: ["warning": warning], in: nil, in: .page) { _ in replyHandler(result, nil) }
                        } else { replyHandler(result, nil) }
                    }
                } catch { DispatchQueue.main.async { replyHandler(nil, error.localizedDescription) } }
            }
        case "print":
            makeReportPDF(replyHandler)
        default: replyHandler(nil, NativeFileError.invalidRequest.localizedDescription)
        }
    }

    private func share(_ url: URL, completion: @escaping () -> Void) throws {
        guard !shareInProgress, presentedViewController == nil else { throw NativeFileError.invalidRequest }
        shareInProgress = true
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.popoverPresentationController?.sourceView = webView
        controller.popoverPresentationController?.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
        controller.popoverPresentationController?.permittedArrowDirections = []
        controller.completionWithItemsHandler = { [weak self] _, _, _, _ in
            self?.shareInProgress = false
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
            completion()
        }
        present(controller, animated: true)
    }

    private func makeReportPDF(_ reply: @escaping (Any?, String?) -> Void) {
        webView.evaluateJavaScript("document.querySelector('#print-area')?.innerHTML || ''") { [weak self] value, error in
            guard let self else { return }
            guard error == nil, let report = value as? String, !report.isEmpty else {
                reply(nil, NativeFileError.emptyReport.localizedDescription); return
            }
            do {
                // Explicit report styling avoids screen-only display:none and scroll clipping.
                let html = """
                <!doctype html><html><head><meta charset="utf-8"><style>
                body{font-family:Helvetica,Arial,sans-serif;font-size:9px;color:#241d21}h1{font-size:24px;color:#E60026}h2{font-size:16px}p{color:#64555e}table{border-collapse:collapse;width:100%;table-layout:auto}th{background:#fff0f4;text-align:left}th,td{border-bottom:1px solid #ddd;padding:5px;vertical-align:top}tr{page-break-inside:avoid}thead{display:table-header-group}button{display:none}.badges{white-space:normal}.strip{padding:8px;background:#fff0f4}.strip.banner{background:#E60026;color:white}.strip-color-button{display:none}
                </style></head><body>\(report)</body></html>
                """
                let renderer = ReportRenderer()
                renderer.addPrintFormatter(UIMarkupTextPrintFormatter(markupText: html), startingAtPageAt: 0)
                let data = renderer.pdfData()
                guard !data.isEmpty else { throw NativeFileError.emptyReport }
                let url = try NativeFiles.export(data, filename: "Production-Desk-report.pdf")
                try self.share(url) { reply(true, nil) }
            } catch { reply(nil, error.localizedDescription) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == LocalWebScheme.scheme, url.host == "app" {
            // Home links should retain current editing state. Resource requests
            // are handled independently by the custom URL scheme.
            if navigationAction.navigationType == .linkActivated { decisionHandler(.cancel) }
            else if navigationAction.navigationType == .reload || navigationAction.navigationType == .backForward { decisionHandler(.cancel) }
            else { decisionHandler(.allow) }
        } else {
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated, ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { UIApplication.shared.open(url) }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        recovering = true
        reopen()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { recovering = false }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showLoadError(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showLoadError(error) }
    private func showLoadError(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        errorLabel.text = "Production Desk could not open. Your saved workspace is kept on this device.\n\(error.localizedDescription)"
        errorLabel.isHidden = false; retryButton.isHidden = false
    }
}

private final class WeakSchedulerHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var controller: DeskViewController?
    init(controller: DeskViewController) { self.controller = controller }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let controller else { replyHandler(nil, "Production Desk is closing."); return }
        controller.userContentController(userContentController, didReceive: message, replyHandler: replyHandler)
    }
}

final class ReportRenderer: UIPrintPageRenderer {
    override var paperRect: CGRect { CGRect(x: 0, y: 0, width: 792, height: 612) }
    override var printableRect: CGRect { paperRect.insetBy(dx: 28, dy: 28) }
    func pdfData() -> Data {
        let result = NSMutableData()
        UIGraphicsBeginPDFContextToData(result, paperRect, nil)
        prepare(forDrawingPages: NSRange(location: 0, length: numberOfPages))
        for page in 0..<numberOfPages {
            UIGraphicsBeginPDFPage()
            drawPage(at: page, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        return result as Data
    }
}
