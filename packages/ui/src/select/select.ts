/**
 * `<Select>` — a native-fidelity combobox/listbox form control (WAI-ARIA APG). A trigger
 * field (with Input's prefix/suffix/clear) shows the current selection; clicking (or
 * ↓/Enter) opens a CDK-overlay `role=listbox` panel of options anchored under it. Focus
 * stays on the trigger; the active option is tracked with `aria-activedescendant` (native
 * combobox behaviour), navigated with the CDK `listKeyManager` (typeahead, skip-disabled).
 *
 * - **Single or `multiple`** — multi keeps the panel open, shows check-marked options, and a
 *   `"N selected"` summary; the value is an array.
 * - **Any option shape** — the shared drop-list model: `optionValue`/`optionLabel`/
 *   `optionDescription`/`optionDisabled` accessors (default `.value`/`.label`/…; plain
 *   strings work), `emit: 'value'|'object'`, and a **description subtext** per row.
 * - **Binding** — the Weave form-control convention: `value` (getter) + `onChange`, OR a
 *   structural `control` (a forms `Field`). Compose with `<FormField>` for label/hint/error.
 *
 *   import Select from '@weave-framework/ui/select';
 *   <Select control={{ form.controls.country }} options={{ countries }}
 *           optionValue={{ (c) => c.code }} optionLabel={{ (c) => c.name }} />
 */
import { signal, effect, onMount, onDispose, type Signal } from '@weave-framework/runtime';
import { createOverlay, connectedPosition, listKeyManager, type OverlayRef, type ListKeyManager } from '../cdk/index.js';
import { optValue, optLabel, optDescription, optDisabled, emitSelection, type OptionAccessors } from '../shared/options.js';
import { buildPositions, type MenuPosition } from '../shared/positions.js';

/** What a Select's value can be (single or multiple; value strings or whole objects). */
export type SelectValue<T> = string | T | Array<string | T> | undefined;

