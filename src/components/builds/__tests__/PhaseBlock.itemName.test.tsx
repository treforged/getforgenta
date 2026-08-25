// @vitest-environment jsdom
//
// Tre, 2026-08-24: *"when adding an item, dont make the 'New Item' text the actual tile, its
// just a place holder."*
//
// A new row is still STORED as "New Item" by `Builds.handleAddItem`, so the guarantee that
// has to survive the change is that nothing ends up nameless. The edit panel therefore opens
// blank with the stored name as the placeholder, and `saveItemEdit` keeps the stored name when
// the field is left empty. Both halves are pinned here, because dropping the second one is how
// "no default text" turns into "items called nothing".
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PhaseBlock from '../PhaseBlock';
import type { CarBuildPhase, CarBuildItem } from '@/lib/types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const phase: CarBuildPhase = {
  id: 'p1', build_id: 'b1', user_id: 'u1', title: 'Suspension', sort_order: 0, hidden: false,
  created_at: '2026-01-01T00:00:00Z',
};

const item = (id: string, name: string): CarBuildItem => ({
  id, phase_id: 'p1', build_id: 'b1', user_id: 'u1', name, brand: null, price: null, link: null,
  completed: false, sort_order: 0, created_at: '2026-01-01T00:00:00Z',
});

function renderBlock(items: CarBuildItem[], over: Partial<React.ComponentProps<typeof PhaseBlock>> = {}) {
  const onUpdateItem = vi.fn();
  const onAddItem = vi.fn().mockResolvedValue('i-new');
  const noop = vi.fn();
  render(
    <PhaseBlock
      phase={phase} phaseIndex={0} items={items} allPhases={[phase]}
      isTouch={false} isFirst isLast isDragging={false} isDragOver={false}
      dragItemId={null} dragOverItemId={null} itemDropBelow={false}
      isExpanded onSetExpanded={noop}
      onUpdatePhase={noop} onDeletePhase={noop} onAddItem={onAddItem}
      onUpdateItem={onUpdateItem} onDeleteItem={noop} onToggleItem={noop}
      onMovePhase={noop} onMoveItemArrow={noop}
      onPhaseDragStart={noop} onPhaseDragOver={noop} onPhaseDragEnd={noop} onPhaseDrop={noop}
      onItemDragEnterPhase={noop} onItemDragStart={noop} onItemDragOver={noop}
      onItemDragEnd={noop} onItemDrop={noop} onItemDropAtEnd={noop}
      paymentPlans={[]} transactions={[]} accounts={[]} paymentSourceOptions={[]}
      onLinkTransaction={vi.fn().mockResolvedValue(undefined)}
      onCreateTransactionForItem={vi.fn().mockResolvedValue(undefined)}
      onUpdateLinkedTransaction={vi.fn().mockResolvedValue(undefined)}
      onCreatePlanForItem={vi.fn().mockResolvedValue(undefined)}
      {...over}
    />,
  );
  return { onUpdateItem, onAddItem };
}

/** The Item Name field of the open edit panel. */
function nameField(): HTMLInputElement {
  const label = screen.getByText('Item Name');
  const input = label.parentElement?.querySelector('input');
  if (!input) throw new Error('Item Name input not found');
  return input as HTMLInputElement;
}

afterEach(() => { cleanup(); });

describe('PhaseBlock - "New Item" is a placeholder, never typed-over text', () => {
  it('opens an existing item with its real name as the VALUE', () => {
    renderBlock([item('i1', 'Ohlins Coilovers')]);
    fireEvent.click(screen.getByText('EDIT'));
    expect(nameField().value).toBe('Ohlins Coilovers');
  });

  it('shows the stored name as the PLACEHOLDER, so the hint matches what a blank save keeps', () => {
    renderBlock([item('i1', 'New Item')]);
    fireEvent.click(screen.getByText('EDIT'));
    expect(nameField().placeholder).toBe('New Item');
  });

  it('leaves the field EMPTY for a freshly added item, so there is nothing to delete first', async () => {
    // The add flow seeds `itemEdits` and opens the panel; the row itself arrives from the
    // server, which is why the item is passed in already named.
    const { onAddItem } = renderBlock([item('i-new', 'New Item')]);
    fireEvent.click(screen.getByText('Add Item'));
    await vi.waitFor(() => expect(onAddItem).toHaveBeenCalled());
    await vi.waitFor(() => expect(nameField().value).toBe(''));
    expect(nameField().placeholder).toBe('New Item');
  });

  it('keeps the stored name when the field is saved blank', async () => {
    const { onUpdateItem } = renderBlock([item('i1', 'New Item')]);
    fireEvent.click(screen.getByText('EDIT'));
    fireEvent.change(nameField(), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    await vi.waitFor(() => expect(onUpdateItem).toHaveBeenCalled());
    expect(onUpdateItem.mock.calls[0][1].name).toBe('New Item');
  });

  it('saves what was typed when the field is filled in', async () => {
    const { onUpdateItem } = renderBlock([item('i1', 'New Item')]);
    fireEvent.click(screen.getByText('EDIT'));
    fireEvent.change(nameField(), { target: { value: 'Whiteline Sway Bar' } });
    fireEvent.click(screen.getByText('Save'));
    await vi.waitFor(() => expect(onUpdateItem).toHaveBeenCalled());
    expect(onUpdateItem.mock.calls[0][1].name).toBe('Whiteline Sway Bar');
  });
});

describe('PhaseBlock - icon-only controls are real tap targets', () => {
  // 44px is the app's own `icon-btn` utility (`src/index.css`), already worn by every
  // icon-only button on Accounts, Budget, Debt, Goals and Activity. Measured on the Garage at
  // 390x844 before 2026-08-24: rename 12px, hide 14px, delete 13px square.
  it('gives the phase rename, hide and delete buttons the icon-btn class', () => {
    renderBlock([item('i1', 'Ohlins Coilovers')]);
    for (const title of ['Rename phase', 'Hide phase (mark as planned)', 'Delete phase', 'Delete item']) {
      expect(screen.getByTitle(title).className).toContain('icon-btn');
    }
  });

  it('keeps the completion ring 22px while its BUTTON is the target', () => {
    renderBlock([item('i1', 'Ohlins Coilovers')]);
    const toggle = screen.getByTitle('Mark as done');
    expect(toggle.className).toContain('icon-btn');
    // The ring moved to an inner span so the tick did not inflate with the target.
    expect(toggle.querySelector('span')?.className).toContain('w-[22px]');
  });
});
