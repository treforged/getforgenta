// @vitest-environment jsdom
//
// TAB STAYS INSIDE THE OPEN POPUP. jsdom does not move focus on a Tab key, so each case puts focus
// somewhere, fires the keydown the browser would, and asserts where the TRAP moved focus - plus the
// paired case that a Tab in the middle is left to the browser (no preventDefault).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { useModalFocusTrap } from '../useModalFocusTrap';
import InstructionsModal from '@/components/shared/InstructionsModal';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

afterEach(cleanup);

function Page({ open = true }: { open?: boolean }) {
  useModalFocusTrap();
  return (
    <div>
      <button>behind</button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Popup">
          <button>first</button>
          <button>middle</button>
          <button>last</button>
          <button tabIndex={-1}>not tabbable, and placed last on purpose</button>
        </div>
      )}
    </div>
  );
}

const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey });

describe('useModalFocusTrap', () => {
  it('Tab past the last control returns focus to the first', () => {
    render(<Page />);
    screen.getByText('last').focus();
    const notPrevented = tab();
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('Shift+Tab on the first control goes to the last', () => {
    render(<Page />);
    screen.getByText('first').focus();
    tab(true);
    expect(document.activeElement).toBe(screen.getByText('last'));
  });

  it('Tab from the page behind the popup moves focus into it', () => {
    render(<Page />);
    screen.getByText('behind').focus();
    tab();
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('paired: a Tab in the middle is left to the browser', () => {
    render(<Page />);
    screen.getByText('middle').focus();
    expect(tab()).toBe(true);
    expect(document.activeElement).toBe(screen.getByText('middle'));
  });

  it('paired: with no popup open, Tab is left alone', () => {
    render(<Page open={false} />);
    screen.getByText('behind').focus();
    expect(tab()).toBe(true);
    expect(document.activeElement).toBe(screen.getByText('behind'));
  });

  it('works on a real converted popup (InstructionsModal)', () => {
    render(<><Page open={false} /><InstructionsModal pageTitle="Budget" sections={[{ title: 'A', body: 'b' }]} /></>);
    fireEvent.click(screen.getByTitle('How to use Budget'));
    const dlg = screen.getByRole('dialog', { name: 'How to use Budget' });
    screen.getByText('behind').focus();
    tab();
    expect(dlg.contains(document.activeElement)).toBe(true);
  });

  it('PROXY: App mounts the trap once (a source check - the hooks above prove the behaviour)', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');
    expect(app.match(/^\s*useModalFocusTrap\(\);/gm)?.length).toBe(1);
  });
});

// FOCUS RETURNS TO THE OPENER. The observer runs as a microtask after React commits, so each case
// waits for the assertion rather than reading focus synchronously.
function Opener({ removeOpenerOnClose = false, focusElsewhereOnClose = false }) {
  useModalFocusTrap();
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  return (
    <div>
      {!gone && <button onClick={() => setOpen(true)}>open it</button>}
      <input aria-label="elsewhere" />
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Popup">
          <button autoFocus>inside</button>
          <button onClick={() => {
            setOpen(false);
            if (removeOpenerOnClose) setGone(true);
            if (focusElsewhereOnClose) (document.querySelector('input[aria-label="elsewhere"]') as HTMLElement).focus();
          }}>close</button>
        </div>
      )}
    </div>
  );
}

function openVia(name: string) {
  const btn = screen.getByText(name);
  btn.focus();
  fireEvent.click(btn);
  return btn;
}

describe('focus returns to the opener when a popup closes', () => {
  it('returns focus to the button that opened it', async () => {
    render(<Opener />);
    const opener = openVia('open it');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    screen.getByText('close').focus();
    fireEvent.click(screen.getByText('close'));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('paired: the opener is gone, so focus is left on the body and nothing throws', async () => {
    render(<Opener removeOpenerOnClose />);
    openVia('open it');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    screen.getByText('close').focus();
    fireEvent.click(screen.getByText('close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(document.body);
  });

  it('paired: focus moved on purpose is left alone', async () => {
    render(<Opener focusElsewhereOnClose />);
    openVia('open it');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    screen.getByText('close').focus();
    fireEvent.click(screen.getByText('close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(screen.getByLabelText('elsewhere'));
  });

  it('a real popup: InstructionsModal closed by Escape returns focus to its trigger', async () => {
    render(<><Page open={false} /><InstructionsModal pageTitle="Budget" sections={[{ title: 'A', body: 'b' }]} /></>);
    const trigger = screen.getByTitle('How to use Budget');
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'How to use Budget' })).toBeTruthy());
    screen.getByRole('dialog').querySelector('button')!.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
