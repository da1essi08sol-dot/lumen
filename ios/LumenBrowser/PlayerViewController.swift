import UIKit
import WebKit

/// An ad-free browser for one film: ad and tracker websites blocked, pop-ups refused, redirects to other
/// websites stopped, the film started and stretched to fill the screen in landscape.
class PlayerViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let url: URL
    private let item: [String: Any]
    private var web: WKWebView!
    private let closeButton = UIButton(type: .system)
    private let blockedLabel = UILabel()
    private var allowedSites = Set<String>()
    private var started = Date()
    private var progT = 0.0, progD = 0.0
    private var hideTimer: Timer?
    private var blockedCount = 0
    var onClose: ((Double, Double) -> Void)?

    init(url: URL, item: [String: Any]) { self.url = url; self.item = item; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError() }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .landscapeRight }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        if #available(iOS 15.4, *) { config.preferences.isElementFullscreenEnabled = true }
        let content = WKUserContentController()
        let resume = (item["resumeAt"] as? Double) ?? 0
        let inject = (Bundle.main.path(forResource: "inject", ofType: "js").flatMap { try? String(contentsOfFile: $0) } ?? "")
            .replacingOccurrences(of: "__RESUME__", with: String(resume))
        let bridge = "window.LumenPlayer = { progress: function (t, d) { try { window.webkit.messageHandlers.progress.postMessage([t, d]); } catch (e) {} } };\n"
        content.addUserScript(WKUserScript(source: bridge + inject, injectionTime: .atDocumentStart, forMainFrameOnly: false)) // every frame, embedded players too
        content.add(WeakHandler(self), name: "progress")
        config.userContentController = content
        Blocker.shared.lists.forEach { content.add($0) }

        web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.backgroundColor = .black
        web.isOpaque = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.navigationDelegate = self
        web.uiDelegate = self
        web.customUserAgent = nil
        view.addSubview(web)

        closeButton.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .bold)), for: .normal)
        closeButton.tintColor = .white
        closeButton.backgroundColor = UIColor(white: 0.12, alpha: 0.8)
        closeButton.layer.cornerRadius = 22
        closeButton.accessibilityLabel = "Close and go back to Lumen"
        closeButton.addTarget(self, action: #selector(close), for: .touchUpInside)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(closeButton)
        blockedLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        blockedLabel.textColor = UIColor(white: 1, alpha: 0.85)
        blockedLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(blockedLabel)
        NSLayoutConstraint.activate([
            closeButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 10),
            closeButton.widthAnchor.constraint(equalToConstant: 44), closeButton.heightAnchor.constraint(equalToConstant: 44),
            blockedLabel.leadingAnchor.constraint(equalTo: closeButton.trailingAnchor, constant: 10),
            blockedLabel.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
        ])
        // tap anywhere to bring the close button back; swipe in from the left edge to close
        let tap = UITapGestureRecognizer(target: self, action: #selector(showControls))
        tap.cancelsTouchesInView = false; tap.delegate = self
        view.addGestureRecognizer(tap)
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgeSwipe(_:)))
        edge.edges = .left
        view.addGestureRecognizer(edge)

        allowedSites.insert(Self.site(url))
        started = Date()
        // the very first start may still be preparing the blocklist: wait for it (a few seconds, once)
        if Blocker.shared.lists.isEmpty {
            Blocker.shared.whenReady { [weak self] lists in guard let self = self else { return }; lists.forEach { self.web.configuration.userContentController.add($0) }; self.web.load(URLRequest(url: self.url)) }
        } else { web.load(URLRequest(url: url)) }
        showControls()
    }

    @objc private func showControls() {
        UIView.animate(withDuration: 0.2) { self.closeButton.alpha = 1; self.blockedLabel.alpha = 1 }
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in
            UIView.animate(withDuration: 0.4) { self?.closeButton.alpha = 0.0; self?.blockedLabel.alpha = 0 }
        }
    }
    @objc private func edgeSwipe(_ g: UIScreenEdgePanGestureRecognizer) { if g.state == .ended { close() } }
    @objc private func close() {
        hideTimer?.invalidate()
        web.evaluateJavaScript("document.querySelectorAll('video').forEach(function(v){v.pause()})")
        let t = progT, d = progD
        dismiss(animated: true) { self.onClose?(t, d) }
    }
    private func noteBlocked(_ what: String) {
        blockedCount += 1
        blockedLabel.text = "Blocked \(blockedCount) \(blockedCount == 1 ? what : "pop-ups and redirects")"
        showControls()
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let a = m.body as? [Any], a.count == 2, let t = (a[0] as? NSNumber)?.doubleValue, let d = (a[1] as? NSNumber)?.doubleValue, d > 0, d.isFinite else { return }
        if d >= progD * 0.5 { progT = t; progD = d } // the film's own video, not a short advert
    }

    // ---- pop-ups and redirects
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        noteBlocked("pop-up")
        return nil // never open a new window
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = action.request.url, let scheme = u.scheme?.lowercased() else { return decisionHandler(.cancel) }
        if ["about", "blob", "data", "javascript"].contains(scheme) { return decisionHandler(.allow) }
        guard scheme == "http" || scheme == "https" else { noteBlocked("redirect"); return decisionHandler(.cancel) } // no jumping to the App Store or other apps
        if action.targetFrame == nil { noteBlocked("pop-up"); return decisionHandler(.cancel) }
        guard action.targetFrame?.isMainFrame == true else { return decisionHandler(.allow) } // players inside the page
        let target = Self.site(u)
        if allowedSites.contains(target) { return decisionHandler(.allow) }
        // the first few seconds: sites often hop to a mirror address, which is then allowed too
        if Date().timeIntervalSince(started) < 6 { allowedSites.insert(target); return decisionHandler(.allow) }
        noteBlocked("redirect")
        decisionHandler(.cancel)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    // JavaScript alerts ("You won a prize!") are swallowed
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { completionHandler(false) }

    static func site(_ u: URL) -> String {
        guard var h = u.host?.lowercased() else { return "" }
        if h.hasPrefix("www.") { h.removeFirst(4) }
        let p = h.split(separator: ".").map(String.init)
        let sld: Set<String> = ["co", "com", "org", "net", "gov", "ac", "edu", "ltd", "plc", "me"]
        if p.count > 2, p[p.count - 1].count == 2, sld.contains(p[p.count - 2]) { return p.suffix(3).joined(separator: ".") }
        return p.count >= 2 ? p.suffix(2).joined(separator: ".") : h
    }
}

extension PlayerViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}
