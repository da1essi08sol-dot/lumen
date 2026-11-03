import UIKit
import WebKit
import Security

/// Lumen Box: the iPhone as the box behind the TV. When the iPhone is connected to a TV (AirPlay Screen Mirroring to
/// an Apple TV, or a cable), the TV shows Lumen's full TV interface; films play on the TV in Lumen's ad-free player;
/// and another phone on the same Wi-Fi can be the remote (it opens the Lumen Remote from this iPhone, see LanServer).
final class Box: NSObject, WKScriptMessageHandler {
    static let shared = Box()
    static let tvURL = URL(string: "https://da1essi08sol-dot.github.io/lumen/tv/")!

    private(set) weak var tv: TVViewController?
    private(set) var server: LanServer?
    private var pairing: (code: String, expires: Date)?
    private var tvState: [String: Any] = [:]
    private var tvConfig: [String: Any] = [:]
    /// remotes this iPhone has paired (kept on the phone; tokens only stored as hashes)
    private(set) var devices: [[String: Any]] = UserDefaults.standard.array(forKey: "lumen.box.devices") as? [[String: Any]] ?? []
    var isOnTV: Bool { tv != nil }
    var onTVChange: ((Bool) -> Void)?

    // ---- the TV screen came and went
    func attach(_ vc: TVViewController) {
        tv = vc
        if server == nil { server = LanServer(box: self); server?.start() }
        onTVChange?(true)
    }
    func detach(_ vc: TVViewController) {
        guard tv === vc else { return }
        tv = nil
        server?.stop(); server = nil
        onTVChange?(false)
    }

    /// what the TV page sees as window.LumenBox (its Wi-Fi address, paired remotes, and a way to message the app)
    func bootScript() -> String {
        let host = (Self.wifiAddress() ?? "") + ":\(LanServer.httpPort)"
        let devs = (try? JSONSerialization.data(withJSONObject: publicDevices())).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return "window.LumenBox = { host: \(Self.js(host)), devices: \(devs), post: function (m) { try { window.webkit.messageHandlers.lumenbox.postMessage(JSON.stringify(m)); } catch (e) {} } };"
    }
    private func publicDevices() -> [[String: Any]] { devices.map { d in d.filter { $0.key != "tokenHash" } } }
    private func refreshTVDevices() {
        let devs = (try? JSONSerialization.data(withJSONObject: publicDevices())).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        tv?.run("if (window.LumenBox) LumenBox.devices = \(devs); window.lumenFromNative && lumenFromNative({ t: 'remotes', count: \(devices.count) });")
    }

