import AppKit
import AVFoundation
import CoreImage
import MosaicCore

@MainActor final class CanvasView: NSView {
    override var isFlipped: Bool { true }
    let viewport = CALayer()
    let wall = CALayer()
    let video = AVPlayerLayer()
    let imageLayer = CALayer()
    let calibration = CAGradientLayer()
    let ring = CAShapeLayer()
    let title = CATextLayer()
    var layoutInfo: (WallLayout, WallScreen)?
    var onInteraction: (() -> Void)?
    private var tracking: NSTrackingArea?
    private var output: AVPlayerItemVideoOutput?
    private weak var outputItem: AVPlayerItem?

    func screenshot() async throws -> Data {
        guard let (layout, screen) = layoutInfo, bounds.width > 0, bounds.height > 0 else { throw PlayerError.invalidMedia }
        var frame: CGImage?
        if !video.isHidden, let item = video.player?.currentItem {
            if outputItem !== item {
                if let old = output, let oldItem = outputItem { oldItem.remove(old) }
                let next = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
                item.add(next); output = next; outputItem = item
                try await Task.sleep(nanoseconds: 150_000_000)
            }
            guard let output, let buffer = output.copyPixelBuffer(forItemTime: item.currentTime(), itemTimeForDisplay: nil) else { throw PlayerError.invalidMedia }
            let image = CIImage(cvPixelBuffer: buffer)
            frame = CIContext().createCGImage(image, from: image.extent)
        } else if !imageLayer.isHidden { frame = imageLayer.contents as! CGImage? }
        guard let frame else { throw PlayerError.invalidMedia }
        let size = bounds.size
        return try await Task.detached(priority: .utility) {
            let ratio = min(1, 960 / max(size.width, size.height))
            let width = max(1, Int(size.width * ratio)), height = max(1, Int(size.height * ratio))
            guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw PlayerError.invalidMedia }
            ctx.setFillColor(CGColor(gray: 0, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
            let geometry = CanvasGeometry(layout: layout, screen: screen, width: Double(width), height: Double(height))
            let viewport = geometry.viewport, wall = geometry.wall.offsetBy(dx: viewport.minX, dy: viewport.minY)
            let rotation = layout.mode == "freeform" ? screen.rotation ?? 0 : 0
            ctx.translateBy(x: Double(width)/2, y: Double(height)/2)
            ctx.rotate(by: -Double(rotation) * .pi / 180)
            ctx.translateBy(x: -Double(width)/2, y: -Double(height)/2)
            let scale = max(wall.width / Double(frame.width), wall.height / Double(frame.height))
            let rect = CGRect(x: wall.midX - Double(frame.width) * scale / 2,
                              y: Double(height) - wall.midY - Double(frame.height) * scale / 2,
                              width: Double(frame.width) * scale, height: Double(frame.height) * scale)
            ctx.clip(to: CGRect(x: viewport.minX, y: Double(height) - viewport.maxY, width: viewport.width, height: viewport.height))
            ctx.draw(frame, in: rect)
            guard let result = ctx.makeImage() else { throw PlayerError.invalidMedia }
            for quality in [0.7, 0.45, 0.25] {
                let buffer = NSMutableData()
                guard let destination = CGImageDestinationCreateWithData(buffer, "public.jpeg" as CFString, 1, nil) else { throw PlayerError.invalidMedia }
                CGImageDestinationAddImage(destination, result, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
                if CGImageDestinationFinalize(destination), buffer.length <= 256 * 1024 { return buffer as Data }
            }
            throw PlayerError.invalidMedia
        }.value
    }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor; layer?.isGeometryFlipped = true
        viewport.masksToBounds = true; viewport.isGeometryFlipped = true
        wall.masksToBounds = true; wall.isGeometryFlipped = true
        layer?.addSublayer(viewport); viewport.addSublayer(wall)
        calibration.colors = [NSColor(red: 0.15, green: 0.20, blue: 0.39, alpha: 1).cgColor,
                              NSColor(red: 0.48, green: 0.43, blue: 0.72, alpha: 1).cgColor,
                              NSColor(red: 0.88, green: 0.65, blue: 0.74, alpha: 1).cgColor]
        calibration.startPoint = CGPoint(x: 0, y: 0); calibration.endPoint = CGPoint(x: 1, y: 1)
        wall.addSublayer(calibration)
        ring.fillColor = NSColor.white.withAlphaComponent(0.05).cgColor
        ring.strokeColor = NSColor.white.withAlphaComponent(0.12).cgColor
        calibration.addSublayer(ring)
        title.string = "MOSAIC"; title.font = NSFont.systemFont(ofSize: 70, weight: .ultraLight); title.foregroundColor = NSColor.white.withAlphaComponent(0.9).cgColor
        calibration.addSublayer(title)
        imageLayer.contentsGravity = .resizeAspectFill; imageLayer.masksToBounds = true
        video.videoGravity = .resizeAspectFill
        wall.addSublayer(imageLayer); wall.addSublayer(video)
        imageLayer.isHidden = true; video.isHidden = true
        setAccessibilityIdentifier("mosaic-native-canvas")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        tracking = NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: self)
        if let tracking { addTrackingArea(tracking) }
    }
    override func mouseMoved(with event: NSEvent) { onInteraction?() }
    override func mouseDown(with event: NSEvent) { onInteraction?() }
    func configure(_ layout: WallLayout, screen: WallScreen) { layoutInfo = (layout, screen); needsLayout = true }
    func display(_ media: LoadedMedia?) {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        video.player = media?.player; video.isHidden = media?.player == nil
        imageLayer.contents = media?.image; imageLayer.isHidden = media?.image == nil
        calibration.isHidden = media != nil
        CATransaction.commit()
    }
    override func layout() {
        super.layout()
        let viewportFrame: CGRect, wallFrame: CGRect
        if let (layout, screen) = layoutInfo {
            let geometry = CanvasGeometry(layout: layout, screen: screen, width: bounds.width, height: bounds.height)
            viewportFrame = geometry.viewport; wallFrame = geometry.wall
        } else { viewportFrame = bounds; wallFrame = bounds }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        viewport.transform = CATransform3DIdentity
        viewport.frame = viewportFrame; wall.frame = wallFrame
        let rotation = layoutInfo?.0.mode == "freeform" ? layoutInfo?.1.rotation ?? 0 : 0
        viewport.transform = CATransform3DMakeRotation(Double(rotation) * .pi / 180, 0, 0, 1)
        for sub in [calibration, imageLayer, video] { sub.frame = wall.bounds }
        ring.frame = wall.bounds
        ring.path = CGPath(ellipseIn: CGRect(x: wall.bounds.width * 0.3, y: -wall.bounds.height * 0.4, width: wall.bounds.width * 0.6, height: wall.bounds.height * 1.8), transform: nil)
        ring.lineWidth = wall.bounds.height * 0.16
        title.frame = CGRect(x: wall.bounds.width * 0.07, y: wall.bounds.height * 0.34, width: wall.bounds.width * 0.8, height: wall.bounds.height * 0.25)
        title.fontSize = max(24, wall.bounds.height * 0.16)
        title.contentsScale = window?.backingScaleFactor ?? 2
        CATransaction.commit()
    }
}

