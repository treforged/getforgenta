# The transfer collapse was shipped, closed, and never actually looked at

#100 merged the transfer-pairing slice and the card in "Runs to close" was
closed on its detector evidence: 62 pairs on the live DB, the July figure
corroborated by a raw join, 1103 tests green. All of that was real.

**None of it was evidence about the render**, and the run that reported it said
so plainly — it had no browser tooling, so "Bank Activity renders a pair as one
row" had its data half proven and its pixels unproven. That sentence sat in the
report and the card was closed over it.

Two things were true underneath it:

- **No test rendered `BankActivity` at all.** The detector has 21 tests
  including a "the shapes the UI reads" group; `planLedgerImport` refuses a
  paired leg under test. The layer that turns those shapes into one row had
  zero coverage.
- **The collapse rule was inline in a `useMemo`** in a 1203-line component,
  which is why it had none. It is four lines and it carries the one edge that
  makes the feature more than de-duplication.

## What landed

- **`collapseTransferLegs(shown, pairByLeg)` moved into
  `transfer-pair-detection.ts`**, next to `indexPairsByLeg` and
  `describeTransfer` — the other two "shapes the UI reads". `BankActivity` calls
  it and keeps a three-line comment pointing at the rule rather than restating
  it. No behaviour change; it is the same four lines.
- **Nine tests on it**, 1103 → 1111. The one that matters is
  **`KEEPS a lone inflow leg when a filter has taken the outflow off screen`**:
  the two legs are on different accounts *by construction*, so every account
  filter separates them, and a collapse that ran unconditionally would delete a
  real bank row from the only account list it appears in. The others pin
  order-independence, multiple movements, non-mutation, and the empty-index
  no-op — a detector that found nothing must hide nothing.

## Looked at, finally

`/transactions` → Bank Activity, on `localhost:8080` signed in as Tre, against
**this branch**, so the extraction is proven not to change what draws.

- The panel reads **"36 movements between your own accounts"** — the undecided
  subset of the 62, pre-checked, under one **"Record 36 transfers"** button.
  Every case the original card named is in the list: $941 / $725 / $83 / $350 /
  $45 / $200, and the $5,038 on 2026-06-21 as `Discover it Card → Prime Visa`.
- The $941.01 autopay is **ONE row**: `TOTAL CHECKING → Prime Visa`,
  `2026-08-10 → 2026-08-07 · moved between your accounts`, `$941` in neutral
  foreground — not red, not green.
- **The rows either side are the control.** Jdp Motorsports (`-$225`) and CFX
  (`-$10`) both carry a category dropdown and **"Add to my ledger"**. The
  transfer between them carries neither. It says *"pays Prime Visa — a card
  payment is not spending, so it takes no category"* and offers
  **"Record — one movement"** and **"Link to a Prime Visa payment"**.

Screenshot in the PR.

## Still open

- **The panel count and the queue count are different numbers and both are
  right** — 36 movements undecided against 62 detected across all history. That
  is not a bug, but nothing on screen explains the gap, and the next person to
  compare them against the handoff's "62" will think one of them is broken.
- **`recordableTransfers` is still untested and still inline.** It is the other
  half of the batch — which movements the pre-checked list would actually write
  — and it is entangled with `reviewsByTxn` and `untickedTransfers`, so it is a
  bigger extraction than this one. Left deliberately.
- The lesson, for the record: **a report that names its own unproven half should
  not be closed on the proven half.** The run was honest about the gap; the
  close was what skipped it.
