# Animation evidence — 2026-08-12

Playwright screen recordings from the session that shipped
`feat(ui): adopt Motion properly, and make it honour reduced motion` (`dd68c48f`, merged as
**#95**). The recordings were left untracked when that branch was committed; this directory is
them catching up, not new work.

**All ten recordings are DEMO MODE.** Confirmed by decoding frames, not assumed: every one carries
the `DEMO` badge, "Jordan's finances", and "All data is fictional and resets when you close the
tab". No real balance, account or transaction appears in any of them — which is what makes them
safe to commit to a public repo.

## What is here

Two folders, the same runs with `prefers-reduced-motion` off and on — the comparison is the point,
since the commit's central claim is that motion is *honoured*, not merely present.

| folder | meaning |
|---|---|
| `motion-on/` | default, animations run |
| `motion-reduced/` | `prefers-reduced-motion: reduce` |

Five recordings each, in two shapes:

| viewport | duration | what it reaches |
|---|---|---|
| 1440×1000 (2 per folder) | ~8–10 s | signs into demo, navigates to **`/builds`** — the `CountUp` surface (`TOTAL BUDGET $12,221`) and the `ContentTransition` skeleton cross-fade |
| 900×900 (3 per folder) | ~21.9 s | Dashboard / Command Center only; does not navigate |

⚠️ **The 900×900 recordings are the weak half of this evidence.** Sampled across their full length
they stay on the Command Center, so they do not exercise the surfaces `dd68c48f` actually changed
(`CountUp`, `ContentTransition`, `MaintenanceLog` row enter/exit). The desktop pair is the one that
demonstrates the feature.

File names are Playwright's content hashes and carry no meaning; the folder and dimensions are the
only index, which is why this file exists.

## Viewing

The `.webm` files are VP8. A `file://` load in Chromium will report `duration: null` and refuse to
seek — that is the browser blocking it, not corruption. Serve the directory over HTTP **with byte
range support**; without `206` responses the video element pins at `currentTime = 0` and every
"sample" silently returns the first frame.
