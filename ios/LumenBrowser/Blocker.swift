import WebKit

/// Blocks ad and tracker websites in the player, using Safari's own content blocking.
/// The list (blocklist.txt, one website per line) is turned into rules once and kept, so later starts are instant.
final class Blocker {
    static let shared = Blocker()
    private(set) var lists: [WKContentRuleList] = []
    private var waiting: [([WKContentRuleList]) -> Void] = []
    private var ready = false
    private let chunk = 40_000 // Safari allows up to 150,000 rules per list; smaller lists compile faster

    func prepare() {
        guard let path = Bundle.main.path(forResource: "blocklist", ofType: "txt"), let text = try? String(contentsOfFile: path) else { finish([]); return }
        let domains = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") && $0.contains(".") && !$0.contains(" ") }
        var h: UInt32 = 5381 // a hash that stays the same between launches (Swift's own hashValue changes every launch)
        for b in text.utf8 { h = (h &<< 5) &+ h &+ UInt32(b) }
        let version = "\(domains.count)-\(h)-v1"
        let groups = stride(from: 0, to: domains.count, by: chunk).map { Array(domains[$0..<min($0 + chunk, domains.count)]) }
        let store = WKContentRuleListStore.default()!
        var out: [WKContentRuleList?] = Array(repeating: nil, count: groups.count + 1)
        let group = DispatchGroup()
        for (i, g) in groups.enumerated() {
            let id = "lumen-block-\(i)-\(version)"
            group.enter()
            store.lookUpContentRuleList(forIdentifier: id) { found, _ in
                if let found = found { out[i] = found; group.leave(); return }
                DispatchQueue.global(qos: .userInitiated).async {
                    let json = Blocker.rules(g)
                    DispatchQueue.main.async {
                        store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: json) { list, err in
                            if let err = err { NSLog("Lumen blocklist \(i): \(err)") }
                            out[i] = list; group.leave()
                        }
                    }
                }
            }
        }
        // hide the usual ad boxes on every page
        group.enter()
        let cosmetic = #"[{"trigger":{"url-filter":".*"},"action":{"type":"css-display-none","selector":".adsbygoogle, ins.adsbygoogle, [id^='div-gpt-ad'], [class*='ad-container'], [class*='popunder'], iframe[src*='doubleclick'], iframe[src*='/ads/']"}}]"#
        store.compileContentRuleList(forIdentifier: "lumen-cosmetic-v1", encodedContentRuleList: cosmetic) { list, _ in out[groups.count] = list; group.leave() }
        group.notify(queue: .main) { self.finish(out.compactMap { $0 }) }
        // tidy away lists from older versions of the blocklist
        store.getAvailableContentRuleListIdentifiers { ids in
            for id in ids ?? [] where id.hasPrefix("lumen-block-") && !id.hasSuffix(version) { store.removeContentRuleList(forIdentifier: id) { _ in } }
        }
    }

    private static func rules(_ domains: [String]) -> String {
        var s = "["
        s.reserveCapacity(domains.count * 110)
        for (i, d) in domains.enumerated() {
            let esc = d.lowercased().replacingOccurrences(of: ".", with: "\\\\.")
            if i > 0 { s += "," }
            s += #"{"trigger":{"url-filter":"^[a-z]+://([^/]*\\.)?"# + esc + #"[:/]","load-type":["third-party"]},"action":{"type":"block"}}"#
        }
        return s + "]"
    }

    private func finish(_ l: [WKContentRuleList]) {
        lists = l; ready = true
        waiting.forEach { $0(l) }; waiting = []
    }
    /// The lists, once ready (straight away after the first start).
    func whenReady(_ f: @escaping ([WKContentRuleList]) -> Void) {
        if ready { f(lists) } else { waiting.append(f) }
    }
}
