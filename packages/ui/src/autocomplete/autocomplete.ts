/**
 * `<Autocomplete>` — a text field with a suggestion listbox (WAI-ARIA combobox +
 * `aria-autocomplete=list`). A native `<input>` (Input's field: prefix/suffix/clear) whose
 * typing opens a CDK-overlay `role=listbox` of matching options; focus stays in the input
 * and the active suggestion is tracked with `aria-activedescendant`.
 *
 * **Static or async data (adapts to APIs):**
 *  - `options: T[]` — filtered locally by the typed text (`filter`, default: label contains
 *    query, case-insensitive), OR
 *  - `optionsFor(query) => T[] | Promise<T[]>` — fetch suggestions (e.g. an API call); a
 *    promise fills a reactive cache, so the panel re-renders when results land.
 *
 * **Field mapping:** `optionValue`/`optionLabel`/`optionDescription` accessors pick which
 * fields of an arbitrary row are the value / display / subtext (default `.value`/`.label`/
 * `.description`; plain strings work). Selecting fills the input with the label and fires
 * `onSelect(item)`. Free text is allowed. The text value binds like Input (`value`/`onInput`
 * OR a `control` Field<string>). Zero-dep.
 */
import { signal, effect, onDispose, type Signal } from '@weave-framework/runtime';
import { createOverlay, connectedPosition, listKeyManager, type OverlayRef, type ListKeyManager } from '../cdk/index.js';
import { optValue, optLabel, optDescription, type OptionAccessors } from '../shared/options.js';
import { buildPositions, type MenuPosition } from '../shared/positions.js';

