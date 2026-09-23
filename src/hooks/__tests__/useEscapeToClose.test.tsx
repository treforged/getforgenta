// @vitest-environment jsdom
//
// ESCAPE CLOSES THE TOP MODAL AND NOTHING UNDER IT.
//
// The case that matters is two modals open at once, a form on top of a panel. One Escape must close
// the form and leave the panel. A version where every modal listens on its own passes the
// one-modal case perfectly and closes both here, so the pair below is the whole test: either half
// alone is satisfied by a broken hook.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { useState } from 'react';
import { useEscapeToClose, __escapeStackSize } from '@/hooks/useEscapeToClose';
import ModalShell from '@/components/shared/ModalShell';
import FormModal from '@/components/shared/FormModal';

function Modal({ name, onClose }: { name: string; onClose: () => void }) {
  useEscapeToClose(onClose);
  return <div data-testid={name} />;
}

function Stack() {
  const [open, setOpen] = useState({ panel: true, form: true });
  return (
    <>
      {open.panel && <Modal name="panel" onClose={() => setOpen(o => ({ ...o, panel: false }))} />}
      {open.form && <Modal name="form" onClose={() => setOpen(o => ({ ...o, form: false }))} />}
    </>
  );
}

afterEach(cleanup);

describe('useEscapeToClose', () => {
  it('with two modals open, one Escape closes ONLY the top one', () => {
    render(<Stack />);
    expect(screen.queryByTestId('panel')).not.toBeNull();
    expect(screen.queryByTestId('form')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('form')).toBeNull();
    expect(screen.queryByTestId('panel')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('panel')).toBeNull();
    expect(__escapeStackSize()).toBe(0);
  });

  it('with one modal open, Escape closes it', () => {
    const onClose = vi.fn();
    render(<Modal name="only" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys and a disabled modal', () => {
    const onClose = vi.fn();
    function Disabled() { useEscapeToClose(onClose, false); return null; }
    render(<><Modal name="m" onClose={onClose} /><Disabled /></>);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the shared modals are real dialogs', () => {
  it('ModalShell is a named, modal dialog and closes on Escape', () => {
    const onDismiss = vi.fn();
    render(<ModalShell onDismiss={onDismiss} ariaLabel="A note">body</ModalShell>);
    const dialog = screen.getByRole('dialog', { name: 'A note' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('FormModal is named by its own title and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <FormModal title="Edit bill" fields={[]} values={{}} onChange={() => {}} onSave={() => {}} onClose={onClose} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit bill' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
