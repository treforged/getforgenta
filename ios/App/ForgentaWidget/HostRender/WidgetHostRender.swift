import SwiftUI

// CI-ONLY HOST RENDER of the home-screen widget (ask ef0dc559, item 2).
//
// simctl cannot place a widget on a simulator home screen, so this tiny app draws the REAL
// `ForgentaWidgetView` (compiled from ../ForgentaWidgetView.swift, fed through the REAL
// `WidgetSnapshot.decode`) at widget sizes, and `.github/workflows/ios-sim-screenshots.yml`
// screenshots it. It is NOT in the Xcode project and never ships: the workflow compiles it
// with swiftc. What it proves: the view renders and the decoder accepts the fixture. What it
// does NOT prove: the home screen, the system's containerBackground, or Liquid Glass tinting.
//
// Launch with `-palette light` or `-palette dark` (default dark); one palette per screenshot.

@main
struct WidgetHostRenderApp: App {
    var body: some Scene {
        WindowGroup {
            HostScreen()
        }
    }
}

struct HostScreen: View {
    let snap: WidgetSnapshot?
    let paletteName: String
    let palette: WidgetPalette

    init() {
        let now = Date()
        let updatedAt = ISO8601DateFormatter().string(from: now)
        let json = """
        {"monthEndCash": 1842.5, "netWorth": -12640, "currency": "USD", "updatedAt": "\(updatedAt)",
         "nextDebtPayments": [{"name": "Chase Freedom", "amount": 85, "dueDate": "2026-10-03"},
                              {"name": "Discover it", "amount": null, "dueDate": "2026-10-11"}]}
        """
        snap = WidgetSnapshot.decode(json: json, now: now)
        let args = ProcessInfo.processInfo.arguments
        let picked = args.firstIndex(of: "-palette").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
        paletteName = picked == "light" ? "light" : "dark"
        palette = paletteName == "light" ? .light : .dark
        // The workflow reads this back, so a decoder that refuses the fixture fails the job
        // instead of producing a screenshot of "--" tiles that nobody reads closely.
        let status = "palette=\(paletteName) decode=\(snap == nil ? "failed" : "ok") debts=\(snap?.nextDebtPayments?.count ?? -1)\n"
        if let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            try? status.write(to: docs.appendingPathComponent("host-status.txt"), atomically: true, encoding: .utf8)
        }
    }

    var body: some View {
        VStack(spacing: 12) {
            Text("HOST RENDER - not a home screen").font(.caption.bold())
            Text("\(paletteName) palette - fixture \(snap == nil ? "DECODE FAILED" : "decoded")").font(.caption2)
            HStack(spacing: 12) {
                tile(.monthEndCash, snapshot: snap, medium: false)
                tile(.netWorth, snapshot: snap, medium: false)
            }
            HStack(alignment: .top, spacing: 12) {
                tile(.debts, snapshot: snap, medium: false)
                VStack(spacing: 4) {
                    tile(.monthEndCash, snapshot: nil, medium: false)
                    Text("refused snapshot").font(.caption2)
                }
            }
            tile(.both, snapshot: snap, medium: true)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.gray.opacity(0.25))
    }

    func tile(_ kind: ForgentaWidgetKind, snapshot: WidgetSnapshot?, medium: Bool) -> some View {
        ForgentaWidgetView(snapshot: snapshot, kind: kind, palette: palette)
            .padding(16)
            .frame(width: medium ? 338 : 158, height: 158)
            .background(palette.background)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}
