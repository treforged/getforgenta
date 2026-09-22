import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * THE COPY-POINTER GATE - does a sentence that tells a customer WHERE TO GO name a real place?
 *
 * FOUR DEFECTS OF THIS CLASS LANDED IN ONE EVENING (2026-09-18) and every gate in the repo was
 * green through all of them, because none could ask that question: a hint naming
 * "Settings -> Quick Access", which exists nowhere; "Budget Control" for a page now titled
 * "Plan"; "unlimited history" for a limit that does not exist; "Up to 3 linked accounts"
 * against an enforced 10. All four were found by a human reading the screen. This class costs
 * conversions and trust rather than polish - the linked-account one undersold the paid tier
 * threefold AND told free users a feature was absent.
 *
 * SCOPE IS LOCATIONS, NEVER PROSE. Whether a named place EXISTS is decidable and both sides
 * derive from the app. Whether a sentence is TRUE is not buildable, and a gate that tried
 * would be judging English.
 *
 * ⚠️ THE ARROW IS NOT THE SELECTOR, and that is measured rather than assumed. U+2192 occurs
 * 190 times in `src/` and 62 survive comment-stripping; most of even those are DATA FLOW
 * inside code (`surplus above floor -> debt`). A gate asserting "every arrow names a real
 * place" would cry wolf on ~140 legitimate lines - the gate-that-gets-switched-off failure.
 * So a candidate must clear THREE narrowings, each of which drops a measured group:
 *   1. it is a JSX TEXT NODE or a copy prop, not any old string   (2170 strings -> 20 arrows)
 *   2. the arrow has a non-empty segment on BOTH sides            (drops 8 trailing chevrons,
 *      e.g. "Use with your own data ->", which point at nothing and name nothing)
 *   3. its FIRST segment is a known PLACE                         (drops 6 "Lump Sum -> Savings"
 *      transfer-row labels, because "Lump Sum" is not somewhere you can go)
 * That leaves five real navigation pointers, which is a population a gate can judge without
 * ever crying wolf. The third narrowing is DERIVED, not a skip list, so a new data-flow label
 * tomorrow is dropped for the same reason rather than needing an entry.
 *
 * ⚠️ IT DELIBERATELY UNDER-REACHES, AND SAYING SO IS PART OF THE GATE. It cannot see a pointer
 * written without an arrow ("open the Plan tab"), one built by concatenation, or one in a
 * translation file. A gate that misses some real cases and never cries wolf survives; one that
 * catches everything at the cost of noise gets switched off, after which it catches nothing.
 *
 * ⚠️ AND THE VOCABULARY MUST BE WIDE OR IT INVENTS DEFECTS. While building this, an h2-only
 * reading of Settings reported "Settings -> Merchant memory" as naming a section that does not
 * exist. It exists - as an h3 inside `MerchantRulesSettings`. A narrow matcher's zero reads
 * exactly like a real finding, and that false defect was one step from being filed.
 *
 * WHAT IT DOES NOT PROVE: that the place is REACHABLE (only a rendered walk shows that), that
 * the copy is otherwise true, or anything about numbers - `plan-limits.gate.test.ts` owns the
 * limits half.
 */

const REPO = join(__dirname, '..', '..', '..');
const SRC = join(REPO, 'src');
const ARROW = '→';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * Comments are PROSE. The comment explaining a defect quotes the defect in order to refute it,
 * so a gate that cannot tell the two apart punishes documentation - and gets deleted.
 *
 * This stripper is load-bearing in BOTH directions and is controlled below: an over-eager one
 * would empty the corpus and make every assertion here pass for ever.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const FILES = walk(SRC);
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));

// ── THE VOCABULARY, every entry derived from the app ────────────────────────────────────────

/** Top-level destinations a customer can name, from the one nav list both layouts render. */
const NAV_LABELS = [...readFileSync(join(SRC, 'lib/primary-nav.ts'), 'utf8')
  .matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);

/** Page titles - a page is a place even when it is not in the primary nav (e.g. Plan, Settings). */
const PAGE_TITLES: string[] = [];
/** Every heading and tab label anywhere: h1/h2/h3, CardTitle, and `label:` in a tab list. */
const SECTION_LABELS: string[] = [];

