/**
 * `<Slider>` — a value over a range (WAI-ARIA slider pattern).
 *
 * A 2px track with an accent fill to the value and a distinctive thumb (a 3×18 ink bar
 * with a 5px accent cap, per the Weave design). It's a **custom `role=slider`** rather
 * than a native `<input type=range>` because the design's thumb + fill can't be reached
 * with native pseudo-elements; keyboard, focus, ARIA and form participation are all
 * provided here so it stays indistinguishable from native.
 *
 * Drag with a pointer (pointer-capture on the track); or focus + Arrow / Home / End /
 * PageUp / PageDown. Value is a `number`; binding follows the Checkbox convention:
 * `value` (a getter) + `onChange`, or a structural `control` (a forms `Field<number>` —
 * two-way value + touched-on-release + `aria-invalid`); `control` wins.
 *
 *   import Slider from '@weave-framework/ui/slider';
 *   <Slider min={{ 0 }} max={{ 100 }} value={{ vol() }} onChange={{ setVol }} label={{ 'Volume' }} />
 *   <Slider control={{ form.controls.level }} step={{ 5 }} />
 */

import { signal, type Signal } from '@weave-framework/runtime';
import { activeDirection } from '../cdk/index.js';

/** The subset of a `@weave-framework/forms` `Field<number>` a control binds to. */
export interface SliderControl {
  value: Signal<number>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

export interface SliderProps {
  /** Range bounds. Defaults 0 / 100. */
  min?: number;
  max?: number;
  /** Step increment. Default 1. */
  step?: number;
  /** Controlled value (a getter). Ignored when `control` is set. */
  value?: number;
  /** Called with the next value on change. Ignored when `control` is set. */
  onChange?: (value: number) => void;
  /** Uncontrolled initial value (ignored when `value`/`control` is set). */
  defaultValue?: number;
  /** A forms `Field<number>` — two-way value + touched-on-release + aria-invalid. */
  control?: SliderControl;
  /** Disable the slider. */
  disabled?: boolean;
  /** Accessible name. */
  label?: string;
  /** Formats the value for `aria-valuetext` (default: the plain number). */
  format?: (value: number) => string;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ host }} role="slider" tabindex={{ tabindex() }}' +
  ' aria-valuemin={{ min() }} aria-valuemax={{ max() }} aria-valuenow={{ value() }}' +
  ' aria-valuetext={{ valueText() }} aria-orientation="horizontal" aria-label={{ label() }}' +
  ' aria-disabled={{ disabledAttr() }} aria-invalid={{ invalidAttr() }}' +
  ' on:pointerdown={{ onPointerdown }} on:pointermove={{ onPointermove }}' +
  ' on:pointerup={{ onPointerup }} on:keydown={{ onKeydown }}>' +
  '<div class="weave-slider__track"><div class="weave-slider__fill" style={{ fillStyle() }}></div></div>' +
  '<div class="weave-slider__thumb" style={{ thumbStyle() }}></div>' +
  '</div>';

export interface SliderContext {
  host: Signal<Element | null>;
  rootClass: () => string;
  tabindex: () => number;
  min: () => number;
  max: () => number;
  value: () => number;
  valueText: () => string;
  label: () => string | undefined;
  disabledAttr: () => string | undefined;
  invalidAttr: () => string | undefined;
  fillStyle: () => string;
  thumbStyle: () => string;
  onPointerdown: (event: PointerEvent) => void;
  onPointermove: (event: PointerEvent) => void;
  onPointerup: (event: PointerEvent) => void;
  onKeydown: (event: KeyboardEvent) => void;
}

