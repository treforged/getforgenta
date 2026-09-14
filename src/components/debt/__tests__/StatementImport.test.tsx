// @vitest-environment jsdom
//
// PASTING A STATEMENT, AND WHAT THE PRESS ACTUALLY WRITES.
//
// Tre, 2026-09-12: "make a feature where users can add or upload a statement that can be auto
// scanned for pulling statement balance, interest saving balance, any payment plans, or anything
// like that that can be auto added into their account for them."
//
// ⚠️ "AUTO ADDED" MEANS THEY DO NOT HAVE TO TYPE FOUR NUMBERS — NOT THAT BALANCES CHANGE BEHIND
// THEM. These figures land on money rows the payoff engine plans against, so the cases below assert
// that nothing is written until the press, that BOTH the old and new figures are shown first, and
// that a field the statement did not state is absent from the patch rather than sent as a zero.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
// ⚠️ THE EXTRACTOR IS MOCKED AND THAT LIMIT IS REAL. jsdom cannot decode a PDF — no worker, no
// canvas — so what these cases prove is the WIRING: that a chosen file reaches the extractor, that
// its text lands in the textarea the person can see and correct, and that a failure is shown rather
// than swallowed. They prove nothing about pdf.js's own decoding.
const pdf = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock('@/lib/pdf-text', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pdf-text')>('@/lib/pdf-text');
  return { ...actual, extractPdfText: pdf.extract };
});

import { StatementImport } from '../StatementImport';

/** Sam's real extraction from the Prime Visa PDF, in the shape the parser reads. */
const STATEMENT = `
New Balance                      $8,189.99
Interest Saving Balance          $1,451.88
Minimum Payment Due              $773.05
Total Plans Payment Due          $198.83
Equal Pay Promo                  0.00%
Purchase APR                     27.24%
`;

const CARD = {
  id: 'card-1',
  name: 'Prime Visa',
  statement_balance: 2000,
  min_payment: 40,
  installment_balance: null,
  installment_monthly_payment: null,
};

const onApply = vi.fn();
const onClose = vi.fn();

const paste = (text: string) =>
  fireEvent.change(screen.getByLabelText('Statement text'), { target: { value: text } });

beforeEach(() => {
  onApply.mockReset().mockResolvedValue({});
  onClose.mockReset();
  pdf.extract.mockReset().mockResolvedValue(STATEMENT);
});

/** A File the picker will accept. Its bytes are never read — the extractor is mocked. */
const pdfFile = () => new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' });

function choose(file: File) {
  const input = screen.getByLabelText('Statement PDF') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}
afterEach(cleanup);

const renderIt = () =>
  render(<StatementImport card={CARD} onApply={onApply} onClose={onClose} />);

describe('before anything is pasted', () => {
  it('⚠️ WRITES NOTHING, and says there is nothing to apply', () => {
    renderIt();
    fireEvent.click(screen.getByText('Nothing to apply yet'));
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('with a real statement pasted', () => {
  it('shows the interest-saving balance it found, beside what the card holds now', () => {
    renderIt();
    paste(STATEMENT);
    // BOTH figures before the press — a row showing only the new number has not said what it is
    // replacing, on a value the payoff plan is built from.
    expect(screen.getByText('$1,451.88')).toBeTruthy();
    expect(screen.getByText('$2,000.00')).toBeTruthy();
  });

  it('reports the promo without applying it', () => {
    renderIt();
    paste(STATEMENT);
    expect(screen.getByText(/Equal Pay Promo at 0%/)).toBeTruthy();
    expect(screen.getByText(/not applied automatically/)).toBeTruthy();
  });

  it('⚠️ STILL WRITES NOTHING UNTIL THE PRESS', () => {
    renderIt();
    paste(STATEMENT);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies exactly the four columns the statement stated', async () => {
    renderIt();
    paste(STATEMENT);
    fireEvent.click(screen.getByText(/^Apply 4 figures$/));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledWith({
      statement_balance: 1451.88,
      min_payment: 773.05,
      installment_balance: 6738.11,
      installment_monthly_payment: 198.83,
    });
  });

  it('closes once the write has landed, not before', async () => {
    renderIt();
    paste(STATEMENT);
    fireEvent.click(screen.getByText(/^Apply 4 figures$/));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('what it refuses', () => {
  it('⚠️ SAYS IT DID NOT RECOGNISE THE TEXT, rather than showing an empty list', () => {
    // An empty list reads as "the statement said nothing", which needs a different response from
    // the person than "this could not read it".
    renderIt();
    paste('Dear customer, thank you for banking with us.');
    expect(screen.getByText(/Nothing recognisable found/)).toBeTruthy();
    expect(screen.getByText('Nothing to apply yet')).toBeTruthy();
  });

  it('⚠️ OMITS A FIELD THE STATEMENT DID NOT STATE — never sends it as 0', async () => {
    // A patch carrying `min_payment: 0` would erase a real minimum with a figure no statement gave.
    renderIt();
    paste('New Balance   $420.00');
    fireEvent.click(screen.getByText(/^Apply 1 figure$/));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledWith({ statement_balance: 420 });
  });

  it('stays open when the write fails, so the figures are not lost', async () => {
    onApply.mockRejectedValue(new Error('network'));
    renderIt();
    paste(STATEMENT);
    fireEvent.click(screen.getByText(/^Apply 4 figures$/));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('uploading a PDF is a second door into the same parser', () => {
  it('puts the extracted text into the textarea the person can see and correct', async () => {
    renderIt();
    choose(pdfFile());
    await waitFor(() =>
      expect((screen.getByLabelText('Statement text') as HTMLTextAreaElement).value).toContain('Interest Saving Balance'),
    );
  });

  it('finds the same figures a paste would — one parser, two doors', async () => {
    renderIt();
    choose(pdfFile());
    await waitFor(() => expect(screen.getByText('$1,451.88')).toBeTruthy());
    fireEvent.click(screen.getByText(/^Apply 4 figures$/));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledWith({
      statement_balance: 1451.88,
      min_payment: 773.05,
      installment_balance: 6738.11,
      installment_monthly_payment: 198.83,
    });
  });

  it('⚠️ STILL WRITES NOTHING ON ITS OWN — a file changes the text, not the card', async () => {
    renderIt();
    choose(pdfFile());
    await waitFor(() => expect(pdf.extract).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('⚠️ SHOWS WHY A FILE COULD NOT BE READ, rather than looking like an empty statement', async () => {
    const { PdfReadError } = await vi.importActual<typeof import('@/lib/pdf-text')>('@/lib/pdf-text');
    pdf.extract.mockRejectedValue(new PdfReadError('That PDF is password protected. Open it and paste the text instead.'));
    renderIt();
    choose(pdfFile());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/password protected/);
  });

  it('⚠️ LETS THE SAME FILE BE PICKED AGAIN AFTER A FAILURE — the control', async () => {
    // A file input does not fire `change` for an identical value, so without clearing it a retry is
    // silently ignored and the button reads as dead.
    const { PdfReadError } = await vi.importActual<typeof import('@/lib/pdf-text')>('@/lib/pdf-text');
    pdf.extract.mockRejectedValueOnce(new PdfReadError('That file could not be read as a PDF.'));
    renderIt();
    choose(pdfFile());
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Statement PDF') as HTMLInputElement).value).toBe('');
  });
});
