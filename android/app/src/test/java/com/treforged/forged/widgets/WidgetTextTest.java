package com.treforged.forged.widgets;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * The footer and the figure both home-screen widgets print, matching the iOS widget.
 *
 * Would-fail checks: drop the under-a-minute branch and a fresh sync reads "Updated 0 min ago";
 * drop setMinimumFractionDigits and a locale default can print cents the iOS widget does not.
 */
public class WidgetTextTest {

    private static final long NOW = 1_800_000_000_000L;
    private static final long MIN = 60_000L;

    @Test
    public void underAMinuteIsJustNow() {
        assertEquals("Updated just now", WidgetText.updatedText(NOW, NOW - 59_999L));
    }

    @Test
    public void aClockBehindTheAppIsJustNowNotANegativeAge() {
        assertEquals("Updated just now", WidgetText.updatedText(NOW, NOW + 5 * MIN));
    }

    @Test
    public void minutesHoursAndDays() {
        assertEquals("Updated 1 min ago", WidgetText.updatedText(NOW, NOW - MIN));
        assertEquals("Updated 59 min ago", WidgetText.updatedText(NOW, NOW - 59 * MIN));
        assertEquals("Updated 1 hr ago", WidgetText.updatedText(NOW, NOW - 60 * MIN));
        assertEquals("Updated 23 hr ago", WidgetText.updatedText(NOW, NOW - 23 * 60 * MIN));
        assertEquals("Updated 1 day ago", WidgetText.updatedText(NOW, NOW - 24 * 60 * MIN));
        assertEquals("Updated 6 days ago", WidgetText.updatedText(NOW, NOW - 6 * 24 * 60 * MIN));
    }

    @Test
    public void wholeUnitsInTheUsersCurrency() {
        assertEquals("$3,301", WidgetText.formatAmount(3300.6, "USD"));
        assertEquals("-$21,771", WidgetText.formatAmount(-21771, "USD"));
        assertEquals("£3,300", WidgetText.formatAmount(3300, "GBP"));
    }

    @Test
    public void anUnknownOrMissingCurrencyKeepsTheDefaultRatherThanCrash() {
        assertEquals("$12", WidgetText.formatAmount(12, "NOPE"));
        assertEquals("$12", WidgetText.formatAmount(12, null));
    }

    @Test
    public void dueTextUsesTheAppsWordingAndNeverGuessesADay() {
        assertEquals("due Oct 3", WidgetText.dueText("2026-10-03"));
        assertEquals("due Jan 31", WidgetText.dueText("2027-01-31"));
        assertEquals("no due date set", WidgetText.dueText(null));
        assertEquals("no due date set", WidgetText.dueText("2026-13-03"));
        assertEquals("no due date set", WidgetText.dueText("soon"));
    }

    @Test
    public void anUnmodelledPaymentIsNeverZero() {
        assertEquals("Not modelled", WidgetText.debtAmount(null, "USD"));
        assertEquals("$0", WidgetText.debtAmount(0.0, "USD"));
        assertEquals("$410", WidgetText.debtAmount(410.2, "USD"));
    }
}
