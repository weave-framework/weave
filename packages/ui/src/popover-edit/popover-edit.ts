/**
 * `use:popoverEdit` — inline editing of any element's value in a small **non-modal** overlay
 * (the spreadsheet "click a cell → edit in place" gesture). Attaches to a host (a table cell,
 * a label, …); activating it (click / Enter / F2) opens a CDK-overlay popover — the U3 overlay
 * republic chrome — containing an editor seeded with the current value. **Enter or click-away
 * commit** (`onCommit`), **Esc cancels** (restores). Focus moves into the editor on open and
 * back to the host on close.
 *
 * The default editor is a text field sharing Input's underline (the shared `field-underline`
 * helper — RULE #1, one field look); a custom `editor` factory can supply a Select/date/etc.
 *
 *   <td use:popoverEdit={{ { value: () => row.name, onCommit: (v) => rename(row, v) } }}>{{ row.name }}</td>
 */
import { createOverlay, connectedPosition, type OverlayRef } from '../cdk/index.js';
import { buildPositions, type MenuPosition } from '../shared/positions.js';

/** A custom editor: build the DOM + expose how to read its value + which element to focus. */
export interface PopoverEditor {
  element: HTMLElement;
  /** Read the current editor value (called on commit). */
  read: () => string;
  /** The element to focus on open (defaults to `element`). */
  focusTarget?: HTMLElement;
}

export interface PopoverEditConfig {
  /** Current value getter (seeds the editor on open). */
  value: () => string;
  /** Called with the next value on commit (Enter / click-away). */
  onCommit: (next: string) => void;
  /** Build a custom editor (default: a text field). */
  editor?: (value: string) => PopoverEditor;
  /** Placeholder for the default text editor. */
  placeholder?: string;
  /** Accessible name for the default editor. */
  label?: string;
  /** Popover position relative to the host. Default `'bottom-start'`. */
  position?: MenuPosition;
  /** Disable editing (boolean or a reactive getter). */
  disabled?: boolean | (() => boolean);
}

export interface PopoverEditRef {
  open(): void;
  close(): void;
  destroy(): void;
}

function disabledOf(d?: boolean | (() => boolean)): boolean {
  return typeof d === 'function' ? d() : !!d;
}

/** Attach inline popover editing to `host`. Returns a ref (also a cleanup contract for Weave). */
export function popoverEdit(host: HTMLElement, config: PopoverEditConfig): PopoverEditRef {
  let overlay: OverlayRef | null = null;
  let editor: PopoverEditor | null = null;

  host.setAttribute('aria-haspopup', 'dialog');

  const buildDefaultEditor = (value: string): PopoverEditor => {
    const input: HTMLInputElement = document.createElement('input');
    input.type = 'text';
    input.className = 'weave-popover-edit__input';
    input.value = value;
    if (config.placeholder) input.placeholder = config.placeholder;
    if (config.label) input.setAttribute('aria-label', config.label);
    return { element: input, read: () => input.value, focusTarget: input };
  };

  function open(): void {
    if (overlay || disabledOf(config.disabled)) return;
    const panel: HTMLElement = document.createElement('div');
    panel.className = 'weave-popover-edit';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', config.label ?? 'Edit');

    editor = (config.editor ?? buildDefaultEditor)(config.value());
    panel.appendChild(editor.element);
    panel.addEventListener('keydown', onPanelKeydown);

    overlay = createOverlay({
      hasBackdrop: true,
      backdropClass: 'weave-overlay-backdrop--transparent',
      positionStrategy: connectedPosition(host, { positions: buildPositions(config.position, 'bottom-start'), offset: 4 }),
    });
    overlay.onBackdropClick(() => commit()); // click-away commits (spreadsheet feel)
    overlay.attach(panel);
    host.setAttribute('aria-expanded', 'true');

    const focusEl: HTMLElement = editor.focusTarget ?? editor.element;
    focusEl.focus();
    if (focusEl instanceof HTMLInputElement) focusEl.select();
  }

  function teardown(returnFocus: boolean): void {
    overlay?.detach();
    overlay?.dispose();
    overlay = null;
    editor = null;
    host.setAttribute('aria-expanded', 'false');
    if (returnFocus) host.focus();
  }

  function commit(): void {
    if (!overlay || !editor) return;
    const next: string = editor.read();
    teardown(true);
    config.onCommit(next);
  }

  function cancel(): void {
    if (!overlay) return;
    teardown(true);
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  const onHostClick = (): void => open();
  const onHostKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      open();
    }
  };

  host.addEventListener('click', onHostClick);
  host.addEventListener('keydown', onHostKeydown);

  const destroy = (): void => {
    teardown(false);
    host.removeEventListener('click', onHostClick);
    host.removeEventListener('keydown', onHostKeydown);
    host.removeAttribute('aria-haspopup');
    host.removeAttribute('aria-expanded');
  };

  return { open, close: () => cancel(), destroy };
}
