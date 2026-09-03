package com.treforged.forged.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * What the widget is allowed to put on someone's home screen.
 *
 * A widget shows a figure without anyone opening the app, so NOBODY OPENS THE APP TO CHECK WHAT
 * THEIR HOME SCREEN ALREADY TOLD THEM. A blank prompts a tap; a wrong number ends the
 * conversation. Every case here is a way this file used to show a confident value it had not read.
 *
 * Would-fail checks: put `optDouble(key, 0)` back and `absentFieldsAreNotZero` fails — that was
 * the live bug, and it made a genuine zero and missing data pixel-identical in gold. Drop the
 * NaN guard and `nanIsRefused` fails; NumberFormat prints NaN happily. Drop `isStale` from the
 * providers and a week-old balance is drawn as if it were current.
 */
public class WidgetSnapshotTest {

    private static final long NOW = 1_800_000_000_000L;

    private static String json(String body) {
        return body;
    }

    @Test
    public void parsesAGenuineSnapshot() {
        WidgetSnapshot s = WidgetSnapshot.parse(json(
            "{\"monthEndCash\":3300.5,\"netWorth\":-21771,\"currency\":\"GBP\",\"updatedAtMs\":" + NOW + "}"));
        assertNotNull(s);
        assertEquals(3300.5, s.monthEndCash, 0.0001);
        assertEquals(-21771, s.netWorth, 0.0001);
        assertEquals("GBP", s.currency);
        assertEquals(NOW, s.updatedAtMs);
    }

    @Test
    public void aGenuineZeroIsKept() {
        // Zero is a real answer and must still be drawn. The bug was never zero itself.
        WidgetSnapshot s = WidgetSnapshot.parse(
            "{\"monthEndCash\":0,\"netWorth\":0,\"currency\":\"USD\",\"updatedAtMs\":" + NOW + "}");
        assertNotNull(s);
        assertEquals(0, s.netWorth, 0.0001);
    }

    @Test
    public void absentFieldsAreNotZero() {
        // THE LIVE BUG: optDouble(key, 0) rendered a partial snapshot as "$0" in confident gold,
        // making a user with no data indistinguishable from one worth nothing.
        assertNull(WidgetSnapshot.parse("{\"monthEndCash\":100,\"updatedAtMs\":" + NOW + "}"));
        assertNull(WidgetSnapshot.parse("{\"netWorth\":100,\"updatedAtMs\":" + NOW + "}"));
        assertNull(WidgetSnapshot.parse("{\"monthEndCash\":1,\"netWorth\":2}"));
    }

    @Test
    public void nanAndInfinityAreRefused() {
        // What a division by a missing denominator looks like. NumberFormat prints them.
        assertNull(WidgetSnapshot.parse(
            "{\"monthEndCash\":\"NaN\",\"netWorth\":1,\"currency\":\"USD\",\"updatedAtMs\":" + NOW + "}"));
        assertNull(WidgetSnapshot.parse(
            "{\"monthEndCash\":1,\"netWorth\":\"Infinity\",\"currency\":\"USD\",\"updatedAtMs\":" + NOW + "}"));
    }

    @Test
    public void malformedOrMissingInputIsNull() {
        assertNull(WidgetSnapshot.parse(null));
        assertNull(WidgetSnapshot.parse("not json at all"));
        assertNull(WidgetSnapshot.parse("{}"));
    }

    @Test
    public void aZeroTimestampIsNotATime() {
        assertNull(WidgetSnapshot.parse(
            "{\"monthEndCash\":1,\"netWorth\":2,\"currency\":\"USD\",\"updatedAtMs\":0}"));
    }

    @Test
    public void currencyDefaultsOnlyWhenAbsent() {
        WidgetSnapshot s = WidgetSnapshot.parse(
            "{\"monthEndCash\":1,\"netWorth\":2,\"updatedAtMs\":" + NOW + "}");
        assertNotNull(s);
        assertEquals("USD", s.currency);
    }

    @Test
    public void freshSnapshotIsTrusted() {
        WidgetSnapshot s = WidgetSnapshot.parse(
            "{\"monthEndCash\":1,\"netWorth\":2,\"currency\":\"USD\",\"updatedAtMs\":" + NOW + "}");
        assertNotNull(s);
        assertFalse(s.isStale(NOW + 60_000L));
    }

    @Test
    public void staleSnapshotIsNotDrawnAsANumber() {
        // Stale is treated as ABSENT, not as a number with a caveat. A timestamp under a figure
        // in full-confidence colour is a caveat nobody reads.
        WidgetSnapshot s = WidgetSnapshot.parse(
            "{\"monthEndCash\":1,\"netWorth\":2,\"currency\":\"USD\",\"updatedAtMs\":" + NOW + "}");
        assertNotNull(s);
        assertTrue(s.isStale(NOW + WidgetSnapshot.STALE_AFTER_MS + 1));
        assertFalse(s.isStale(NOW + WidgetSnapshot.STALE_AFTER_MS - 1));
    }
}
