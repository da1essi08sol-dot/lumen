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
        setUpTVBar()
    }

    // ---- Lumen on the TV (Lumen Box): a bar to open the remote, and Watch plays films on the TV
    private let tvBar = UIButton(type: .system)
    private func setUpTVBar() {
        tvBar.setTitle("  Lumen is on your TV · Remote", for: .normal)
        tvBar.setImage(UIImage(systemName: "appletv.fill"), for: .normal)
        tvBar.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        tvBar.tintColor = .black
        tvBar.setTitleColor(.black, for: .normal)
        tvBar.backgroundColor = UIColor(white: 1, alpha: 0.94)
        tvBar.layer.cornerRadius = 22
        tvBar.layer.shadowOpacity = 0.35; tvBar.layer.shadowRadius = 14; tvBar.layer.shadowOffset = CGSize(width: 0, height: 6)
        tvBar.translatesAutoresizingMaskIntoConstraints = false
        tvBar.addTarget(self, action: #selector(openRemote), for: .touchUpInside)
        tvBar.isHidden = true
        view.addSubview(tvBar)
        NSLayoutConstraint.activate([
            tvBar.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            tvBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -78),
            tvBar.heightAnchor.constraint(equalToConstant: 44),
            tvBar.widthAnchor.constraint(greaterThanOrEqualToConstant: 270),
        ])
        Box.shared.onTVChange = { [weak self] on in self?.tvChanged(on) }
        tvChanged(Box.shared.isOnTV)
    }
    private func tvChanged(_ on: Bool) {
        tvBar.isHidden = !on
        if on { tvBar.alpha = 0; UIView.animate(withDuration: 0.3) { self.tvBar.alpha = 1 } }
    }
    @objc func openRemote() {
        let r = RemoteSheetController()
        r.modalPresentationStyle = .pageSheet
        (presentedViewController ?? self).present(r, animated: true)
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let s = body["url"] as? String, let url = URL(string: s) else { return }
        var item: [String: Any] = [:]
        if let js = body["item"] as? String, let d = js.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { item = o }
        if let tv = Box.shared.tv { tv.openPlayer(url, item: item); openRemote(); return } // the TV is connected: play it there
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

/// The Lumen Remote on this iPhone (while Lumen is on the TV): the same remote another phone gets, from LanServer.
class RemoteSheetController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let config = WKWebViewConfiguration()
        let token = Box.shared.localToken()
        config.userContentController.addUserScript(WKUserScript(source: "try { localStorage.setItem('lumen.token', \(Box.js(token))); } catch (e) {}", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = false; web.backgroundColor = .black
        view.addSubview(web)
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(LanServer.httpPort)/remote/")!))
    }
}
