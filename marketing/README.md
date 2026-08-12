# Forgenta Marketing Assets

## Folder Structure

```
marketing/
├── campaigns/    ← The six free campaigns: PLAN.md, measurement.md, utm.md, week-01/
├── metrics/      ← counts.csv (gitignored, real figures) + counts.example.csv (the schema)
├── research/     ← FINDINGS.md (aggregate counts); raw/ is gitignored
├── scripts/      ← Everything that runs the above
│   ├── marketing-report.mjs              ← the weekly report
│   ├── register-marketing-report-task.ps1 ← Monday 8 AM scheduled task
│   ├── lib/                              ← marketing-metrics.mjs + its tests
│   └── research/                         ← the Reddit pull and digest
├── social/       ← Platform-specific post images (Instagram, Twitter/X, Reddit, TikTok)
│   ├── ig/       ← 1080x1080 or 1080x1350 for Instagram
│   ├── twitter/  ← 1200x675 for Twitter/X
│   └── tiktok/   ← 1080x1920 for TikTok thumbnails
└── assets/       ← Logos, brand colors, fonts, source files
```

**The one deliberate exception.** The Answer Engine campaign's pages live in
`public/answers/` and its `public/sitemap.xml`, NOT here — they are files the web
server actually serves, and their URL *is* the campaign. Moving them into
`marketing/` would take them off `getforgenta.com/answers/` and there would be
nothing left to rank. Everything that is a plan, a draft, a number or a tool is
under `marketing/`; only the shipped pages sit in `public/`.

## Brand Colors
- Gold:      hsl(43 56% 52%)  — #C4973A
- Background: hsl(0 0% 2%)    — #050505
- Foreground: hsl(214 32% 91%) — #DDE4EE
- Success:   hsl(142 50% 40%) — #34A853
- Crimson:   hsl(0 73% 35%)   — #9B1C1C

## Fonts
- Display: Outfit (headlines)
- Body:    Inter (body copy)

## App Links
- Web:         getforgenta.com
- App Store:   https://apps.apple.com/us/app/forgenta-track-build-wealth/id6762540239
- Google Play: https://play.google.com/store/apps/details?id=com.treforged.getforgenta
