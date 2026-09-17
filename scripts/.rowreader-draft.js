  // ── DO THE ROW NUMBERS RECONCILE? ────────────────────────────────────────────
  // Tre, 2026-09-17 on iOS build 903: "that doesnt add up ... current month plus $50 plus next
  // month purchases minus the payment equals October ... it looks incorrect."
  // His own figures: Sep start 212, +50 purchases, no payment, end 262 - which reconciles.
  // Oct start 262, +280 purchases, payment -542, end 280 - and 262 + 280 - 542 = 0, not 280.
  // A row that does not reconcile is the defect; this reads the RENDERED numbers and says so.
  const rows = await page.evaluate(() => {
    const num = (t) => {
      const m = String(t || '').replace(/,/g, '').match(/-?\$([0-9]+(?:\.[0-9]+)?)/);
      return m ? Number(m[1]) : null;
    };
    const MONTH_HEAD = new RegExp('^[A-Z][a-z]{2} [0-9]{4}$');
    const out = [];
    for (const el of [...document.querySelectorAll('div')]) {
      const txt = (el.innerText || '').trim();
      if (!txt) continue;
      const lines = txt.split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 4 || lines.length > 16) continue;
      if (!MONTH_HEAD.test(lines[0])) continue;
      if (!lines.some((l) => l.startsWith('Start:'))) continue;
      const startLine = lines.find((l) => l.startsWith('Start:'));
      const purchLine = lines.find((l) => l.includes('purchases') && l.includes('$'));
      const interestLine = lines.find((l) => l.includes('interest') && l.includes('$'));
      // The payment and the end balance are the row's own two right-hand columns; they appear in
      // the flattened text before the "Start:" detail line.
      const headIdx = lines.findIndex((l) => l.startsWith('Start:'));
      const head = lines.slice(1, headIdx);
      out.push({
        month: lines[0],
        start: num(startLine),
        purchases: purchLine ? num(purchLine) : 0,
        interest: interestLine ? num(interestLine) : 0,
        headCells: head,
        lineCount: lines.length,
      });
    }
    return out;
  });

  console.log('RECONCILIATION — rendered rows:');
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.month} start=${r.start} purchases=${r.purchases} interest=${r.interest} head=${JSON.stringify(r.headCells)} lines=${r.lineCount}`);
  }
