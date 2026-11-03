import UIKit
import WebKit
import SafariServices

/// Lumen itself (Lumen Web, kept up to date online). Pressing Watch opens the film in the player.
class HomeViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let homeURL = URL(string: "https://da1essi08sol-dot.github.io/lumen/")!
    private var web: WKWebView!
    private weak var player: PlayerViewController?

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { UIDevice.current.userInterfaceIdiom == .pad ? .all : .portrait }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let content = WKUserContentController()
        // tells Lumen it's inside the app, so Watch comes here instead of going to Brave
        let bridge = """
        window.LumenNative = { watch: function (url, item) { window.webkit.messageHandlers.lumen.postMessage({ url: String(url), item: String(item || '{}') }); } };
        """
        content.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(WeakHandler(self), name: "lumen")
        config.userContentController = content
        web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never // Lumen handles the notch and home bar itself
        web.allowsBackForwardNavigationGestures = true
        web.navigationDelegate = self
        web.uiDelegate = self
        view.addSubview(web)
        web.load(URLRequest(url: Self.homeURL))
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let s = body["url"] as? String, let url = URL(string: s) else { return }
        var item: [String: Any] = [:]
        if let js = body["item"] as? String, let d = js.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { item = o }
        openPlayer(url, item: item)
    }

    func openPlayer(_ url: URL, item: [String: Any]) {
        if let p = player { p.dismiss(animated: false) }
        let p = PlayerViewController(url: url, item: item)
        p.onClose = { [weak self] t, d in self?.filmClosed(item: item, t: t, d: d) }
        p.modalPresentationStyle = .fullScreen
        player = p
        (presentedViewController ?? self).present(p, animated: true)
    }

    // the player reports how far through the film you got, for Continue Watching
    private func filmClosed(item: [String: Any], t: Double, d: Double) {
        var js = "window.lumenRefresh && lumenRefresh();"
        if d > 60, item["id"] != nil {
            var p = item; p["t"] = t; p["d"] = d
            if let data = try? JSONSerialization.data(withJSONObject: p), let s = String(data: data, encoding: .utf8) {
                js = "window.LUMEN_WEB && LUMEN_WEB.saveProgress(\(s)); " + js
            }
        }
        web.evaluateJavaScript(js)
    }

    // links away from Lumen (TMDB sign-up, the App Store…) open in a Safari sheet
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        if url.host == Self.homeURL.host || url.scheme == "about" { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        openOutside(url)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { openOutside(url) }
        return nil
    }
    private func openOutside(_ url: URL) {
        if url.scheme == "http" || url.scheme == "https" { present(SFSafariViewController(url: url), animated: true) }
        else { UIApplication.shared.open(url) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showOffline(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showOffline(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    private func showOffline(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        web.loadHTMLString("""
        <meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#000;color:#eee;font:17px -apple-system;display:grid;place-items:center;height:90vh;text-align:center">
        <div><b style="font-size:22px">Lumen can't connect</b><p style="color:#999">Check your Wi-Fi or mobile data.</p>
        <a href="\(Self.homeURL.absoluteString)" style="display:inline-block;margin-top:12px;padding:12px 22px;border-radius:12px;background:#fff;color:#000;text-decoration:none;font-weight:600">Try Again</a></div></body>
        """, baseURL: Self.homeURL)
    }
}

/// WKUserContentController keeps its handlers alive; this stops it keeping the screen alive too.
class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}
