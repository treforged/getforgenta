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
    let entry: ForgentaEntry
    let small: ForgentaWidgetKind

    var body: some View {
        let view = ForgentaWidgetView(snapshot: entry.snapshot,
                                      kind: family == .systemMedium ? .both : small,
                                      now: entry.date)
        if #available(iOSApplicationExtension 17.0, *) {
            view.containerBackground(WidgetPalette.background, for: .widget)
        } else {
            view.padding(16).background(WidgetPalette.background)
        }
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

@main
struct ForgentaWidgetBundle: WidgetBundle {
    var body: some Widget {
        MonthEndCashWidget()
        NetWorthWidget()
    }
}