export function setup(props: SliderProps): SliderContext {
  const host: Signal<Element | null> = signal<Element | null>(null);
  const internal: Signal<number> = signal<number>(props.defaultValue ?? props.min ?? 0);
  let dragging: boolean = false;

  const min = (): number => props.min ?? 0;
  const max = (): number => props.max ?? 100;
  const step = (): number => props.step ?? 1;
  const disabled = (): boolean => !!props.disabled;

  // Snap to the step grid (measured from min) and clamp to the range.
  const clampSnap = (v: number): number => {
    if (!Number.isFinite(v)) return min();
    const s: number = step() > 0 ? step() : 1;
    const snapped: number = min() + Math.round((v - min()) / s) * s;
    return Math.min(max(), Math.max(min(), snapped));
  };

  const rawValue = (): number => {
    if (props.control) return props.control.value();
    if (props.value !== undefined) return props.value;
    return internal();
  };
  const value = (): number => clampSnap(rawValue());
  const percent = (): number => (max() === min() ? 0 : ((value() - min()) / (max() - min())) * 100);

  const invalid = (): boolean => {
    const c: SliderControl | undefined = props.control;
    return !!(c && c.touched?.() && c.error?.());
  };

  const markTouched = (): void => {
    props.control?.touched?.set(true);
  };

  const commit = (v: number): void => {
    const next: number = clampSnap(v);
    if (next === value()) return;
    if (props.control) props.control.value.set(next);
    else if (props.value === undefined) internal.set(next);
    props.onChange?.(next);
  };

  const trackRect = (): DOMRect | null => {
    const el: Element | null = host();
    const track: HTMLElement | null | undefined = el?.querySelector<HTMLElement>('.weave-slider__track');
    return track ? track.getBoundingClientRect() : null;
  };

  const valueFromClientX = (clientX: number): void => {
    const rect: DOMRect | null = trackRect();
    if (!rect || rect.width === 0) return;
    const ratio: number = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    commit(min() + ratio * (max() - min()));
  };

  // Pointer capture keeps the drag alive outside the element; guard it since a synthetic
  // event (tests) has no active pointer id and would throw.
  const capture = (id: number): void => {
    try {
      (host() as HTMLElement | null)?.setPointerCapture(id);
    } catch {
      /* no active pointer (synthetic event) */
    }
  };
  const release = (id: number): void => {
    try {
      (host() as HTMLElement | null)?.releasePointerCapture(id);
    } catch {
      /* already released */
    }
  };

  const onPointerdown = (event: PointerEvent): void => {
    if (disabled()) return;
    dragging = true;
    capture(event.pointerId);
    (host() as HTMLElement | null)?.focus();
    valueFromClientX(event.clientX);
    event.preventDefault();
  };

  const onPointermove = (event: PointerEvent): void => {
    if (!dragging) return;
    valueFromClientX(event.clientX);
  };

  const onPointerup = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    release(event.pointerId);
    markTouched();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (disabled()) return;
    const s: number = step() > 0 ? step() : 1;
    const big: number = Math.max(s, (max() - min()) / 10);
    let next: number = value();
    // Up/Down are unambiguous; only the horizontal arrows flip under RTL.
    const horizStep: number = activeDirection() === 'rtl' ? -s : s;
    switch (event.key) {
      case 'ArrowUp':
        next += s;
        break;
      case 'ArrowDown':
        next -= s;
        break;
      case 'ArrowRight':
        next += horizStep;
        break;
      case 'ArrowLeft':
        next -= horizStep;
        break;
      case 'PageUp':
        next += big;
        break;
      case 'PageDown':
        next -= big;
        break;
      case 'Home':
        next = min();
        break;
      case 'End':
        next = max();
        break;
      default:
        return;
    }
    commit(next);
    markTouched();
    event.preventDefault();
  };

  return {
    host,
    rootClass: (): string => {
      const parts: string[] = ['weave-slider'];
      if (disabled()) parts.push('weave-slider--disabled');
      if (invalid()) parts.push('weave-slider--invalid');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    tabindex: (): number => (disabled() ? -1 : 0),
    min,
    max,
    value,
    valueText: (): string => (props.format ? props.format(value()) : String(value())),
    label: (): string | undefined => props.label,
    disabledAttr: (): string | undefined => (disabled() ? 'true' : undefined),
    invalidAttr: (): string | undefined => (invalid() ? 'true' : undefined),
    fillStyle: (): string => `width: ${percent()}%`,
    thumbStyle: (): string => `left: ${percent()}%`,
    onPointerdown,
    onPointermove,
    onPointerup,
    onKeydown,
  };
}
