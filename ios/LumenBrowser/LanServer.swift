import Foundation
import Network

/// The other phone's way in (Lumen Box): a small web server on this iPhone, only while the TV is connected and only
/// for devices on the same Wi-Fi. It serves the Lumen Remote (the same page as on the laptop), handles pairing with
/// the code shown on the TV, and passes everything else to Lumen's backend inside the TV page.
///   http://<this iPhone>:8787/remote/   the remote page and its requests
///   ws://<this iPhone>:8788/ws          key presses and what's on screen, live
final class LanServer {
    static let httpPort: UInt16 = 8787
    static let wsPort: UInt16 = 8788
    private weak var box: Box?
    private var http: NWListener?
    private var ws: NWListener?
    private var sockets: [ObjectIdentifier: NWConnection] = [:]
    private let q = DispatchQueue.main

    init(box: Box) { self.box = box }

    func start() {
        do {
            let h = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: Self.httpPort)!)
            h.newConnectionHandler = { [weak self] c in self?.acceptHTTP(c) }
            h.start(queue: q); http = h
        } catch { print("Lumen Box: web server didn't start:", error) }
        do {
            let params = NWParameters.tcp
            let wso = NWProtocolWebSocket.Options()
            wso.autoReplyPing = true
            // the remote's pairing token comes as the WebSocket sub-protocol "lumen.<token>"; anything else is refused
            wso.setClientRequestHandler(q) { [weak self] subprotocols, _ in
                if let p = subprotocols.first(where: { $0.hasPrefix("lumen.") }), self?.box?.deviceIndex(token: String(p.dropFirst(6))) != nil {
                    return NWProtocolWebSocket.Response(status: .accept, subprotocol: p)
                }
                return NWProtocolWebSocket.Response(status: .reject, subprotocol: nil)
            }
            params.defaultProtocolStack.applicationProtocols.insert(wso, at: 0)
            let w = try NWListener(using: params, on: NWEndpoint.Port(rawValue: Self.wsPort)!)
            w.newConnectionHandler = { [weak self] c in self?.acceptWS(c) }
            w.start(queue: q); ws = w
        } catch { print("Lumen Box: live link didn't start:", error) }
    }
    func stop() {
        http?.cancel(); ws?.cancel(); http = nil; ws = nil
        sockets.values.forEach { $0.cancel() }; sockets.removeAll()
    }

    // only this Wi-Fi (and this iPhone itself)
    private static func isHomeNetwork(_ c: NWConnection) -> Bool {
        guard case let .hostPort(host, _) = c.endpoint else { return false }
        let s = "\(host)".split(separator: "%").first.map(String.init) ?? ""
        if s == "127.0.0.1" || s == "::1" || s.hasPrefix("fe80") { return true }
        let p = s.replacingOccurrences(of: "::ffff:", with: "").split(separator: ".").compactMap { Int($0) }
        guard p.count == 4 else { return false }
        return p[0] == 10 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && (16...31).contains(p[1])) || p[0] == 127
    }
    // ---------------- live link (WebSocket)
    private func acceptWS(_ c: NWConnection) {
        guard Self.isHomeNetwork(c) else { c.cancel(); return }
        let id = ObjectIdentifier(c)
        c.stateUpdateHandler = { [weak self] st in
            switch st {
            case .ready:
                self?.sockets[id] = c
                if let s = self?.box?.stateMessage() { self?.send(s, to: c) }
                self?.receive(c)
            case .failed, .cancelled: self?.sockets[id] = nil
            default: break
            }
        }
        c.start(queue: q)
    }
    private func receive(_ c: NWConnection) {
        c.receiveMessage { [weak self] data, _, _, err in
            guard let self = self else { return }
            if let d = data, !d.isEmpty, let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                if (m["t"] as? String) == "ping" { self.send(["t": "pong"], to: c) } else { self.box?.remoteMessage(m) }
            }
            if err == nil { self.receive(c) } else { self.sockets[ObjectIdentifier(c)] = nil; c.cancel() }
        }
    }
    private func send(_ m: [String: Any], to c: NWConnection) {
        guard let d = try? JSONSerialization.data(withJSONObject: m) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let ctx = NWConnection.ContentContext(identifier: "lumen", metadata: [meta])
        c.send(content: d, contentContext: ctx, isComplete: true, completion: .contentProcessed { _ in })
    }
    func broadcast(_ m: [String: Any]) { sockets.values.forEach { send(m, to: $0) } }

    // ---------------- web server (HTTP/1.1, one request per connection)
    private func acceptHTTP(_ c: NWConnection) {
        guard Self.isHomeNetwork(c) else { c.cancel(); return }
        c.start(queue: q)
        read(c, buffer: Data())
    }
    private func read(_ c: NWConnection, buffer: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [weak self] data, _, done, err in
            guard let self = self else { return }
            var buf = buffer; if let d = data { buf.append(d) }
            if buf.count > 12 << 20 { return self.reply(c, 413, json: ["error": "Too big"]) }
            if let req = Request(buf) { return self.handle(req, c) }
            if done || err != nil { c.cancel(); return }
            self.read(c, buffer: buf)
        }
    }

    private func handle(_ r: Request, _ c: NWConnection) {
        let path = r.path
        if r.method == "OPTIONS" { return reply(c, 204, body: Data(), type: "text/plain") }
        if path == "/" || path == "/remote" { return redirect(c, "/remote/") }
        if path.hasPrefix("/remote/") || path.hasPrefix("/shared/") { return serveFile(c, path) }
        guard path.hasPrefix("/api/") else { return reply(c, 404, json: ["error": "Not found"]) }

        // pairing with the code on the TV
        if path == "/api/pair" && r.method == "POST" {
            let b = r.json as? [String: Any] ?? [:]
            guard let code = b["code"] as? String, let p = box?.pair(code: code, name: (b["name"] as? String) ?? "Phone") else {
                return reply(c, 403, json: ["error": "That code is not right, or it has expired. Open Remote on the TV for a new one."])
            }
            return reply(c, 200, json: ["token": p.token, "deviceId": p.id, "deviceName": "Lumen TV"])
        }
        let token = r.headers["x-lumen-token"] ?? r.query["t"]
        guard let i = box?.deviceIndex(token: token) else { return reply(c, 401, json: ["error": "Not paired"]) }
        box?.touch(i)
        if path == "/api/me" {
            if r.method == "DELETE" { box?.unpair(token: token); return reply(c, 200, json: ["ok": true]) }
            return reply(c, 200, json: ["ok": true])
        }
        if path == "/api/volume" { return reply(c, 200, json: ["level": NSNull(), "muted": false, "note": "Use the TV's or Apple TV's remote for volume"]) }
        // everything else: Lumen's backend inside the TV page answers it
        guard let tv = box?.tv else { return reply(c, 503, json: ["error": "The TV isn't connected. Start Screen Mirroring to the Apple TV."]) }
        let full = path + (r.rawQuery.isEmpty ? "" : "?" + r.rawQuery)
        tv.api(path: full, method: r.method, body: r.json) { [weak self] data, error in
            if let e = error { self?.reply(c, e.status, json: ["error": e.message]); return }
            self?.reply(c, 200, json: data ?? NSNull())
        }
    }

    // the Lumen Remote's own files, built into the app (remote.js is pointed at this iPhone's live link)
    private func serveFile(_ c: NWConnection, _ path: String) {
        var rel = String(path.dropFirst()) // "remote/…" or "shared/…"
        if rel.hasSuffix("/") { rel += "index.html" }
        rel = rel.removingPercentEncoding ?? rel
        guard !rel.contains(".."), let base = Bundle.main.resourceURL else { return reply(c, 404, json: ["error": "Not found"]) }
        let file = base.appendingPathComponent(rel)
        guard var data = try? Data(contentsOf: file) else { return reply(c, 404, json: ["error": "Not found"]) }
        if rel == "remote/remote.js", var s = String(data: data, encoding: .utf8) {
            s = s.replacingOccurrences(of: "new WebSocket(`ws://${location.host}/ws?t=${encodeURIComponent(token)}`)",
                                       with: "new WebSocket(`ws://${location.hostname}:\(Self.wsPort)/ws`, ['lumen.' + token])")
            data = Data(s.utf8)
        }
        let ext = file.pathExtension.lowercased()
        let types = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8", "svg": "image/svg+xml",
                     "png": "image/png", "ttf": "font/ttf", "woff2": "font/woff2", "woff": "font/woff", "json": "application/json", "webmanifest": "application/manifest+json"]
        reply(c, 200, body: data, type: types[ext] ?? "application/octet-stream")
    }

    private func redirect(_ c: NWConnection, _ to: String) {
        let head = "HTTP/1.1 302 Found\r\nLocation: \(to)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        c.send(content: Data(head.utf8), completion: .contentProcessed { _ in c.cancel() })
    }
    private func reply(_ c: NWConnection, _ status: Int, json: Any) {
        let d = (try? JSONSerialization.data(withJSONObject: json, options: [.fragmentsAllowed])) ?? Data("null".utf8)
        reply(c, status, body: d, type: "application/json; charset=utf-8")
    }
    private func reply(_ c: NWConnection, _ status: Int, body: Data, type: String) {
        let reason = [200: "OK", 204: "No Content", 302: "Found", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 413: "Too Large", 503: "Unavailable"][status] ?? "Error"
        let head = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        var out = Data(head.utf8); out.append(body)
        c.send(content: out, completion: .contentProcessed { _ in c.cancel() })
    }
}