    // ---- messages from the TV page (window.LumenBox.post)
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let s = message.body as? String, let d = s.data(using: .utf8), let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let t = m["t"] as? String else { return }
        switch t {
        case "pairing":
            if let code = m["code"] as? String { pairing = (code, Date().addingTimeInterval(5 * 60)) }
        case "unpair":
            if let id = m["id"] as? String { devices.removeAll { ($0["id"] as? String) == id }; saveDevices(); refreshTVDevices() }
        case "close-player":
            tv?.closePlayer()
        case "state":
            tvState = m; pushState()
        default: break
        }
    }

    // ---- pairing a remote (LanServer calls these)
    func pair(code: String, name: String) -> (token: String, id: String)? {
        guard let p = pairing, Date() < p.expires, code == p.code else { return nil }
        pairing = nil
        var bytes = [UInt8](repeating: 0, count: 32); _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let token = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let id = UUID().uuidString
        devices.append(["id": id, "name": String(name.prefix(40)), "tokenHash": Self.hash(token), "createdAt": Date().timeIntervalSince1970 * 1000, "lastSeen": Date().timeIntervalSince1970 * 1000])
        saveDevices(); refreshTVDevices()
        tv?.run("window.lumenFromNative && lumenFromNative({ t: 'paired', name: \(Self.js(name)) })")
        return (token, id)
    }
    func deviceIndex(token: String?) -> Int? {
        guard let token = token, !token.isEmpty else { return nil }
        let h = Self.hash(token)
        return devices.firstIndex { ($0["tokenHash"] as? String) == h }
    }
    func touch(_ i: Int) { if devices.indices.contains(i) { devices[i]["lastSeen"] = Date().timeIntervalSince1970 * 1000 } }
    func unpair(token: String?) { if let i = deviceIndex(token: token) { devices.remove(at: i); saveDevices(); refreshTVDevices() } }
    /// this iPhone's own remote (Home screen › TV Remote): a device entry of its own, made the first time
    func localToken() -> String {
        if let t = UserDefaults.standard.string(forKey: "lumen.box.localToken"), deviceIndex(token: t) != nil { return t }
        var bytes = [UInt8](repeating: 0, count: 32); _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let token = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        devices.append(["id": UUID().uuidString, "name": "This iPhone", "tokenHash": Self.hash(token), "createdAt": Date().timeIntervalSince1970 * 1000, "lastSeen": Date().timeIntervalSince1970 * 1000])
        saveDevices(); refreshTVDevices()
        UserDefaults.standard.set(token, forKey: "lumen.box.localToken")
        return token
    }
    private func saveDevices() { UserDefaults.standard.set(devices, forKey: "lumen.box.devices") }

    // ---- a remote's message (key presses, typing, brightness)
    func remoteMessage(_ m: [String: Any]) {
        guard let t = m["t"] as? String, let tv = tv else { return }
        if t == "key", let k = m["k"] as? String {
            if tv.playerKey(k) { return }   // a film is playing: play/pause, skip, close
            tv.run("window.lumenFromNative && lumenFromNative({ t: 'key', k: \(Self.js(k)) })")
        } else if t == "text" {
            if let d = try? JSONSerialization.data(withJSONObject: m), let s = String(data: d, encoding: .utf8) { tv.run("window.lumenFromNative && lumenFromNative(\(s))") }
        } else if t == "bright", let v = (m["v"] as? NSNumber)?.intValue {
            tv.api(path: "/api/settings", method: "POST", body: ["brightness": ["level": max(1, min(100, v))]]) { _, _ in }
        }
    }

    // ---- what remotes are told (their header, the accent colour, what's on screen)
    func stateMessage() -> [String: Any] {
        var s: [String: Any] = ["t": "state", "tvConnected": tv != nil, "view": tvState["view"] ?? "home", "textInput": tvState["textInput"] ?? false,
                                "inPlayer": tvState["inPlayer"] ?? false, "deviceName": tvConfig["deviceName"] ?? "Lumen TV", "accent": tvConfig["accentRgb"] ?? "255,255,255",
                                "font": tvConfig["font"] ?? "classic", "brightness": (tvConfig["brightness"] as? [String: Any])?["level"] ?? 100]
        if let label = tv?.playerLabel { s["external"] = ["kind": "web", "label": label] } else { s["external"] = NSNull() }
        return s
    }
    func pushState() { server?.broadcast(stateMessage()) }
    func refreshConfig() {
        tv?.api(path: "/api/config", method: "GET", body: nil) { [weak self] obj, _ in
            if let c = obj as? [String: Any] { self?.tvConfig = c; self?.pushState() }
        }
    }

    // ---- helpers
    static func js(_ s: String) -> String {
        let d = (try? JSONSerialization.data(withJSONObject: [s])).flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(d.dropFirst().dropLast())
    }
    static func hash(_ s: String) -> String {
        // FNV-1a 64 twice (salted): enough to not keep tokens in plain text on the phone
        func fnv(_ str: String) -> UInt64 { var h: UInt64 = 0xcbf29ce484222325; for b in str.utf8 { h ^= UInt64(b); h = h &* 0x100000001b3 }; return h }
        return String(format: "%016llx%016llx", fnv("lumen:" + s), fnv(s + ":box"))
    }
    /// this iPhone's address on the Wi-Fi (what the other phone types or scans)
    static func wifiAddress() -> String? {
        var best: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(ifaddr) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = p.pointee
            guard let sa = ifa.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: ifa.ifa_name)
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                let ip = String(cString: host)
                if name == "en0" { return ip }                                // Wi-Fi
                if best == nil, name.hasPrefix("en"), !ip.hasPrefix("169.254") { best = ip }
            }
        }
        return best
    }
}
