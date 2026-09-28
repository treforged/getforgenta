import SwiftUI

// The iOS home-screen widget: the iOS half of the contract Android already implements.
//
// The app publishes ONE payload on every platform - `useWidgetSync` -> `buildWidgetPayload`
// (src/lib/widget-snapshot.ts) -> the native `WidgetBridge` plugin. Its fields are
// `monthEndCash`, `netWorth`, `currency` and `updatedAt`: the Dashboard's own `monthEndCash` and
// net worth, so the widget calculates nothing. This file only decodes, checks and displays, and it
// has no WidgetKit import, so the same view renders in the extension and in a Mac design preview.
//
// THE READER REFUSES THREE THINGS, exactly as WidgetSnapshot.java does:
//   - an absent or malformed field (never read as 0 - a real $0 and "never arrived" must differ),
//   - NaN or Infinity,
//   - a snapshot older than 7 days (`WIDGET_STALE_AFTER_MS`), because nobody opens the app to check
//     what their home screen already told them.
// A refused snapshot draws "--" and "Open Forgenta to sync", which is true.
//
// Corner concentricity: nothing inside is a rounded box, so no inner radius meets the system's.

public struct WidgetSnapshot: Equatable {
    public let monthEndCash: Double
    public let netWorth: Double
    public let currency: String
    public let updatedAt: Date

    /// Same value as `WIDGET_STALE_AFTER_MS` in src/lib/widget-snapshot.ts.
    public static let staleAfter: TimeInterval = 7 * 24 * 60 * 60

    public init(monthEndCash: Double, netWorth: Double, currency: String, updatedAt: Date) {
        self.monthEndCash = monthEndCash
        self.netWorth = netWorth
        self.currency = currency
        self.updatedAt = updatedAt
    }

    /// Nil unless every field is present, finite and fresh. Mirrors `WidgetSnapshot.load` + `isStale`.
    public static func decode(json: String?, now: Date) -> WidgetSnapshot? {
        guard let json, let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cash = obj["monthEndCash"] as? Double, cash.isFinite,
              let worth = obj["netWorth"] as? Double, worth.isFinite,
              let iso = obj["updatedAt"] as? String else { return nil }
        let isoParser = ISO8601DateFormatter()
        isoParser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let at = isoParser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
        if now.timeIntervalSince(at) > staleAfter { return nil }
        let cur = (obj["currency"] as? String).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? "USD"
        return WidgetSnapshot(monthEndCash: cash, netWorth: worth, currency: cur, updatedAt: at)
    }

    /// Whole units in the user's own currency. Both fraction bounds are set, because leaving the
    /// minimum to the locale default is how the web chart ticks drifted between ICU builds.
    public func format(_ amount: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: amount)) ?? "--"
    }
}

public enum ForgentaWidgetKind { case monthEndCash, netWorth, both }

enum WidgetPalette {
    // The app's `.dark` tokens (src/index.css), converted from HSL.
    static let background = Color(red: 0.030, green: 0.037, blue: 0.050)  // 222 24% 4%
    static let foreground = Color(red: 0.886, green: 0.910, blue: 0.941)  // 214 32% 91%
    static let muted = Color(red: 0.627, green: 0.627, blue: 0.671)       // 240 4% 64%
    static let gold = Color(red: 0.804, green: 0.643, blue: 0.294)        // 43 56% 52% (--gold)
    static let positive = Color(red: 0.200, green: 0.600, blue: 0.360)   // 142 50% 40% (--success)
    static let negative = Color(red: 0.941, green: 0.431, blue: 0.431)   // 0 73% 66% (--destructive-text)
    static let hairline = Color(red: 0.138, green: 0.150, blue: 0.182)   // 222 14% 16% (--border)
}

public struct ForgentaWidgetView: View {
    let snapshot: WidgetSnapshot?
    let kind: ForgentaWidgetKind
    let now: Date

    public init(snapshot: WidgetSnapshot?, kind: ForgentaWidgetKind, now: Date = Date()) {
        self.snapshot = snapshot
        self.kind = kind
        self.now = now
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch kind {
            case .monthEndCash:
                figure(label: "MONTH-END CASH", value: monthEnd, tone: monthEndTone, size: 30)
            case .netWorth:
                figure(label: "NET WORTH", value: worth, tone: WidgetPalette.gold, size: 30)
            case .both:
                HStack(alignment: .top, spacing: 16) {
                    figure(label: "MONTH-END CASH", value: monthEnd, tone: monthEndTone, size: 30)
                    Rectangle().fill(WidgetPalette.hairline).frame(width: 1, height: 64)
                    figure(label: "NET WORTH", value: worth, tone: WidgetPalette.gold, size: 30)
                }
            }
            Spacer(minLength: 6)
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var monthEnd: String { snapshot.map { $0.format($0.monthEndCash) } ?? "--" }
    private var worth: String { snapshot.map { $0.format($0.netWorth) } ?? "--" }
    private var monthEndTone: Color {
        guard let s = snapshot else { return WidgetPalette.muted }
        return s.monthEndCash >= 0 ? WidgetPalette.positive : WidgetPalette.negative
    }

    private func figure(label: String, value: String, tone: Color, size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 10, weight: .semibold)).kerning(0.8)
                .foregroundStyle(WidgetPalette.muted)
                .lineLimit(1).minimumScaleFactor(0.8)
            Text(value)
                .font(.system(size: size, weight: .bold, design: .rounded))
                .foregroundStyle(snapshot == nil ? WidgetPalette.muted : tone)
                .lineLimit(1).minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var footer: some View {
        HStack(spacing: 0) {
            Text(snapshot == nil ? "Open Forgenta to sync" : updatedText)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(WidgetPalette.muted)
            .lineLimit(1).minimumScaleFactor(0.85)
            // Only the wide size has room for the wordmark; on a small tile it forced the age onto
            // two lines, and the age is the line that tells you whether to trust the figure.
            if kind == .both {
                Spacer(minLength: 0)
                Text("FORGENTA")
                    .font(.system(size: 9, weight: .semibold)).kerning(1.2)
                    .foregroundStyle(WidgetPalette.gold.opacity(0.8))
            }
        }
    }

    /// "Updated 10 min ago" - the same relative age Android prints under its figure.
    private var updatedText: String {
        guard let s = snapshot else { return "" }
        // Under a minute (or a clock a little behind the app's) would print "in 0 sec.".
        if now.timeIntervalSince(s.updatedAt) < 60 { return "Updated just now" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return "Updated \(f.localizedString(for: s.updatedAt, relativeTo: now))"
    }
}
