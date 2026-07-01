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
import { signal, effect, onMount, onDispose, type Signal } from '@weave-framework/runtime';
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

export const template: string =
  '<div class={{ rootClass() }} ref={{ root }}>' +
  '<span class="weave-autocomplete__prefix"><slot name="prefix"></slot></span>' +
  '<input class="weave-autocomplete__field" ref={{ input }} type="text" role="combobox"' +
  ' aria-autocomplete="list" aria-expanded="false" aria-haspopup="listbox"' +
  ' placeholder={{ placeholder() }} .value={{ currentText() }} disabled={{ isDisabled() }}' +
  ' required={{ isRequired() }} name={{ name() }} aria-label={{ label() }}' +
  ' on:input={{ onNativeInput }} on:keydown={{ onKeydown }} on:blur={{ onBlur }} on:focus={{ onFocus }} />' +
  '@if (showClear()) {' +
  '<button type="button" class="weave-autocomplete__clear" tabindex="-1" aria-label={{ clearLabel() }} on:click={{ clear }}>×</button>' +
  '}' +
  '<span class="weave-autocomplete__suffix"><slot name="suffix"></slot></span>' +
  '</div>';

export interface AutocompleteContext {
  root: Signal<HTMLElement | null>;
  input: Signal<HTMLInputElement | null>;
  rootClass: () => string;
  placeholder: () => string | undefined;
  currentText: () => string;
  isDisabled: () => boolean;
  isRequired: () => boolean;
  name: () => string | undefined;
  label: () => string | undefined;
  showClear: () => boolean;
  clearLabel: () => string;
  onNativeInput: (event: Event) => void;
  onKeydown: (event: KeyboardEvent) => void;
  onBlur: () => void;
  onFocus: () => void;
  clear: () => void;
}

let _seq: number = 0;

export function setup<T = { value: string; label: string }>(props: AutocompleteProps<T>): AutocompleteContext {
  const id: number = ++_seq;
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
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
    el.setAttribute('aria-controls', listbox.id);
    overlay = createOverlay({
      positionStrategy: connectedPosition(el, { positions: buildPositions(props.position, 'bottom-start'), offset: 4 }),
    });
  }

  function openPanel(): void {
    if (open() || isDisabled()) return;
    ensurePanel();
    overlay!.attach(listbox as HTMLElement);
    input()?.setAttribute('aria-expanded', 'true');
    open.set(true);
    renderResults();
  }

  function closePanel(): void {
    if (!open()) return;
    overlay?.detach();
    input()?.setAttribute('aria-expanded', 'false');
    input()?.removeAttribute('aria-activedescendant');
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
    commitText(optLabel(item, props));
    props.onSelect?.(item);
    results.set([]);
    closePanel();
    void optValue(item, props); // value accessor available to consumers via onSelect(item)
  }

  const onNativeInput = (event: Event): void => {
    const text: string = (event.target as HTMLInputElement).value;
    commitText(text);
    fetchFor(text);
    if (text.length >= minChars()) openPanel();
    else closePanel();
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

  const clear = (): void => {
    commitText('');
    results.set([]);
    closePanel();
    input()?.focus();
  };

  // Re-render the panel whenever results change (async fills land here too).
  effect(() => {
    results();
    if (open()) renderResults();
  });

  // Forms validity → aria-invalid on the input.
  effect(() => {
    const el: HTMLInputElement | null = input();
    if (!el) return;
    const c: AutocompleteControl | undefined = props.control;
    if (c && c.touched?.() && c.error?.()) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });

  onDispose(() => {
    overlay?.dispose();
    overlay = null;
  });

  // Empty prefix/suffix slots collapse (no dead gap), like Input.
  onMount(() => {
    const el: HTMLElement | null = root();
    if (!el) return;
    for (const part of ['prefix', 'suffix']) {
      const span: HTMLElement | null = el.querySelector<HTMLElement>(`.weave-autocomplete__${part}`);
      if (span && !span.querySelector('*') && !(span.textContent ?? '').trim()) {
        span.classList.add(`weave-autocomplete__${part}--empty`);
      }
    }
  });

  const invalidNow = (): boolean => {
    const c: AutocompleteControl | undefined = props.control;
    return !!(c && c.touched?.() && c.error?.());
  };

  return {
    root,
    input,
    rootClass: (): string => {
      const parts: string[] = ['weave-autocomplete'];
      if (isDisabled()) parts.push('weave-autocomplete--disabled');
      if (invalidNow()) parts.push('weave-autocomplete--invalid');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    placeholder: (): string | undefined => props.placeholder,
    currentText,
    isDisabled,
    isRequired: (): boolean => !!props.required,
    name: (): string | undefined => props.name,
    label: (): string | undefined => props.label,
    showClear: (): boolean => !!props.clearable && !isDisabled() && currentText().length > 0,
    clearLabel: (): string => props.clearLabel ?? 'Clear',
    onNativeInput,
    onKeydown,
    onBlur,
    onFocus,
    clear,
  };
}
