import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        Blocker.shared.prepare() // compile the ad and tracker blocklist (only slow the very first time)
        return true
    }
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    let home = HomeViewController()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.backgroundColor = .black
        w.rootViewController = home
        w.makeKeyAndVisible()
        window = w
        if let url = connectionOptions.urlContexts.first?.url { DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.handle(url) } }
    }
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url { handle(url) }
    }
    // lumenbrowser://watch?url=… (from Lumen Web in Safari, or a shortcut)
    private func handle(_ url: URL) {
        guard url.scheme == "lumenbrowser",
              let target = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "url" })?.value,
              let u = URL(string: target), u.scheme == "https" || u.scheme == "http" else { return }
        home.openPlayer(u, item: [:])
    }
}
