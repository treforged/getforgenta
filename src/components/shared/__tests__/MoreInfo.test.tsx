// @vitest-environment jsdom
//
// What this protects: explanations moved behind a tap (ask 52898f88) must still be ONE press away.
// A disclosure that never opens passes every "no error" check, so each press asserts a change.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MoreInfo from '@/components/shared/MoreInfo';

afterEach(cleanup);

const renderIt = () => render(<MoreInfo label="Why?">secret note</MoreInfo>);

describe('MoreInfo', () => {
  it('is closed by default', () => {
    renderIt();
    expect(screen.getByRole('button', { name: /why/i }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('secret note')).toBeNull();
  });

  it('one press opens it, and the button points at the panel it opened', () => {
    renderIt();
    const button = screen.getByRole('button', { name: /why/i });
    fireEvent.click(button);
    const panel = screen.getByText('secret note');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.id).not.toBe('');
  });

  it('a second press closes it again', () => {
    renderIt();
    const button = screen.getByRole('button', { name: /why/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByText('secret note')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
