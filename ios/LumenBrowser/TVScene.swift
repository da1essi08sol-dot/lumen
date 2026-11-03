import UIKit
import WebKit

/// The TV: iOS gives Lumen the TV as a screen of its own when the iPhone is connected to it (Screen Mirroring to an
/// Apple TV, or a Lightning-to-HDMI cable). Lumen then shows its full TV interface there, at the TV's own size.
class TVSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var vc: TVViewController?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.backgroundColor = .black
        let v = TVViewController()
        w.rootViewController = v
        w.isHidden = false
        window = w; vc = v
        Box.shared.attach(v)
    }
    func sceneDidDisconnect(_ scene: UIScene) {
        if let v = vc { Box.shared.detach(v) }
        window = nil; vc = nil
    }
}

class TVViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private weak var player: PlayerViewController?
    private var playerItem: [String: Any] = [:]
    private(set) var playerLabel: String?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let content = WKUserContentController()
        // the TV page talks to the app: LumenBox (pairing, remotes, state) and LumenNative.watch (play a film on the TV)
        let native = "window.LumenNative = { watch: function (url, item) { window.webkit.messageHandlers.lumen.postMessage({ url: String(url), item: String(item || '{}') }); } };"
        content.addUserScript(WKUserScript(source: Box.shared.bootScript() + "\n" + native, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(WeakHandler(Box.shared), name: "lumenbox")
        content.add(WeakHandler(self), name: "lumen")
        config.userContentController = content
        web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.navigationDelegate = self
        web.uiDelegate = self
        view.addSubview(web)
        web.load(URLRequest(url: Box.tvURL))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { Box.shared.refreshConfig() }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        decisionHandler(url.host == Box.tvURL.host || url.scheme == "about" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.web.load(URLRequest(url: Box.tvURL)) } // no internet yet: try again
    }

    // ---- running things in the TV page
    func run(_ js: String) { web?.evaluateJavaScript(js, completionHandler: nil) }
    /// a call to Lumen's on-phone backend inside the TV page (used for the remote's requests)
    func api(path: String, method: String, body: Any?, done: @escaping (Any?, (status: Int, message: String)?) -> Void) {
        let js = """
        try {
          const r = await window.LUMEN_WEB.api(path, { method: method, body: body === null ? undefined : body });
          return JSON.stringify({ ok: true, data: r === undefined ? null : r });
        } catch (e) { return JSON.stringify({ ok: false, status: e.status || 400, error: String(e.message || e) }); }
        """
        guard let web = web else { return done(nil, (503, "The TV isn’t ready yet")) }
        web.callAsyncJavaScript(js, arguments: ["path": path, "method": method, "body": body ?? NSNull()], in: nil, in: .page) { result in
            switch result {
            case .success(let v):
                guard let s = v as? String, let d = s.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return done(nil, (500, "No answer from the TV")) }
                if (o["ok"] as? Bool) == true { done(o["data"] is NSNull ? nil : o["data"], nil) }
                else { done(nil, ((o["status"] as? NSNumber)?.intValue ?? 400, o["error"] as? String ?? "Something went wrong")) }
            case .failure(let e): done(nil, (503, e.localizedDescription))
            }
        }
    }

    // ---- films play on the TV, in the ad-free player
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let s = body["url"] as? String, let url = URL(string: s) else { return }
        var item: [String: Any] = [:]
        if let js = body["item"] as? String, let d = js.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { item = o }
        openPlayer(url, item: item)
    }
    func openPlayer(_ url: URL, item: [String: Any]) {
        if let p = player { p.dismiss(animated: false) }
        let p = PlayerViewController(url: url, item: item)
        p.onTV = true
        p.onClose = { [weak self] t, d in self?.filmClosed(item: item, t: t, d: d) }
        p.modalPresentationStyle = .fullScreen
        player = p; playerItem = item
        playerLabel = (item["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? url.host ?? "Film"
        present(p, animated: true)
        run("window.lumenFromNative && lumenFromNative({ t: 'external', external: { kind: 'web', label: \(Box.js(playerLabel ?? "")) } })")
        Box.shared.pushState()
    }
    func closePlayer() { player?.closeFromRemote() }
    private func filmClosed(item: [String: Any], t: Double, d: Double) {
        player = nil; playerLabel = nil
        var js = "window.lumenFromNative && lumenFromNative({ t: 'external', external: null });"
        if d > 60, item["id"] != nil {
            var p = item; p["t"] = t; p["d"] = d
            if let data = try? JSONSerialization.data(withJSONObject: p), let s = String(data: data, encoding: .utf8) {
                js += "window.LUMEN_WEB && LUMEN_WEB.saveProgress(\(s)); window.lumenFromNative && lumenFromNative({ t: 'watching-changed' });"
            }
        }
        run(js)
        Box.shared.pushState()
    }
    /// the remote's buttons while a film plays: OK / Play-Pause, skip back and forward, Back or Home to stop
    func playerKey(_ k: String) -> Bool {
        guard let p = player else { return false }
        switch k {
        case "select", "playpause": p.togglePlay()
        case "left": p.seek(by: -10)
        case "right": p.seek(by: 10)
        case "up": p.seek(by: 60)
        case "down": p.seek(by: -60)
        case "back", "home", "main": p.closeFromRemote()
        default: break
        }
        return true
    }
}