/** The subset of a forms `Field` a Select binds to. */
export interface SelectControl<T> {
  value: Signal<SelectValue<T>>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

export interface SelectProps<T = { value: string; label: string }> extends OptionAccessors<T> {
  /** The options — default shape, plain strings, or arbitrary objects (via accessors). */
  options: T[];
  /** Allow multiple selection (value becomes an array; the panel stays open). */
  multiple?: boolean;
  /** Controlled value (a getter). Ignored when `control` is set. */
  value?: SelectValue<T>;
  /** Called with the next value on change. Ignored when `control` is set. */
  onChange?: (value: SelectValue<T>) => void;
  /** A forms `Field` — two-way value + touched-on-close + error state. */
  control?: SelectControl<T>;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** Disable the control. */
  disabled?: boolean;
  /** Show a clear (`×`) button when something is selected. */
  clearable?: boolean;
  /** Mark required (aria). */
  required?: boolean;
  /** Accessible name (when not wrapped by a FormField label). */
  label?: string;
  /** Panel position relative to the trigger. Default `'bottom-start'`. */
  position?: MenuPosition;
  /** Accessible name for the clear button. Default 'Clear'. */
  clearLabel?: string;
  /** Extra classes, forwarded onto the root. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ root }}>' +
  '<div class="weave-select__field" ref={{ trigger }} role="combobox" tabindex={{ tabindex() }}' +
  ' aria-haspopup="listbox" aria-expanded="false" aria-label={{ label() }} aria-required={{ ariaRequired() }}' +
  ' aria-disabled={{ ariaDisabled() }} on:click={{ onFieldClick }} on:keydown={{ onTriggerKeydown }}>' +
  '<span class="weave-select__prefix"><slot name="prefix"></slot></span>' +
  '<span class={{ valueClass() }}>{{ displayText() }}</span>' +
  '<span class="weave-select__spacer"></span>' +
  '@if (showClear()) {' +
  '<button type="button" class="weave-select__clear" tabindex="-1" aria-label={{ clearLabel() }} on:click={{ onClearClick }}><Icon name={{ \'x\' }} /></button>' +
  '}' +
  '<span class="weave-select__suffix"><slot name="suffix"></slot></span>' +
  '<span class="weave-select__chevron" aria-hidden="true"><Icon name={{ \'chevron-down\' }} /></span>' +
  '</div>' +
  '</div>';

/**
 * `T` is decorative — every member below is a display string or a handler, so `SelectContext<A>` and
 * `SelectContext<B>` are the same type. It stays because the 1.0 API is frozen and every call site writes
 * `SelectContext<Opt>`; dropping it is a breaking change for a cosmetic gain. Deliberate, not overlooked.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface SelectContext<T> {
  root: Signal<HTMLElement | null>;
  trigger: Signal<HTMLElement | null>;
  rootClass: () => string;
  valueClass: () => string;
  displayText: () => string;
  tabindex: () => number;
  label: () => string | undefined;
  ariaRequired: () => 'true' | undefined;
  ariaDisabled: () => 'true' | undefined;
  showClear: () => boolean;
  clearLabel: () => string;
  onFieldClick: () => void;
  onTriggerKeydown: (event: KeyboardEvent) => void;
  onClearClick: (event: MouseEvent) => void;
}

let _seq: number = 0;

export function setup<T = { value: string; label: string }>(props: SelectProps<T>): SelectContext<T> {
  const id: number = ++_seq;
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const trigger: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const open: Signal<boolean> = signal<boolean>(false);

  let overlay: OverlayRef | null = null;
  let listbox: HTMLElement | null = null;
  const optionEls: Map<string, HTMLElement> = new Map<string, HTMLElement>();

  const isDisabled = (): boolean => !!props.disabled;
  const enabledOptions = (): T[] => props.options.filter((o) => !optDisabled(o, props));

  // Current selection, normalised to an array of the emitted items (string or object).
  const currentSelection = (): Array<string | T> => {
    const raw: SelectValue<T> = props.control ? props.control.value() : props.value;
    if (raw == null) return [];
    return Array.isArray(raw) ? raw : [raw];
  };
  const valueOf = (sel: string | T): string => (typeof sel === 'string' ? sel : optValue(sel, props));
  const selectedValues = (): Set<string> => new Set(currentSelection().map(valueOf));

  const commit = (next: SelectValue<T>): void => {
    if (props.control) props.control.value.set(next);
    else props.onChange?.(next);
  };

  const labelForValue = (v: string): string => {
    const opt: T | undefined = props.options.find((o) => optValue(o, props) === v);
    return opt ? optLabel(opt, props) : v;
  };

  const km: ListKeyManager<T> = listKeyManager<T>(enabledOptions, {
    orientation: 'vertical',
    wrap: true,
    typeahead: true,
    getLabel: (o) => optLabel(o, props),
  });

  function toggleOption(item: T): void {
    const v: string = optValue(item, props);
    if (props.multiple) {
      const has: boolean = selectedValues().has(v);
      const kept: Array<string | T> = currentSelection().filter((s) => valueOf(s) !== v);
      commit(has ? kept : [...kept, emitSelection(item, props)]);
    } else {
      commit(emitSelection(item, props));
      closePanel(true);
    }
  }

  // Keep each rendered option's selected state + the active highlight in sync (reactive).
  function syncSelected(): void {
    const sel: Set<string> = selectedValues();
    for (const [v, el] of optionEls) {
      const on: boolean = sel.has(v);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      el.classList.toggle('weave-select__option--selected', on);
    }
  }
  function syncActive(): void {
    const active: T | null = km.activeItem();
    const activeVal: string | null = active ? optValue(active, props) : null;
    const t: HTMLElement | null = trigger();
    for (const [v, el] of optionEls) {
      const on: boolean = v === activeVal;
      el.classList.toggle('weave-select__option--active', on);
      if (on) {
        el.scrollIntoView({ block: 'nearest' });
        t?.setAttribute('aria-activedescendant', el.id);
      }
    }
    if (activeVal == null) t?.removeAttribute('aria-activedescendant');
  }

  // (Re)populate a listbox element's option nodes from the CURRENT `props.options`. Reading
  // `props.options` here means an effect that calls this while the panel is open re-tracks the list,
  // so async-loaded / edited options reflect live (and every re-open renders fresh) — H3.
  function renderOptions(box: HTMLElement): void {
    box.textContent = '';
    optionEls.clear();
    for (const o of props.options) {
      const v: string = optValue(o, props);
      const opt: HTMLElement = document.createElement('div');
      opt.className = 'weave-select__option';
      opt.id = `weave-select-${id}-opt-${optionEls.size}`;
      opt.setAttribute('role', 'option');
      const disabled: boolean = optDisabled(o, props);
      if (disabled) opt.setAttribute('aria-disabled', 'true');
      const label: HTMLElement = document.createElement('span');
      label.className = 'weave-select__label';
      label.textContent = optLabel(o, props);
      opt.appendChild(label);
      const desc: string | undefined = optDescription(o, props);
      if (desc) {
        const d: HTMLElement = document.createElement('span');
        d.className = 'weave-select__description';
        d.textContent = desc;
        opt.appendChild(d);
      }
      if (!disabled) {
        opt.addEventListener('mousedown', (e: MouseEvent) => {
          e.preventDefault(); // keep focus on the trigger
          km.setActiveItem(o);
          toggleOption(o);
        });
        optionEls.set(v, opt);
      }
      box.appendChild(opt);
    }
  }

  function buildListbox(): HTMLElement {
    const box: HTMLElement = document.createElement('div');
    box.id = `weave-select-${id}-listbox`;
    box.className = 'weave-select__panel';
    box.setAttribute('role', 'listbox');
    if (props.multiple) box.setAttribute('aria-multiselectable', 'true');
    return box; // options are filled by the reactive effect once the panel opens
  }

  function openPanel(seedActive: boolean): void {
    if (open() || isDisabled() || props.options.length === 0) return;
    const t: HTMLElement = trigger() as HTMLElement;
    if (!listbox) listbox = buildListbox();
    overlay = createOverlay({
      hasBackdrop: true,
      backdropClass: 'weave-overlay-backdrop--transparent',
      positionStrategy: connectedPosition(t, {
        positions: buildPositions(props.position, 'bottom-start'),
        offset: 4,
        matchOriginWidth: true, // the listbox is this trigger's panel — it lines up with it
      }),
    });
    overlay.onBackdropClick(() => closePanel(false));
    overlay.attach(listbox);
    t.setAttribute('aria-expanded', 'true');
    t.setAttribute('aria-controls', listbox.id); // APG: combobox controls its listbox popup
    open.set(true);
    syncSelected();
    // Seed the active option to the first selected (or first) when opening.
    const firstSel: string | undefined = [...selectedValues()][0];
    const seedItem: T | undefined = firstSel != null ? props.options.find((o) => optValue(o, props) === firstSel) : undefined;
    if (seedItem && !optDisabled(seedItem, props)) km.setActiveItem(seedItem);
    else if (seedActive) km.first();
    syncActive();
  }

  function closePanel(returnFocus: boolean): void {
    if (!open()) return;
    overlay?.detach();
    overlay = null;
    const t: HTMLElement | null = trigger();
    t?.setAttribute('aria-expanded', 'false');
    t?.removeAttribute('aria-controls'); // the listbox element is detached while closed
    open.set(false);
    props.control?.touched?.set(true);
    if (returnFocus) trigger()?.focus();
  }

  const onFieldClick = (): void => {
    if (open()) closePanel(true);
    else openPanel(false);
  };

  const onTriggerKeydown = (event: KeyboardEvent): void => {
    if (isDisabled()) return;
    if (!open()) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPanel(true);
      }
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      closePanel(event.key === 'Escape');
      return;
    }
    // In the open listbox, both Enter and Space select/toggle the active option (WAI-ARIA APG
    // listbox behaviour) — Space is a selection key here, not typeahead.
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const it: T | null = km.activeItem();
      if (it) toggleOption(it);
      return;
    }
    if (km.onKeydown(event)) {
      event.preventDefault();
      syncActive();
    }
  };

  const onClearClick = (event: MouseEvent): void => {
    event.stopPropagation(); // don't toggle the panel
    commit(props.multiple ? [] : undefined);
  };

  // Reflect external value changes (control/value) onto the option list + aria-invalid.
  effect(() => {
    currentSelection();
    if (open()) syncSelected();
  });
  // Keep the OPEN panel's options in sync with a changing `options` (async loads / edits) and
  // render fresh on every open — `renderOptions` reads `props.options`, tracked while open.
  effect(() => {
    if (open() && listbox) {
      renderOptions(listbox);
      syncSelected();
      syncActive();
    }
  });
  effect(() => {
    const t: HTMLElement | null = trigger();
    if (!t) return;
    const c: SelectControl<T> | undefined = props.control;
    const invalid: boolean = !!(c && c.touched?.() && c.error?.());
    if (invalid) t.setAttribute('aria-invalid', 'true');
    else t.removeAttribute('aria-invalid');
  });

  // Tie the (lazily-created, event-scoped) overlay to the component's lifetime.
  onDispose(() => {
    overlay?.dispose();
    overlay = null;
  });

  // Empty prefix/suffix slots collapse (no dead gap), like Input.
  onMount(() => {
    const el: HTMLElement | null = root();
    if (!el) return;
    for (const part of ['prefix', 'suffix']) {
      const span: HTMLElement | null = el.querySelector<HTMLElement>(`.weave-select__${part}`);
      if (span && !span.querySelector('*') && !(span.textContent ?? '').trim()) {
        span.classList.add(`weave-select__${part}--empty`);
      }
    }
  });

  const invalidNow = (): boolean => {
    const c: SelectControl<T> | undefined = props.control;
    return !!(c && c.touched?.() && c.error?.());
  };

  return {
    root,
    trigger,
    rootClass: (): string => {
      const parts: string[] = ['weave-select'];
      if (props.multiple) parts.push('weave-select--multiple');
      if (isDisabled()) parts.push('weave-select--disabled');
      if (invalidNow()) parts.push('weave-select--invalid');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    valueClass: (): string => {
      const empty: boolean = selectedValues().size === 0;
      return empty ? 'weave-select__value weave-select__value--placeholder' : 'weave-select__value';
    },
    displayText: (): string => {
      const sel: Set<string> = selectedValues();
      if (sel.size === 0) return props.placeholder ?? '';
      if (props.multiple && sel.size > 1) return `${sel.size} selected`;
      return labelForValue([...sel][0]);
    },
    tabindex: (): number => (isDisabled() ? -1 : 0),
    label: (): string | undefined => props.label,
    ariaRequired: (): 'true' | undefined => (props.required ? 'true' : undefined),
    ariaDisabled: (): 'true' | undefined => (isDisabled() ? 'true' : undefined),
    showClear: (): boolean => !!props.clearable && !isDisabled() && selectedValues().size > 0,
    clearLabel: (): string => props.clearLabel ?? 'Clear',
    onFieldClick,
    onTriggerKeydown,
    onClearClick,
  };
}