@MainActor final class PlayerWindowController: NSWindowController, NSWindowDelegate {
    let canvas = CanvasView(frame: CGRect(x: 0, y: 0, width: 1080, height: 680))
    let engine: PlaybackEngine
    private let card = NSVisualEffectView()
    private let heading = NSTextField(labelWithString: "连接你的屏幕")
    private let summary = NSTextField(wrappingLabelWithString: "粘贴设备链接，加入同一幅画面。")
    private let network = NSTextField(labelWithString: "尚未连接")
    private let connectionField = NSSecureTextField()
    private let connectButton = NSButton(title: "连接设备", target: nil, action: nil)
    private let disconnectButton = NSButton(title: "断开", target: nil, action: nil)
    private let fullscreenButton = NSButton(title: "进入全屏", target: nil, action: nil)
    private let displayMenu = NSPopUpButton()
    private let metrics = NSTextField(labelWithString: "原生渲染 · 本机缓存 · 自动校时")
    private var hideTimer: Timer?
    private var keyboardMonitor: Any?
    private var workspaceObservers: [NSObjectProtocol] = []
    var onForgetPairing: (() -> Void)?
    var onConfigure: (() -> Void)?

    init(engine: PlaybackEngine) {
        self.engine = engine
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 1080, height: 680), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Mosaic Player"; window.minSize = NSSize(width: 740, height: 470)
        window.backgroundColor = .black; window.collectionBehavior = [.fullScreenPrimary]; window.acceptsMouseMovedEvents = true
        window.isReleasedWhenClosed = false; window.center()
        super.init(window: window)
        window.delegate = self; window.contentView = canvas
        buildPanel()
        engine.onMedia = { [weak self] media in self?.canvas.display(media) }
        engine.captureFrame = { [weak self] in
            guard let self else { throw PlayerError.invalidMedia }
            return try await self.canvas.screenshot()
        }
        engine.onLayout = { [weak self] layout, screen in self?.canvas.configure(layout, screen: screen) }
        engine.displaySize = { [weak self] in guard let self else { return .zero }; return self.canvas.convertToBacking(self.canvas.bounds).size }
        engine.renderInfo = { [weak self] in
            guard let self else { return [:] }
            return ["videoReady": self.canvas.video.isReadyForDisplay,
                    "imageReady": self.canvas.imageLayer.contents != nil,
                    "fullscreen": self.window?.styleMask.contains(.fullScreen) == true,
                    "wallX": self.canvas.wall.frame.origin.x,
                    "wallY": self.canvas.wall.frame.origin.y,
                    "viewportWidth": self.canvas.viewport.frame.width,
                    "viewportHeight": self.canvas.viewport.frame.height]
        }
        engine.onChange = { [weak self] in self?.refresh() }
        canvas.onInteraction = { [weak self] in self?.showControls() }
        keyboardMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, NSApp.keyWindow === self.window else { return event }
            self.showControls()
            if event.keyCode == 53, self.window?.styleMask.contains(.fullScreen) == true { self.window?.toggleFullScreen(nil); return nil }
            return event
        }
        workspaceObservers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.engine.transport.recalibrate(); self?.showControls() } })
        NotificationCenter.default.addObserver(self, selector: #selector(updateDisplays), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        updateDisplays(); refresh()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    private func buildPanel() {
        card.material = .hudWindow; card.blendingMode = .withinWindow; card.state = .active
        card.wantsLayer = true; card.layer?.cornerRadius = 16; card.layer?.masksToBounds = true
        card.translatesAutoresizingMaskIntoConstraints = false
        canvas.addSubview(card)
        let brand = NSTextField(labelWithString: "◫  MOSAIC  /  NATIVE PLAYER")
        brand.font = .systemFont(ofSize: 11, weight: .semibold); brand.textColor = NSColor(red: 0.75, green: 0.69, blue: 1, alpha: 1)
        heading.font = .systemFont(ofSize: 24, weight: .medium); heading.textColor = .white
        summary.font = .systemFont(ofSize: 12); summary.textColor = .secondaryLabelColor; summary.maximumNumberOfLines = 3
        network.font = .systemFont(ofSize: 11); network.textColor = .secondaryLabelColor
        metrics.font = .monospacedDigitSystemFont(ofSize: 10, weight: .regular); metrics.textColor = .secondaryLabelColor
        connectionField.placeholderString = "粘贴后台「设备管理」中的播放链接"
        connectionField.font = .systemFont(ofSize: 12); connectionField.bezelStyle = .roundedBezel
        connectionField.setAccessibilityLabel("设备播放链接"); connectionField.setAccessibilityIdentifier("pairing-link")
        connectButton.target = self; connectButton.action = #selector(connectClicked); connectButton.bezelStyle = .rounded
        connectButton.keyEquivalent = "\r"; connectButton.bezelColor = NSColor(red: 0.42, green: 0.34, blue: 0.91, alpha: 1)
        disconnectButton.target = self; disconnectButton.action = #selector(disconnectClicked); disconnectButton.bezelStyle = .rounded
        fullscreenButton.target = self; fullscreenButton.action = #selector(toggleFullscreen); fullscreenButton.bezelStyle = .rounded
        displayMenu.target = self; displayMenu.action = #selector(moveDisplay); displayMenu.setAccessibilityLabel("播放显示器")
        let hide = NSButton(title: "隐藏面板", target: self, action: #selector(hideControls)); hide.bezelStyle = .rounded
        let connectRow = NSStackView(views: [connectionField, connectButton]); connectRow.orientation = .horizontal; connectRow.spacing = 8
        let setup = NSButton(title: "选择服务器与屏幕…", target: self, action: #selector(configureClicked))
        setup.bezelStyle = .rounded
        let controls = NSStackView(views: [fullscreenButton, displayMenu, disconnectButton, hide]); controls.spacing = 8
        let footnote = NSTextField(labelWithString: "移动鼠标显示面板 · Esc 退出全屏 · ⌘Q 退出")
        footnote.font = .systemFont(ofSize: 10); footnote.textColor = .tertiaryLabelColor
        let stack = NSStackView(views: [brand, heading, summary, network, setup, connectRow, controls, metrics, footnote])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12; stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: canvas.leadingAnchor, constant: 28), card.bottomAnchor.constraint(equalTo: canvas.bottomAnchor, constant: -28),
            card.widthAnchor.constraint(equalToConstant: 570), card.trailingAnchor.constraint(lessThanOrEqualTo: canvas.trailingAnchor, constant: -28),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 24), stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -22),
            summary.widthAnchor.constraint(equalTo: stack.widthAnchor), connectRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            connectionField.widthAnchor.constraint(greaterThanOrEqualToConstant: 350)
        ])
    }
    func accept(_ connection: PlayerConnection) { connectionField.stringValue = ""; showControls(); engine.connect(connection) }
    @objc private func configureClicked() { onConfigure?() }
    @objc private func connectClicked() {
        do { accept(try PlayerConnection(link: connectionField.stringValue)) }
        catch { showError(error.localizedDescription) }
    }
    @objc func disconnectClicked() { engine.disconnect(); onForgetPairing?(); showControls() }
    @objc func toggleFullscreen() { window?.toggleFullScreen(nil) }
    @objc func updateDisplays() {
        displayMenu.removeAllItems()
        for (index, screen) in NSScreen.screens.enumerated() { displayMenu.addItem(withTitle: "\(index + 1) · \(screen.localizedName)") }
        if let screen = window?.screen, let index = NSScreen.screens.firstIndex(of: screen) { displayMenu.selectItem(at: index) }
    }
    @objc private func moveDisplay() {
        let index = displayMenu.indexOfSelectedItem
        guard NSScreen.screens.indices.contains(index), let window else { return }
        if window.styleMask.contains(.fullScreen) { updateDisplays(); showError("请先退出全屏，再选择显示器。"); return }
        let visible = NSScreen.screens[index].visibleFrame
        let size = NSSize(width: min(window.frame.width, visible.width), height: min(window.frame.height, visible.height))
        window.setFrame(NSRect(x: visible.midX - size.width / 2, y: visible.midY - size.height / 2, width: size.width, height: size.height), display: true)
    }
    func showControls() {
        card.isHidden = false; hideTimer?.invalidate()
        guard engine.current != nil else { return }
        hideTimer = Timer(timeInterval: 6, repeats: false) { [weak self] _ in Task { @MainActor in self?.hideControls() } }
        if let hideTimer { RunLoop.main.add(hideTimer, forMode: .common) }
    }
    @objc func hideControls() {
        guard engine.current != nil, engine.status != "error" else { return }
        card.isHidden = true
        if window?.styleMask.contains(.fullScreen) == true { NSCursor.setHiddenUntilMouseMoves(true) }
    }
    func refresh() {
        heading.stringValue = engine.screen.map { "\($0.name) · 第 \($0.row + 1) 行 / 第 \($0.col + 1) 列" } ?? "连接你的屏幕"
        summary.stringValue = engine.detail
        network.stringValue = "\(engine.connected ? "●" : "○") \(engine.networkDetail)"
        network.textColor = engine.connected ? NSColor.systemGreen : .systemOrange
        let rtt = engine.transport.latency.map { String(format: "%.1f ms", $0) } ?? "—"
        let drift = engine.drift.map { String(format: "%.0f ms", abs($0)) } ?? "—"
        metrics.stringValue = "延迟 \(rtt)   ·   偏差 \(drift)   ·   \(engine.power.isActive ? "保持屏幕唤醒" : "系统电源策略")"
        disconnectButton.isEnabled = engine.transport.connection != nil
        connectionField.isHidden = engine.transport.connection != nil
        connectButton.isHidden = engine.transport.connection != nil
        window?.title = engine.screen.map { "Mosaic Player — \($0.name)" } ?? "Mosaic Player"
        if engine.status == "error" || !engine.connected { card.isHidden = false }
        if engine.current == nil {
            card.isHidden = false
            hideTimer?.invalidate()
            hideTimer = nil
        }
        if engine.current != nil, hideTimer == nil { showControls() }
    }
    func showError(_ message: String) {
        let alert = NSAlert(); alert.messageText = "Mosaic Player"; alert.informativeText = message; alert.alertStyle = .warning
        if let window { alert.beginSheetModal(for: window) } else { alert.runModal() }
    }
    func windowDidEnterFullScreen(_ notification: Notification) { fullscreenButton.title = "退出全屏"; showControls() }
    func windowDidExitFullScreen(_ notification: Notification) { fullscreenButton.title = "进入全屏"; showControls() }
    func windowWillClose(_ notification: Notification) { engine.shutdown(); NSApp.terminate(nil) }
}