for (const [, src] of SOURCES) {
  const clean = stripComments(src);
  for (const m of clean.matchAll(/<h1[^>]*>([^<>{}]+)</g)) PAGE_TITLES.push(m[1].trim());
  for (const m of clean.matchAll(/<h[123][^>]*>([^<>{}]+)</g)) SECTION_LABELS.push(m[1].trim());
  for (const m of clean.matchAll(/<CardTitle[^>]*>([^<>{}]+)</g)) SECTION_LABELS.push(m[1].trim());
  for (const m of clean.matchAll(/label:\s*['"]([^'"]{2,40})['"]/g)) SECTION_LABELS.push(m[1].trim());
  for (const m of clean.matchAll(/<TabsTrigger[^>]*>([^<>{}]+)</g)) SECTION_LABELS.push(m[1].trim());
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Somewhere a customer can BE. The first segment of a real pointer is always one of these. */
const PLACES = new Set([...NAV_LABELS, ...PAGE_TITLES].map(norm));
/** Anything a customer can be pointed AT once they are somewhere. */
const LABELS = new Set([...PLACES, ...SECTION_LABELS.map(norm)]);

/**
 * THE LAST SEGMENT OF A POINTER IS USUALLY A CONTROL, NOT A SECTION, and the first version of
 * this gate had no vocabulary for that - so it reported "Settings -> Danger Zone -> Delete
 * Account" and "Settings -> Account Security -> App lock" as naming places that do not exist.
 * Both were verified by hand to exist: one is a `<p>` label on a button, the other a control's
 * own title. That was the instrument, not the app.
 *
 * So a LEAF may also be any short piece of text the app actually renders. That is a wide set
 * on purpose - the honest question for a leaf is "does a control by this name exist anywhere",
 * and a narrower reading manufactures defects. It is still decidable and it still catches the
 * class: the control below proves a name that exists NOWHERE is rejected by both sets.
 */
const CONTROL_TEXT = new Set<string>();

// ── THE CANDIDATES ──────────────────────────────────────────────────────────────────────────

const TEXT_NODE = new RegExp('>([^<>{}\\n]*[A-Za-z][^<>{}\\n]*)<', 'g');
const COPY_PROP =
  /\b(?:title|description|label|placeholder|message|hint|subtitle|text)\s*[=:]\s*["'`]([^"'`\n]{4,})["'`]/g;

type Pointer = { file: string; line: number; text: string; segments: string[] };

function copyStrings(clean: string): { s: string; at: number }[] {
  const out: { s: string; at: number }[] = [];
  for (const re of [TEXT_NODE, COPY_PROP]) {
    re.lastIndex = 0;
    for (const m of clean.matchAll(re)) {
      const s = m[1].trim();
      if (s.length >= 4) out.push({ s, at: m.index ?? 0 });
    }
  }
  return out;
}

/**
 * A sentence that TELLS somebody to go somewhere. "Manage these in X", "adjust later under X".
 * This is the other half of narrowing 3 and it is what makes the gate able to catch a WRONG
 * FIRST SEGMENT - see the comment on `pointerFrom`.
 */
const NAV_LEAD = /\b(?:in|under|from|via|go to|open|head to)\s+\S/i;

/** A navigation pointer, after all three narrowings. */
function pointerFrom(s: string): string[] | null {
  const arrowAt = s.indexOf(ARROW);
  if (arrowAt < 0) return null;
  const raw = s.split(ARROW);
  const segments = raw.map((p) =>
    // Trim the sentence around the path: keep the last clause before, the first after.
    p.replace(/[.,;:!?]+$/, '').replace(/^.*?\b(?:in|under|from|to|at|via)\b\s+/i, '').trim(),
  );
  // Narrowing 2: a trailing arrow points at nothing - it is a chevron, not a pointer.
  if (segments.some((p) => p === '')) return null;

  /**
   * Narrowing 3, and it is a UNION of two tests rather than one.
   *
   * The obvious test - "the first segment is a known place" - has a hole this gate was one
   * commit from shipping with: it cannot tell "not a place because this is a transfer label"
   * from "NOT A PLACE BECAUSE THE NAME IS WRONG", and silently drops both. The live defect
   * this gate was written to catch ("adjust later under Activity -> Plan", where Activity is
   * a name Tre retired on 2026-08-27) would have been DROPPED, not flagged.
   *
   * So a candidate also qualifies when the words immediately before the path TELL the reader
   * to go there. "Lump Sum -> Savings" is a bare table label and still drops out; "under
   * Activity -> Plan" is caught, and caught on the segment that is actually wrong.
   */
  const isNavigational = PLACES.has(norm(segments[0])) || NAV_LEAD.test(raw[0]);
  if (!isNavigational) return null;
  return segments;
}

const POINTERS: Pointer[] = [];
for (const [file, src] of SOURCES) {
  const clean = stripComments(src);
  const rel = relative(REPO, file).replace(/\\/g, '/');
  for (const { s, at } of copyStrings(clean)) {
    if (s.length <= 40) CONTROL_TEXT.add(norm(s));
    const segments = pointerFrom(s);
    if (segments) POINTERS.push({ file: rel, line: clean.slice(0, at).split('\n').length, text: s, segments });
  }
}

/** A leaf is satisfied by a section OR by a control the app actually renders. */
const leafExists = (seg: string) => LABELS.has(norm(seg)) || CONTROL_TEXT.has(norm(seg));

// ── POSITIVE CONTROLS, all of them before any assertion of absence ──────────────────────────

describe('copy pointers - positive controls', () => {
  it('the sweep reached the source tree', () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('the vocabulary is populated on every axis', () => {
    expect(NAV_LABELS.length).toBeGreaterThan(3);
    expect(PAGE_TITLES.length).toBeGreaterThan(5);
    expect(SECTION_LABELS.length).toBeGreaterThan(20);
  });

  it('the vocabulary contains places and labels known to exist', () => {
    expect(PLACES.has('transactions')).toBe(true);
    expect(PLACES.has('settings')).toBe(true);
    expect(PLACES.has('plan')).toBe(true);
    // An h3 inside a component, not an h2 on the page - the exact case a narrow reading missed.
    expect(LABELS.has('merchant memory')).toBe(true);
    expect(LABELS.has('danger zone')).toBe(true);
  });

  it('the vocabulary does NOT contain a name the app deliberately stopped using', () => {
    // Tre renamed Activity to Transactions on 2026-08-27. If this ever starts passing as a
    // place, the rename has been undone and the gate below would stop catching it.
    expect(PLACES.has('activity')).toBe(false);
  });

  it('the comment stripper REDUCES without emptying', () => {
    let raw = 0;
    let stripped = 0;
    for (const [, src] of SOURCES) {
      raw += src.split(ARROW).length - 1;
      stripped += stripComments(src).split(ARROW).length - 1;
    }
    expect(raw).toBeGreaterThan(stripped);
    expect(stripped).toBeGreaterThan(0);
  });

  it('the narrowings each drop what they are meant to drop', () => {
    expect(pointerFrom('Use with your own data ' + ARROW)).toBeNull();          // chevron
    expect(pointerFrom('Lump Sum ' + ARROW + ' Savings')).toBeNull();           // data flow
    expect(pointerFrom('Settings ' + ARROW + ' Danger Zone')).not.toBeNull();   // real pointer
  });

  /**
   * The hole this gate was one commit from shipping with. A pointer whose FIRST segment is
   * wrong is not a place, so the place-only narrowing dropped it silently - and that is the
   * exact live defect this gate was written for. The navigation phrase catches it, on the
   * segment that is actually wrong.
   */
  it('catches a WRONG FIRST SEGMENT, not just a wrong section', () => {
    const bad = pointerFrom('you can adjust later under Activity ' + ARROW + ' Plan.');
    expect(bad).not.toBeNull();
    expect(bad?.[0]).toBe('Activity');
    expect(LABELS.has('activity')).toBe(false);
  });

  /**
   * CONTROL_TEXT is a WIDE set, so it invites the question "does this still reject anything?".
   * "Quick Access" is the real 2026-09-18 defect: a hint pointed at
   * "Settings -> Quick Access", which existed nowhere. It must be absent from EVERY vocabulary,
   * or this gate could not have caught the defect it was built for.
   */
  it('a name that exists nowhere is rejected by every vocabulary', () => {
    expect(PLACES.has('quick access')).toBe(false);
    expect(LABELS.has('quick access')).toBe(false);
    expect(CONTROL_TEXT.has('quick access')).toBe(false);
    expect(leafExists('Quick Access')).toBe(false);
  });

  it('the widened leaf set still accepts the controls that DO exist', () => {
    expect(leafExists('Delete Account')).toBe(true);
    expect(leafExists('App lock')).toBe(true);
  });

  it('the sweep actually found the real pointers in the app', () => {
    expect(POINTERS.length).toBeGreaterThan(0);
    expect(POINTERS.some((p) => norm(p.segments[0]) === 'settings')).toBe(true);
  });
});

// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────

describe('copy pointers - every named place is real', () => {
  it('names only places and sections that exist in the app', () => {
    const broken = POINTERS.flatMap((p) =>
      p.segments
        // Every segment but the LAST must be a place or a section. The last may also be a
        // control the app renders - see CONTROL_TEXT for why.
        .filter((seg, i) =>
          i === p.segments.length - 1 ? !leafExists(seg) : !LABELS.has(norm(seg)))
        .map((seg) => `${p.file}:${p.line}  names "${seg}" - no such place: ${p.text}`),
    );
    expect(broken).toEqual([]);
  });
});
