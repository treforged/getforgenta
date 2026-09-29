import WidgetKit
import SwiftUI

// Reads what the app's WidgetBridgePlugin (AppDelegate.swift) wrote into the App Group, and
// nothing else. All refusal rules live in `WidgetSnapshot.decode` (ForgentaWidgetView.swift).

private let appGroup = "group.com.treforged.forged"
private let snapshotKey = "forgenta.widget.snapshot"

struct ForgentaEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct ForgentaProvider: TimelineProvider {
    func placeholder(in context: Context) -> ForgentaEntry {
        ForgentaEntry(date: Date(), snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ForgentaEntry) -> Void) {
        completion(entry(at: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ForgentaEntry>) -> Void) {
        let now = Date()
        let current = entry(at: now)
        // The app reloads timelines whenever it publishes. On our own we only need to wake up at
        // the moment the snapshot turns stale, so "--" replaces a figure that has stopped being true,
        // and hourly so the "Updated ... ago" line keeps moving.
        var next = now.addingTimeInterval(60 * 60)
        if let s = current.snapshot {
            let staleAt = s.updatedAt.addingTimeInterval(WidgetSnapshot.staleAfter + 1)
            if staleAt < next { next = staleAt }
        }
        completion(Timeline(entries: [current], policy: .after(next)))
    }

    private func entry(at now: Date) -> ForgentaEntry {
        let json = UserDefaults(suiteName: appGroup)?.string(forKey: snapshotKey)
        return ForgentaEntry(date: now, snapshot: WidgetSnapshot.decode(json: json, now: now))
    }
}

struct ForgentaWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: ForgentaEntry
    let small: ForgentaWidgetKind

    var body: some View {
        if #available(iOSApplicationExtension 17.0, *) {
            Tinted(entry: entry, kind: kind, scheme: scheme)
        } else {
            let palette = WidgetPalette.forScheme(scheme)
            ForgentaWidgetView(snapshot: entry.snapshot, kind: kind, now: entry.date, palette: palette)
                .padding(16).background(palette.background)
        }
    }

    private var kind: ForgentaWidgetKind { family == .systemMedium && small != .debts ? .both : small }
}

/// iOS 17+: the background is a `containerBackground`, which the system REMOVES on a Liquid Glass
/// clear/tinted home screen, and `widgetRenderingMode` says when that is happening.
@available(iOSApplicationExtension 17.0, *)
private struct Tinted: View {
    @Environment(\.widgetRenderingMode) private var mode
    let entry: ForgentaEntry
    let kind: ForgentaWidgetKind
    let scheme: ColorScheme

    var body: some View {
        let palette = WidgetPalette.forScheme(scheme)
        ForgentaWidgetView(snapshot: entry.snapshot, kind: kind, now: entry.date,
                           palette: palette, tinted: mode != .fullColor)
            .widgetAccentable()
            .containerBackground(palette.background, for: .widget)
    }
}

struct MonthEndCashWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgentaMonthEndCash", provider: ForgentaProvider()) { entry in
            ForgentaWidgetEntryView(entry: entry, small: .monthEndCash)
        }
        .configurationDisplayName("Month-End Cash")
        .description("Your projected cash at the end of this month, from Forgenta.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct NetWorthWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgentaNetWorth", provider: ForgentaProvider()) { entry in
            ForgentaWidgetEntryView(entry: entry, small: .netWorth)
        }
        .configurationDisplayName("Net Worth")
        .description("Your net worth, from Forgenta.")
        .supportedFamilies([.systemSmall])
    }
}

struct DebtPaymentsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgentaDebtPayments", provider: ForgentaProvider()) { entry in
            ForgentaWidgetEntryView(entry: entry, small: .debts)
        }
        .configurationDisplayName("Next Debt Payments")
        .description("Your next debt payments and when they are due, from Forgenta.")
        .supportedFamilies([.systemMedium])
    }
}

@main
struct ForgentaWidgetBundle: WidgetBundle {
    var body: some Widget {
        MonthEndCashWidget()
        NetWorthWidget()
        DebtPaymentsWidget()
    }
}
