import AppKit
import MosaicCore

private final class TopAlignedClipView: NSClipView {
    override var isFlipped: Bool { true }
}

@MainActor final class SetupWindowController: NSWindowController, NSWindowDelegate {
    var onChoose: ((PlayerConnection) -> Void)?
    private let discovery = ServerDiscovery()
    private let addressField = NSTextField()
    private let pairingCode = NSTextField()
    private let resolveCode = NSButton(title: "验证配对码", target: nil, action: nil)
    private let serverMenu = NSPopUpButton()
    private let status = NSTextField(wrappingLabelWithString: "正在查找服务器…")
    private let wallLabel = NSTextField(labelWithString: "选择服务器后，将显示后台发布的屏幕")
    private let rows = NSStackView()
    private let join = NSButton(title: "选择一块屏幕", target: nil, action: nil)
    private let check = NSButton(title: "连接地址", target: nil, action: nil)
    private let search = NSButton(title: "搜索局域网", target: nil, action: nil)
    private var servers: [FoundServer] = []
    private var selected: FoundServer?
    private var selectedScreenID: String?
    private var screens: [PublishedScreen] = []
    private var preferred: [ServerAddress] = []
    private var operation: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var timer: Timer?
    private var version = 0
    private var joining = false

    init() {
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 680, height: 680),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "选择服务器与屏幕"; window.isReleasedWhenClosed = false; window.center()
        super.init(window: window); window.delegate = self
        build()
        discovery.onResults = { [weak self] in self?.updateServers($0) }
        discovery.onStatus = { [weak self] message in
            guard let self, !self.joining else { return }
            if self.selected == nil { self.status.stringValue = message }
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func present(preferred: [ServerAddress]) {
        if window?.isVisible == true { window?.makeKeyAndOrderFront(nil); return }
        self.preferred = preferred
        addressField.stringValue = preferred.first?.url.absoluteString ?? ""
        showWindow(nil); window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        beginSearch(force: false)
        timer?.invalidate()
        timer = Timer(timeInterval: 3, repeats: true) { [weak self] _ in Task { @MainActor in self?.refreshCatalog() } }
        if let timer { RunLoop.main.add(timer, forMode: .common) }
    }
    private func build() {
        guard let content = window?.contentView else { return }
        let title = NSTextField(labelWithString: "这台 Mac 是第几块屏？")
        title.font = .systemFont(ofSize: 25, weight: .semibold)
        let intro = NSTextField(wrappingLabelWithString: "自动连接已配置的后台，或发现局域网服务器。选择画布中的位置，即可加入同步播放。")
        intro.textColor = .secondaryLabelColor
        addressField.placeholderString = "服务器 IP 或地址，例如 10.20.30.20:3210"
        addressField.setAccessibilityLabel("服务器地址")
        addressField.target = self; addressField.action = #selector(manualConnect)
        check.target = self; check.action = #selector(manualConnect); check.bezelStyle = .rounded
        search.target = self; search.action = #selector(searchClicked); search.bezelStyle = .rounded
        serverMenu.setAccessibilityLabel("发现的服务器")
        serverMenu.target = self; serverMenu.action = #selector(serverChanged)
        let addressRow = NSStackView(views: [addressField, check]); addressRow.spacing = 8
        let searchRow = NSStackView(views: [serverMenu, search]); searchRow.spacing = 8
        pairingCode.placeholderString = "商业后台：输入门店管理员提供的一次性配对码"
        pairingCode.setAccessibilityLabel("门店配对码")
        resolveCode.target = self; resolveCode.action = #selector(resolvePairingCode); resolveCode.bezelStyle = .rounded
        let codeRow = NSStackView(views: [pairingCode, resolveCode]); codeRow.spacing = 8
        status.font = .systemFont(ofSize: 12); status.textColor = .secondaryLabelColor; status.maximumNumberOfLines = 3
        wallLabel.font = .systemFont(ofSize: 14, weight: .medium)
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.borderType = .bezelBorder
        scroll.contentView = TopAlignedClipView()
        rows.orientation = .vertical; rows.alignment = .leading; rows.spacing = 10; rows.edgeInsets = NSEdgeInsets(top: 12, left: 14, bottom: 12, right: 14)
        rows.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = rows
        let hint = NSTextField(wrappingLabelWithString: "在线屏幕会标记为占用。更改屏幕编号时，请先断开原设备。后台未发布时，可继续使用原来的完整设备链接。")
        hint.font = .systemFont(ofSize: 11); hint.textColor = .secondaryLabelColor
        join.target = self; join.action = #selector(joinClicked); join.bezelStyle = .rounded; join.isEnabled = false
        join.bezelColor = NSColor(red: 0.42, green: 0.34, blue: 0.91, alpha: 1)
        let stack = NSStackView(views: [title, intro, addressRow, searchRow, codeRow, status, wallLabel, scroll, hint, join])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14; stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 26),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -26),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -20),
            addressField.widthAnchor.constraint(greaterThanOrEqualToConstant: 430),
            serverMenu.widthAnchor.constraint(greaterThanOrEqualToConstant: 430),
            scroll.heightAnchor.constraint(equalToConstant: 230),
            rows.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            rows.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            rows.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
        ])
        for view in [intro, addressRow, searchRow, codeRow, status, wallLabel, scroll, hint] {
            view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
    }
    private func beginSearch(force: Bool) {
        version += 1; operation?.cancel(); refreshTask?.cancel(); refreshTask = nil
        selected = nil; selectedScreenID = nil; screens = []; renderScreens()
        discovery.discover(preferred: preferred, forceScan: force)
    }
    @objc private func searchClicked() { beginSearch(force: true) }
    private func updateServers(_ found: [FoundServer]) {
        let oldID = selected?.catalog.serverId
        servers = found; serverMenu.removeAllItems()
        if servers.isEmpty { serverMenu.addItem(withTitle: "尚未发现服务器"); serverMenu.isEnabled = false; return }
        serverMenu.isEnabled = !joining
        for server in servers { serverMenu.addItem(withTitle: "\(server.catalog.name) — \(server.address.url.host ?? "")") }
        if let oldID, let index = servers.firstIndex(where: { $0.catalog.serverId == oldID }) { serverMenu.selectItem(at: index) }
        else { serverMenu.selectItem(at: 0); select(servers[0]) }
    }
    @objc private func serverChanged() {
        guard servers.indices.contains(serverMenu.indexOfSelectedItem) else { return }
        select(servers[serverMenu.indexOfSelectedItem])
    }
    private func select(_ server: FoundServer) {
        version += 1; operation?.cancel(); refreshTask?.cancel(); refreshTask = nil
        selected = server; selectedScreenID = nil
        addressField.stringValue = server.address.url.absoluteString
        apply(server.catalog)
    }
    private func apply(_ catalog: ServerCatalog) {
        guard let selected else { return }
        self.selected = FoundServer(address: selected.address, catalog: catalog, source: selected.source)
        wallLabel.stringValue = "\(catalog.name) · \(catalog.cols) 列 × \(catalog.rows) 行"
        status.stringValue = catalog.published ? "已连接 \(selected.address.url.absoluteString) · \(selected.source)" : DiscoveryError.notPublished.localizedDescription
        let latest = catalog.screens.sorted { ($0.row, $0.col) < ($1.row, $1.col) }
        if latest != screens {
            screens = latest
            if !screens.contains(where: { $0.id == selectedScreenID && $0.available }) { selectedScreenID = nil }
            renderScreens()
        }
    }
    private func renderScreens() {
        if selected == nil { wallLabel.stringValue = "选择服务器后，将显示后台发布的屏幕" }
        for view in rows.arrangedSubviews { rows.removeArrangedSubview(view); view.removeFromSuperview() }
        if screens.isEmpty {
            let empty = NSTextField(wrappingLabelWithString: selected == nil ? "等待服务器…" : "没有可选择的屏幕，请先在后台发布。")
            empty.textColor = .secondaryLabelColor; rows.addArrangedSubview(empty)
        }
        for (index, screen) in screens.enumerated() {
            let number = screen.row * (selected?.catalog.cols ?? 1) + screen.col + 1
            let state = screen.online ? "已在线" : screen.reserved ? "正在连接" : "可选择"
            let button = NSButton(radioButtonWithTitle: "第 \(number) 块屏 · \(screen.name)     第 \(screen.row + 1) 行 / 第 \(screen.col + 1) 列     \(state)", target: self, action: #selector(screenClicked(_:)))
            button.tag = index; button.isEnabled = screen.available && !joining
            button.state = screen.id == selectedScreenID ? .on : .off
            button.setAccessibilityLabel("第 \(number) 块屏，\(state)")
            rows.addArrangedSubview(button)
        }
        let screen = screens.first { $0.id == selectedScreenID && $0.available }
        join.isEnabled = screen != nil && !joining
        join.title = screen.map { "使用第 \($0.row * (selected?.catalog.cols ?? 1) + $0.col + 1) 块屏开始播放" } ?? "请选择一块空闲屏幕"
    }
    @objc private func screenClicked(_ sender: NSButton) {
        guard screens.indices.contains(sender.tag), screens[sender.tag].available else { return }
        selectedScreenID = screens[sender.tag].id; renderScreens()
    }
    @objc private func manualConnect() {
        do {
            let address = try ServerAddress(addressField.stringValue)
            discovery.stop(); version += 1; let version = version
            operation?.cancel(); refreshTask?.cancel(); refreshTask = nil
            selected = nil; selectedScreenID = nil; screens = []; renderScreens()
            status.stringValue = "正在连接 \(address.url.absoluteString)…"
            operation = Task { [weak self] in
                guard let self else { return }
                do {
                    let catalog = try await self.discovery.catalog(at: address)
                    guard !Task.isCancelled, self.version == version else { return }
                    let server = FoundServer(address: address, catalog: catalog, source: "手工地址")
                    self.updateServers([server])
                    // updateServers selects the newly loaded server.
                } catch {
                    guard !Task.isCancelled, self.version == version else { return }
                    self.status.stringValue = (error as? DiscoveryError)?.localizedDescription ?? DiscoveryError.unavailable.localizedDescription
                    self.discovery.discover(preferred: [], forceScan: true)
                }
            }
        } catch { status.stringValue = error.localizedDescription }
    }
    private func refreshCatalog() {
        if selected?.catalog.protocolVersion == 2 { return }
        guard !joining, refreshTask == nil, let selected, window?.isVisible == true else { return }
        let version = version
        refreshTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.version == version { self.refreshTask = nil } }
            do {
                let catalog = try await self.discovery.catalog(at: selected.address)
                guard !Task.isCancelled, self.version == version else { return }
                self.apply(catalog)
            } catch {
                guard !Task.isCancelled, self.version == version else { return }
                self.status.stringValue = "服务器暂时不可达，正在重试；可搜索局域网或修改地址。"
                self.screens = []; self.selectedScreenID = nil; self.renderScreens()
            }
        }
    }
    @objc private func joinClicked() {
        guard let selected, let screen = screens.first(where: { $0.id == selectedScreenID && $0.available }), !joining else { return }
        joining = true; setControlsEnabled(false); discovery.stop()
        refreshTask?.cancel(); refreshTask = nil; version += 1; let version = version
        status.stringValue = "正在连接第 \(screen.row * selected.catalog.cols + screen.col + 1) 块屏…"
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                let connection = try await self.discovery.pair(at: selected.address, screen: screen, code: self.pairingCode.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
                guard !Task.isCancelled, self.version == version else { return }
                self.joining = false; self.setControlsEnabled(true)
                self.onChoose?(connection); self.close()
            } catch {
                guard !Task.isCancelled, self.version == version else { return }
                self.joining = false; self.setControlsEnabled(true)
                self.status.stringValue = (error as? DiscoveryError)?.localizedDescription ?? DiscoveryError.unavailable.localizedDescription
                self.selectedScreenID = nil; self.renderScreens()
            }
        }
    }
    private func setControlsEnabled(_ enabled: Bool) {
        pairingCode.isEnabled = enabled; resolveCode.isEnabled = enabled
        addressField.isEnabled = enabled; check.isEnabled = enabled; search.isEnabled = enabled
        serverMenu.isEnabled = enabled && !servers.isEmpty; renderScreens()
    }
    @objc private func resolvePairingCode() {
        let code = pairingCode.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, let address = try? ServerAddress(addressField.stringValue) else { status.stringValue = "请输入服务器地址和配对码。"; return }
        discovery.stop(); operation?.cancel(); refreshTask?.cancel(); version += 1; let version = version
        selected = nil; selectedScreenID = nil; status.stringValue = "正在验证门店配对授权…"
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                let groups = try await self.discovery.resolve(at: address, code: code)
                guard !Task.isCancelled, self.version == version else { return }
                self.updateServers(groups)
                if groups.isEmpty { self.status.stringValue = "此配对码没有可选播放组。" }
            } catch {
                guard !Task.isCancelled, self.version == version else { return }
                self.status.stringValue = "配对码无效、已使用或已过期，请在后台重新生成。"
            }
        }
    }
    func stop() {
        version += 1; operation?.cancel(); operation = nil; refreshTask?.cancel(); refreshTask = nil
        timer?.invalidate(); timer = nil; discovery.stop()
        joining = false; setControlsEnabled(true)
    }
    func windowWillClose(_ notification: Notification) { stop() }
}
