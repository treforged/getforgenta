// @vitest-environment jsdom
// The popups converted on 2026-09-23 are REAL dialogs: a screen reader finds them by role and name,
// and Escape closes them. Pressed, not read: each case asserts a CHANGE (the dialog is gone, or
// onClose fired), and each has its paired case (Escape while closed does nothing / the dialog opens).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CalcDrawer from '../CalcDrawer';
import InstructionsModal from '../InstructionsModal';

afterEach(cleanup);

describe('CalcDrawer is a named dialog that Escape closes', () => {
  it('open: role=dialog named by its title, and Escape calls onClose once', () => {
    const onClose = vi.fn();
    render(<CalcDrawer open onClose={onClose} title="Safe to pay" lines={[]} />);
    const dlg = screen.getByRole('dialog', { name: 'Safe to pay' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closed: no dialog, and Escape calls nothing', () => {
    const onClose = vi.fn();
    render(<CalcDrawer open={false} onClose={onClose} title="Safe to pay" lines={[]} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('InstructionsModal opens as a named dialog and Escape removes it', () => {
  it('press the trigger, find the dialog by name, press Escape, it is gone', () => {
    render(<InstructionsModal pageTitle="Budget" sections={[{ title: 'A', body: 'b' }]} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByTitle('How to use Budget'));
    expect(screen.getByRole('dialog', { name: 'How to use Budget' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