/// One HTTP request, once it has fully arrived (nil until then).
private struct Request {
    let method: String, path: String, rawQuery: String
    let query: [String: String], headers: [String: String]
    let json: Any?

    init?(_ buf: Data) {
        guard let end = buf.range(of: Data("\r\n\r\n".utf8)), let head = String(data: buf[..<end.lowerBound], encoding: .utf8) else { return nil }
        let lines = head.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ")
        guard first.count >= 2 else { return nil }
        var h: [String: String] = [:]
        for l in lines.dropFirst() { if let i = l.firstIndex(of: ":") { h[l[..<i].trimmingCharacters(in: .whitespaces).lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces) } }
        let length = Int(h["content-length"] ?? "0") ?? 0
        let bodyStart = end.upperBound
        guard buf.count - bodyStart >= length else { return nil }
        let body = buf.subdata(in: bodyStart..<(bodyStart + length))
        let target = String(first[1])
        let parts = target.split(separator: "?", maxSplits: 1).map(String.init)
        method = String(first[0]).uppercased(); path = parts[0]; rawQuery = parts.count > 1 ? parts[1] : ""
        var q: [String: String] = [:]
        for kv in rawQuery.split(separator: "&") { let p = kv.split(separator: "=", maxSplits: 1).map(String.init); if let k = p.first?.removingPercentEncoding { q[k] = (p.count > 1 ? p[1] : "").replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? "" } }
        query = q; headers = h
        json = length > 0 && (h["content-type"] ?? "").contains("json") ? (try? JSONSerialization.jsonObject(with: body, options: [.fragmentsAllowed])) : nil
    }
}
