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

/// One row of the Dashboard's Debt Recommendations card. `amount` nil = "Not modelled",
/// `dueDate` nil = "no due date set" - the app's own wording for each, never a 0 or a guess.
public struct DebtPayment: Equatable {
    public let name: String
    public let amount: Double?
    /// The user's local calendar day, as the app wrote it (YYYY-MM-DD).
    public let dueDate: DateComponents?
}

public struct WidgetSnapshot: Equatable {
    public let monthEndCash: Double
    public let netWorth: Double
    public let currency: String
    public let updatedAt: Date
    /// Nil when the app did not send the list (an older app build), which is not "no debts".
    public var nextDebtPayments: [DebtPayment]? = nil

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
        var snap = WidgetSnapshot(monthEndCash: cash, netWorth: worth, currency: cur, updatedAt: at)
        if let rows = obj["nextDebtPayments"] as? [[String: Any]] {
            snap.nextDebtPayments = rows.compactMap(decodeDebt)
        }
        return snap
    }

    /// A row with no name is dropped; a non-finite amount becomes "not modelled", never 0; a date
    /// that is not a real YYYY-MM-DD becomes "no due date", never today.
    static func decodeDebt(_ row: [String: Any]) -> DebtPayment? {
        guard let name = row["name"] as? String, !name.isEmpty else { return nil }
        let amount = (row["amount"] as? Double).flatMap { $0.isFinite ? $0 : nil }
        var due: DateComponents? = nil
        if let str = row["dueDate"] as? String {
            let parts = str.split(separator: "-").compactMap { Int($0) }
            if parts.count == 3, (1...12).contains(parts[1]), (1...31).contains(parts[2]) {
                due = DateComponents(year: parts[0], month: parts[1], day: parts[2])
            }
        }
        return DebtPayment(name: name, amount: amount, dueDate: due)
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

public enum ForgentaWidgetKind { case monthEndCash, netWorth, both, debts }

/// The app's own theme tokens (src/index.css), converted from HSL exactly - `.dark` and `:root`.
public struct WidgetPalette {
    public let background, foreground, muted, gold, positive, negative, hairline: Color

    public static let dark = WidgetPalette(
        background: Color(red: 0.030, green: 0.036, blue: 0.050),  // 222 24% 4%
        foreground: Color(red: 0.881, green: 0.906, blue: 0.939),  // 214 32% 91%
        muted: Color(red: 0.626, green: 0.626, blue: 0.654),       // 240 4% 64%
        gold: Color(red: 0.789, green: 0.636, blue: 0.251),        // 43 56% 52%
        positive: Color(red: 0.200, green: 0.600, blue: 0.347),    // 142 50% 40%
        negative: Color(red: 0.908, green: 0.412, blue: 0.412),    // 0 73% 66%
        hairline: Color(red: 0.138, green: 0.151, blue: 0.182))    // 222 14% 16%

    public static let light = WidgetPalette(
        background: Color(red: 1.000, green: 1.000, blue: 1.000),  // --card 0 0% 100%
        foreground: Color(red: 0.120, green: 0.120, blue: 0.120),  // 0 0% 12%
        muted: Color(red: 0.361, green: 0.361, blue: 0.399),       // 240 5% 38%
        gold: Color(red: 0.482, green: 0.367, blue: 0.078),        // 43 72% 28%
        positive: Color(red: 0.135, green: 0.465, blue: 0.256),    // 142 55% 30%
        negative: Color(red: 0.722, green: 0.118, blue: 0.118),    // 0 72% 42%
        hairline: Color(red: 0.850, green: 0.850, blue: 0.850))    // 0 0% 85%

    public static func forScheme(_ scheme: ColorScheme) -> WidgetPalette { scheme == .dark ? dark : light }
}

public struct ForgentaWidgetView: View {
    let snapshot: WidgetSnapshot?
    let kind: ForgentaWidgetKind
    let now: Date
    let palette: WidgetPalette
    /// True on a Liquid Glass clear or tinted home screen (WidgetKit `.accented` / `.vibrant`). The
    /// system then owns the colour, so the view hands it plain primary/secondary content: our
    /// green/red/gold would be flattened to one tint anyway, and a fixed dark fill would sit as an
    /// opaque slab on glass.
    let tinted: Bool

    public init(snapshot: WidgetSnapshot?, kind: ForgentaWidgetKind, now: Date = Date(),
                palette: WidgetPalette = .dark, tinted: Bool = false) {
        self.snapshot = snapshot
        self.kind = kind
        self.now = now
        self.palette = palette
        self.tinted = tinted
    }

    private var labelStyle: AnyShapeStyle { tinted ? AnyShapeStyle(.secondary) : AnyShapeStyle(palette.muted) }
    private func figureStyle(_ c: Color) -> AnyShapeStyle { tinted ? AnyShapeStyle(.primary) : AnyShapeStyle(c) }

    public var body: some View {
        Group {
            switch kind {
            case .monthEndCash:
                single(label: "MONTH-END CASH", value: monthEnd, tone: monthEndTone, detail: nextDebtLine)
            case .netWorth:
                single(label: "NET WORTH", value: worth, tone: palette.gold,
                       detail: snapshot.map { "Month-end cash \($0.format($0.monthEndCash))" })
            case .both:
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top, spacing: 16) {
                        figure(label: "MONTH-END CASH", value: monthEnd, tone: monthEndTone, size: 34)
                        Rectangle().fill(tinted ? AnyShapeStyle(.tertiary) : AnyShapeStyle(palette.hairline))
                            .frame(width: 1, height: 64)
                        figure(label: "NET WORTH", value: worth, tone: palette.gold, size: 34)
                    }
                    // The figures are the point of the widget; without priority the stack hands the
                    // spare width to the spacers and minimumScaleFactor shrinks the numbers to fit.
                    .layoutPriority(1)
                    Spacer(minLength: 8)
                    if let line = nextDebtLine { strip(line) }
                    Spacer(minLength: 6)
                    footer
                }
            case .debts:
                VStack(alignment: .leading, spacing: 0) {
                    debtList
                    Spacer(minLength: 4)
                    footer
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// The small-widget pattern of the system and finance apps: label on top, the figure large and
    /// anchored low, one line of context under it, and the age last. No dead middle.
    private func single(label: String, value: String, tone: Color, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.system(size: 11, weight: .semibold)).kerning(0.8)
                .foregroundStyle(labelStyle)
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 4)
            Text(value)
                .font(.system(size: 40, weight: .bold, design: .rounded))
                .foregroundStyle(snapshot == nil ? labelStyle : figureStyle(tone))
                .lineLimit(1).minimumScaleFactor(0.45)
            if let detail {
                Text(detail)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tinted ? AnyShapeStyle(.primary) : AnyShapeStyle(palette.foreground.opacity(0.85)))
                    .lineLimit(2).minimumScaleFactor(0.85)
                    .padding(.top, 2)
            }
            Spacer(minLength: 6)
            footer
        }
    }

    /// "Next: Car loan $410 · Oct 3" - the soonest row of the app's own debt list, or nil.
    private var nextDebtLine: String? {
        guard let s = snapshot, let first = s.nextDebtPayments?.first else { return nil }
        let amount = first.amount.map { s.format($0) } ?? "not modelled"
        return "Next: \(first.name) \(amount) · \(dueText(first.dueDate).replacingOccurrences(of: "due ", with: ""))"
    }

    private func strip(_ text: String) -> some View {
        HStack(spacing: 6) {
            Rectangle().fill(tinted ? AnyShapeStyle(.secondary) : AnyShapeStyle(palette.gold)).frame(width: 3, height: 16)
            Text(text)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tinted ? AnyShapeStyle(.primary) : AnyShapeStyle(palette.foreground))
                .lineLimit(1).minimumScaleFactor(0.8)
        }
    }

    // MARK: next debt payments

    private var debtList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("NEXT DEBT PAYMENTS")
                .font(.system(size: 10, weight: .semibold)).kerning(0.8)
                .foregroundStyle(labelStyle)
            if let s = snapshot, let rows = s.nextDebtPayments {
                if rows.isEmpty {
                    Text("No debt payments due.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(labelStyle)
                } else {
                    ForEach(Array(rows.prefix(3).enumerated()), id: \.offset) { _, row in
                        debtRow(row, s)
                    }
                }
            } else {
                Text("--")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(labelStyle)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The name gets the whole row width: sharing a line with the amount cut "Chase Freedom" to
    /// "Chase Fr..." on the small widget (CI host render, run 36507002652). The amount sits on the
    /// due-date line instead, still right-aligned and gold.
    private func debtRow(_ row: DebtPayment, _ s: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(row.name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tinted ? AnyShapeStyle(.primary) : AnyShapeStyle(palette.foreground))
                .lineLimit(1).minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(dueText(row.dueDate))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(labelStyle)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(row.amount.map { s.format($0) } ?? "Not modelled")
                    .font(.system(size: row.amount == nil ? 10 : 14, weight: .bold, design: .rounded))
                    .foregroundStyle(row.amount == nil ? labelStyle : figureStyle(palette.gold))
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
        }
    }

    /// "due Oct 3" / "no due date set" - the app's own `formatNextDue` wording.
    private func dueText(_ c: DateComponents?) -> String {
        guard let c, let date = Calendar.current.date(from: c) else { return "no due date set" }
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        return "due \(f.string(from: date))"
    }

    private var monthEnd: String { snapshot.map { $0.format($0.monthEndCash) } ?? "--" }
    private var worth: String { snapshot.map { $0.format($0.netWorth) } ?? "--" }
    private var monthEndTone: Color {
        guard let s = snapshot else { return palette.muted }
        return s.monthEndCash >= 0 ? palette.positive : palette.negative
    }

    private func figure(label: String, value: String, tone: Color, size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 10, weight: .semibold)).kerning(0.8)
                .foregroundStyle(labelStyle)
                .lineLimit(1).minimumScaleFactor(0.8)
            Text(value)
                .font(.system(size: size, weight: .bold, design: .rounded))
                .foregroundStyle(snapshot == nil ? labelStyle : figureStyle(tone))
                .lineLimit(1).minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var footer: some View {
        HStack(spacing: 0) {
            Text(snapshot == nil ? "Open Forgenta to sync" : updatedText)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(labelStyle)
            .lineLimit(1).minimumScaleFactor(0.85)
            // Only the wide size has room for the wordmark; on a small tile it forced the age onto
            // two lines, and the age is the line that tells you whether to trust the figure.
            if kind == .both {
                Spacer(minLength: 0)
                Text("FORGENTA")
                    .font(.system(size: 9, weight: .semibold)).kerning(1.2)
                    .foregroundStyle(tinted ? AnyShapeStyle(.secondary) : AnyShapeStyle(palette.gold.opacity(0.8)))
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