/** The subset of a forms `Field<string>` an Autocomplete binds to (the text value). */
export interface AutocompleteControl {
  value: Signal<string>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

export interface AutocompleteProps<T = { value: string; label: string }> extends OptionAccessors<T> {
  /** Static options — filtered locally by the typed text. */
  options?: T[];
  /** Async / dynamic options for a query (e.g. an API call). Overrides `options`. */
  optionsFor?: (query: string) => T[] | Promise<T[]>;
  /** Local filter for static `options`. Default: label contains the query (case-insensitive). */
  filter?: (item: T, query: string) => boolean;
  /** Controlled text value (a getter). Ignored when `control` is set. */
  value?: string;
  /** Called with the next text on every input. Ignored when `control` is set. */
  onInput?: (text: string) => void;
  /** A forms `Field<string>` — two-way text + touched-on-blur + error underline. */
  control?: AutocompleteControl;
  /** Called with the chosen option (the input is filled with its label). */
  onSelect?: (item: T) => void;
  /** Minimum characters before suggestions show. Default 1. */
  minChars?: number;
  /** Placeholder text. */
  placeholder?: string;
  /** Disable the field. */
  disabled?: boolean;
  /** Mark required (native). */
  required?: boolean;
  /** Native `name`. */
  name?: string;
  /** Accessible name (when not wrapped by a FormField label). */
  label?: string;
  /** Show a clear (`×`) button when non-empty. */
  clearable?: boolean;
  /** Accessible name for the clear button. Default 'Clear'. */
  clearLabel?: string;
  /** Text for the empty-results row. Default 'No results'. */
  noResultsText?: string;
  /** Panel position relative to the field. Default `'bottom-start'`. */
  position?: MenuPosition;
  /** Extra classes, forwarded onto the root. */
  class?: string;
}

// The field IS the Input component (Autocomplete = Input + a suggestion listbox). The
// combobox ARIA + keyboard nav are attached to Input's native field via `onInputRef`;
// the underline / clear / prefix-suffix / value binding / invalid state are all Input's.
export const template: string =
  '<Input class="weave-autocomplete" value={{ currentText() }} control={{ controlProp() }}' +
  ' onInput={{ onCommit }} clearable={{ clearable() }} placeholder={{ placeholder() }}' +
  ' disabled={{ isDisabled() }} required={{ isRequired() }} name={{ name() }} label={{ label() }}' +
  ' onInputRef={{ bindInput }} />';

export interface AutocompleteContext {
  currentText: () => string;
  controlProp: () => AutocompleteControl | undefined;
  onCommit: (value: string) => void;
  clearable: () => boolean;
  placeholder: () => string | undefined;
  isDisabled: () => boolean;
  isRequired: () => boolean;
  name: () => string | undefined;
  label: () => string | undefined;
  bindInput: (el: HTMLInputElement | HTMLTextAreaElement) => void;
}

let _seq: number = 0;

export function setup<T = { value: string; label: string }>(props: AutocompleteProps<T>): AutocompleteContext {
  const id: number = ++_seq;
  const input: Signal<HTMLInputElement | null> = signal<HTMLInputElement | null>(null);
  const open: Signal<boolean> = signal<boolean>(false);
  const results: Signal<T[]> = signal<T[]>([]);

  let overlay: OverlayRef | null = null;
  let listbox: HTMLElement | null = null;
  let requestSeq: number = 0; // guard against out-of-order async responses

  const currentText = (): string => (props.control ? props.control.value() : props.value ?? '');
  const isDisabled = (): boolean => !!props.disabled;
  const minChars = (): number => props.minChars ?? 1;

  const commitText = (next: string): void => {
    if (props.control) props.control.value.set(next);
    else props.onInput?.(next);
  };

  const defaultFilter = (item: T, query: string): boolean =>
    optLabel(item, props).toLowerCase().includes(query.toLowerCase());

  const km: ListKeyManager<T> = listKeyManager<T>(() => results(), {
    orientation: 'vertical',
    wrap: true,
  });

  function renderResults(): void {
    if (!listbox) return;
    const box: HTMLElement = listbox;
    box.textContent = '';
    const list: T[] = results();
    if (list.length === 0) {
      const empty: HTMLElement = document.createElement('div');
      empty.className = 'weave-autocomplete__empty';
      empty.textContent = props.noResultsText ?? 'No results';
      box.appendChild(empty);
      input()?.removeAttribute('aria-activedescendant');
      return;
    }
    list.forEach((item, i) => {
      const opt: HTMLElement = document.createElement('div');
      opt.className = 'weave-autocomplete__option';
      opt.id = `weave-autocomplete-${id}-opt-${i}`;
      opt.setAttribute('role', 'option');
      const label: HTMLElement = document.createElement('span');
      label.className = 'weave-autocomplete__label';
      label.textContent = optLabel(item, props);
      opt.appendChild(label);
      const desc: string | undefined = optDescription(item, props);
      if (desc) {
        const d: HTMLElement = document.createElement('span');
        d.className = 'weave-autocomplete__description';
        d.textContent = desc;
        opt.appendChild(d);
      }
      opt.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault(); // keep focus in the input
        select(item);
      });
      box.appendChild(opt);
    });
    syncActive();
  }

  function syncActive(): void {
    if (!listbox) return;
    const active: T | null = km.activeItem();
    const activeIdx: number = km.activeIndex();
    const opts: HTMLElement[] = Array.from(listbox.querySelectorAll('.weave-autocomplete__option'));
    opts.forEach((el, i) => {
      const on: boolean = i === activeIdx;
      el.classList.toggle('weave-autocomplete__option--active', on);
      if (on) {
        el.scrollIntoView({ block: 'nearest' });
        input()?.setAttribute('aria-activedescendant', el.id);
      }
    });
    if (active == null) input()?.removeAttribute('aria-activedescendant');
  }

  function ensurePanel(): void {
    if (overlay) return;
    const el: HTMLInputElement = input() as HTMLInputElement;
    listbox = document.createElement('div');
    listbox.className = 'weave-autocomplete__panel';
    listbox.setAttribute('role', 'listbox');
    listbox.id = `weave-autocomplete-${id}-list`;
    overlay = createOverlay({
      positionStrategy: connectedPosition(el, { positions: buildPositions(props.position, 'bottom-start'), offset: 4 }),
    });
  }

  function openPanel(): void {
    if (open() || isDisabled()) return;
    ensurePanel();
    overlay!.attach(listbox as HTMLElement);
    input()?.setAttribute('aria-expanded', 'true');
    input()?.setAttribute('aria-controls', (listbox as HTMLElement).id); // APG: only while the popup is in the DOM
    open.set(true);
    renderResults();
  }

  function closePanel(): void {
    if (!open()) return;
    overlay?.detach();
    input()?.setAttribute('aria-expanded', 'false');
    input()?.removeAttribute('aria-activedescendant');
    input()?.removeAttribute('aria-controls'); // the listbox element is detached while closed
    open.set(false);
  }

  function fetchFor(query: string): void {
    if (query.length < minChars()) {
      results.set([]);
      closePanel();
      return;
    }
    const seq: number = ++requestSeq;
    if (props.optionsFor) {
      const out: T[] | Promise<T[]> = props.optionsFor(query);
      if (Array.isArray(out)) {
        results.set(out);
      } else {
        out.then((list: T[]) => {
          if (seq === requestSeq) results.set(list); // ignore stale responses
        });
      }
    } else {
      const filter: (item: T, query: string) => boolean = props.filter ?? defaultFilter;
      results.set((props.options ?? []).filter((o) => filter(o, query)));
    }
  }

  function select(item: T): void {
    const label: string = optLabel(item, props);
    commitText(label);
    const el: HTMLInputElement | null = input();
    if (el) el.value = label; // reflect immediately (Input re-renders it from value/control too)
    props.onSelect?.(item);
    results.set([]);
    closePanel();
    void optValue(item, props); // value accessor available to consumers via onSelect(item)
  }

  // The value is Input's job (via value/control); this listener only drives the suggestions.
  const onInputFetch = (): void => {
    const text: string = input()?.value ?? '';
    fetchFor(text);
    if (text.length >= minChars()) openPanel();
    else closePanel();
  };

  // Compose Input: forward the consumer's onInput (no-control mode) and attach the
  // combobox ARIA + keyboard nav to Input's native field once it's handed over.
  const onCommit = (value: string): void => props.onInput?.(value);

  const bindInput = (el: HTMLInputElement | HTMLTextAreaElement): void => {
    const inp: HTMLInputElement = el as HTMLInputElement;
    input.set(inp);
    inp.setAttribute('role', 'combobox');
    inp.setAttribute('aria-autocomplete', 'list');
    inp.setAttribute('aria-haspopup', 'listbox');
    inp.setAttribute('aria-expanded', 'false');
    inp.addEventListener('input', onInputFetch);
    inp.addEventListener('keydown', onKeydown);
    inp.addEventListener('focus', onFocus);
    inp.addEventListener('blur', onBlur);
  };

  const onFocus = (): void => {
    if (currentText().length >= minChars()) {
      fetchFor(currentText());
      openPanel();
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (open()) {
        event.preventDefault();
        closePanel();
      }
      return;
    }
    if (!open()) {
      if (event.key === 'ArrowDown' && currentText().length >= minChars()) {
        event.preventDefault();
        fetchFor(currentText());
        openPanel();
      }
      return;
    }
    if (event.key === 'Enter') {
      const it: T | null = km.activeItem();
      if (it != null) {
        event.preventDefault();
        select(it);
      }
      return;
    }
    if (km.onKeydown(event)) {
      event.preventDefault();
      syncActive();
    }
  };

  const onBlur = (): void => {
    props.control?.touched?.set(true);
    // Defer close so a mousedown-select on an option still fires first.
    closePanel();
  };

  // Re-render the panel whenever results change (async fills land here too).
  effect(() => {
    results();
    if (open()) renderResults();
  });

  // Forms validity (aria-invalid + the --invalid underline) is the composed Input's job
  // now — Autocomplete passes it the `control`, so Input reflects touched-and-invalid.

  onDispose(() => {
    overlay?.dispose();
    overlay = null;
  });

  return {
    currentText,
    controlProp: (): AutocompleteControl | undefined => props.control,
    onCommit,
    clearable: (): boolean => !!props.clearable,
    placeholder: (): string | undefined => props.placeholder,
    isDisabled,
    isRequired: (): boolean => !!props.required,
    name: (): string | undefined => props.name,
    label: (): string | undefined => props.label,
    bindInput,
  };
}
