import AppKit
import MosaicCore

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    var controller: PlayerWindowController!
    var engine: PlaybackEngine!
    var pendingURL: URL?
    private var setup: SetupWindowController!
    private var recoveryTimer: Timer?
    private var disconnectedSince: TimeInterval?
    private var recoveryShown = false
    var testing: Bool { environment["MOSAIC_TEST_MODE"] == "1" }
    let environment: [String: String] = {
        var result = ProcessInfo.processInfo.environment
        // Dedicated integration bundles never read/write the user's real pairing.
        if Bundle.main.bundleIdentifier?.hasPrefix("local.mosaic.player.integration.") == true,
           let config = Bundle.main.object(forInfoDictionaryKey: "MosaicIntegration") as? [String: String] {
            for key in ["MOSAIC_TEST_CACHE", "MOSAIC_DIAGNOSTICS", "MOSAIC_CONNECTION_FILE"] {
                if let value = config[key] { result[key] = value }
            }
            result["MOSAIC_TEST_MODE"] = "1"
        }
        return result
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("local.mosaic.player", isDirectory: true)
        let cache = testing ? environment["MOSAIC_TEST_CACHE"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? root : root
        let diagnostics = testing ? environment["MOSAIC_DIAGNOSTICS"].map { URL(fileURLWithPath: $0) } : nil
        engine = PlaybackEngine(cacheDirectory: cache, diagnostics: diagnostics)
        controller = PlayerWindowController(engine: engine)
        setup = SetupWindowController()
        setup.onChoose = { [weak self] connection in
            self?.controller.accept(connection)
            self?.controller.window?.makeKeyAndOrderFront(nil)
        }
        controller.onConfigure = { [weak self] in self?.showSetup() }
        engine.onPairingValidated = { [weak self] connection in
            guard let self, !self.testing else { return }
            do {
                try PairingStore.save(connection)
                UserDefaults.standard.set(connection.origin.absoluteString, forKey: "mosaic.serverAddress")
            }
            catch { self.controller.showError("已连接，但钥匙串保存失败。下次启动需要重新粘贴设备链接。") }
        }
        controller.onForgetPairing = { [weak self] in if self?.testing == false { PairingStore.clear() } }
        buildMenu()
        controller.showWindow(nil); NSApp.activate(ignoringOtherApps: true)
        if let pendingURL { open(pendingURL) }
        else if testing, let file = environment["MOSAIC_CONNECTION_FILE"], let data = try? Data(contentsOf: URL(fileURLWithPath: file)),
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: String], let link = object["link"] {
            do { controller.accept(try PlayerConnection(link: link)) } catch { controller.showError(error.localizedDescription) }
        } else if !testing, let saved = PairingStore.load() { controller.accept(saved) }
        else if !testing || environment["MOSAIC_TEST_SETUP"] == "1" { showSetup() }
        if !testing {
            recoveryTimer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.checkRecovery() }
            }
            if let recoveryTimer { RunLoop.main.add(recoveryTimer, forMode: .common) }
        }
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first else { return }
        if controller == nil { pendingURL = url } else { open(url) }
    }
    func open(_ url: URL) {
        do {
            let connection = try PlayerConnection(link: url.absoluteString)
            if let existing = engine.transport.connection, existing != connection {
                let alert = NSAlert(); alert.messageText = "切换播放设备？"; alert.informativeText = "将断开当前屏幕并连接新链接对应的后台与屏幕。"
                alert.addButton(withTitle: "切换"); alert.addButton(withTitle: "取消")
                guard alert.runModal() == .alertFirstButtonReturn else { return }
            }
            controller.accept(connection); controller.showWindow(nil); NSApp.activate(ignoringOtherApps: true)
        } catch { controller.showError(error.localizedDescription) }
    }
    private func buildMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于 Mosaic Player", action: #selector(about), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "选择服务器与屏幕…", action: #selector(showSetup), keyEquivalent: "k").target = self
        appMenu.addItem(withTitle: "清除本机缓存…", action: #selector(clearCache), keyEquivalent: "").target = self
        appMenu.addItem(withTitle: "断开并忘记设备", action: #selector(forget), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 Mosaic Player", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "退出 Mosaic Player", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); editItem.title = "编辑"; menu.addItem(editItem)
        let edit = NSMenu(title: "编辑"); editItem.submenu = edit
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let windowItem = NSMenuItem(); windowItem.title = "窗口"; menu.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口"); windowItem.submenu = windowMenu
        let full = windowMenu.addItem(withTitle: "进入 / 退出全屏", action: #selector(PlayerWindowController.toggleFullscreen), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.control, .command]; full.target = controller
        windowMenu.addItem(withTitle: "显示控制面板", action: #selector(showControls), keyEquivalent: ",").target = self
        NSApp.mainMenu = menu; NSApp.windowsMenu = windowMenu
    }
    @objc private func showControls() { controller.showControls() }
    @objc private func showSetup() {
        var candidates: [String] = []
        if testing {
            if let value = environment["MOSAIC_TEST_SERVER"] { candidates = [value] }
        } else {
            if let current = engine.transport.connection?.origin.absoluteString { candidates.append(current) }
            if let saved = UserDefaults.standard.string(forKey: "mosaic.serverAddress") { candidates.append(saved) }
            candidates.append(Bundle.main.object(forInfoDictionaryKey: "MosaicDefaultServerURL") as? String ?? "")
        }
        var seen = Set<ServerAddress>()
        let addresses = candidates.compactMap { try? ServerAddress($0) }.filter { seen.insert($0).inserted }
        setup.present(preferred: addresses)
    }
    private func checkRecovery() {
        if engine.connected { disconnectedSince = nil; recoveryShown = false; return }
        guard engine.transport.connection != nil || engine.status == "error" else { disconnectedSince = nil; return }
        let now = ProcessInfo.processInfo.systemUptime
        if disconnectedSince == nil { disconnectedSince = now }
        if !recoveryShown, now - (disconnectedSince ?? now) >= 10 {
            recoveryShown = true
            showSetup()
        }
    }
    @objc private func forget() { controller.disconnectClicked() }
    @objc private func about() {
        NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Mosaic Player", .applicationVersion: "0.4.0", .version: "原生 macOS · Swift / AVFoundation", .credits: NSAttributedString(string: "多设备，共享同一条时间线。\nmacOS 13 及以上 · Apple Silicon / Intel")])
    }
    @objc private func clearCache() {
        let alert = NSAlert(); alert.messageText = "停止播放并清除本机缓存？"; alert.informativeText = "后台原始素材不会删除。重新连接后会再次下载素材。"
        alert.addButton(withTitle: "清除缓存"); alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task { do { try await engine.clearCache() } catch { controller.showError("缓存清理失败，请检查目录权限。") } }
    }
    func applicationWillTerminate(_ notification: Notification) { recoveryTimer?.invalidate(); setup?.stop(); engine?.shutdown() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main struct MosaicApplication {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.setActivationPolicy(.regular)
        application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }
}
