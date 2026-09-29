package com.treforged.forged.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * The optional `nextDebtPayments` rows the app sends since 9ce4ecf2, and the "Next:" line built
 * from them. Same rules as the iOS decoder: a row with no name is dropped, a bad amount becomes
 * "not modelled" and never 0, a bad date becomes "no due date" and never today, and a snapshot
 * WITHOUT the field keeps a null list, because "not sent" is not "no debts".
 *
 * Would-fail checks: default the amount to 0 and `aBadAmountIsNotModelledNotZero` fails; make an
 * absent field an empty list and `anOlderAppBuildIsNotSentNotNoDebts` fails.
 */
public class DebtRowsTest {

    private static final long NOW = 1_800_000_000_000L;

    private static WidgetSnapshot snap(String rows) {
        return WidgetSnapshot.parse("{\"monthEndCash\":100,\"netWorth\":5,\"currency\":\"USD\",\"updatedAtMs\":"
            + NOW + (rows == null ? "" : ",\"nextDebtPayments\":" + rows) + "}");
    }

    @Test
    public void readsTheRowsInTheOrderTheAppSent() {
        WidgetSnapshot s = snap("[{\"name\":\"Car loan\",\"amount\":410,\"dueDate\":\"2026-10-03\"},"
            + "{\"name\":\"Visa\",\"amount\":null,\"dueDate\":null}]");
        assertNotNull(s);
        assertEquals(2, s.nextDebtPayments.size());
        assertEquals("Car loan", s.nextDebtPayments.get(0).name);
        assertEquals(410.0, s.nextDebtPayments.get(0).amount, 0.0001);
        assertEquals("2026-10-03", s.nextDebtPayments.get(0).dueDate);
        assertNull(s.nextDebtPayments.get(1).amount);
        assertNull(s.nextDebtPayments.get(1).dueDate);
    }

    @Test
    public void anOlderAppBuildIsNotSentNotNoDebts() {
        WidgetSnapshot s = snap(null);
        assertNotNull(s);
        assertNull(s.nextDebtPayments);
        assertEquals(0, snap("[]").nextDebtPayments.size());
    }

    @Test
    public void aRowWithNoNameIsDroppedAndTheSnapshotSurvives() {
        WidgetSnapshot s = snap("[{\"amount\":5},{\"name\":\"\"},7,{\"name\":\"Loan\",\"amount\":9}]");
        assertNotNull(s);
        assertEquals(1, s.nextDebtPayments.size());
        assertEquals("Loan", s.nextDebtPayments.get(0).name);
    }

    @Test
    public void aBadAmountIsNotModelledNotZero() {
        WidgetSnapshot s = snap("[{\"name\":\"A\",\"amount\":\"410\"},{\"name\":\"B\"}]");
        assertNull(s.nextDebtPayments.get(0).amount);
        assertNull(s.nextDebtPayments.get(1).amount);
    }

    @Test
    public void aBadDateIsNoDueDateNotToday() {
        WidgetSnapshot s = snap("[{\"name\":\"A\",\"dueDate\":\"2026-13-40\"},{\"name\":\"B\",\"dueDate\":\"Oct 3\"}]");
        assertNull(s.nextDebtPayments.get(0).dueDate);
        assertNull(s.nextDebtPayments.get(1).dueDate);
    }

    @Test
    public void theNextLineIsTheSoonestRowAsTheAppSentIt() {
        assertEquals("Next: Car loan $410 \u00b7 Oct 3", WidgetText.nextDebtLine(
            snap("[{\"name\":\"Car loan\",\"amount\":410,\"dueDate\":\"2026-10-03\"}]")));
        assertEquals("Next: Visa not modelled \u00b7 no due date set", WidgetText.nextDebtLine(
            snap("[{\"name\":\"Visa\"}]")));
        assertNull(WidgetText.nextDebtLine(snap(null)));
        assertNull(WidgetText.nextDebtLine(snap("[]")));
    }
}
