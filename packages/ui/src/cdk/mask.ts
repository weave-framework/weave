/**
 * Mask — the headless input-masking engine (RFC 0010). Formats a text input against a
 * caller-written positional template (`(999) 999-9999`) while the user types, keeping the
 * caret on the character the user is actually editing, and exposing the typed characters —
 * not the formatted string — through the caller's signal.
 *
 * Headless: no styling, no ARIA opinions, and `<Input>` knows nothing about it. Zero-dep —
 * the only DOM APIs used are the element's own value/selection and `beforeinput`/`input`.
 *
 * The formatting core (`compileMask`) is pure and DOM-free, so every caret and paste rule is
 * testable without an element; `mask` is the thin `use:` action that drives it.
 */

import { effect, onDispose, type Signal } from '@weave-framework/runtime';

/** Decides whether `ch` may occupy a token position. */
export type TokenMatcher = (ch: string) => boolean;

/** The four builtin template tokens. Redefining one is an error — see {@link compileMask}. */
const BUILTIN_TOKENS: Readonly<Record<string, TokenMatcher>> = Object.freeze({
  9: (ch: string): boolean => ch >= '0' && ch <= '9',
  a: (ch: string): boolean => /\p{L}/u.test(ch),
  '*': (ch: string): boolean => /[\p{L}\p{Nd}]/u.test(ch),
});

/** The escape character: the template character after it is a literal, never a token. */
const ESCAPE: string = '\\';

/** One position in a compiled template — either a fixed character or a slot the user fills. */
type Slot = { readonly literal: string } | { readonly match: TokenMatcher };

const isLiteral = (s: Slot): s is { readonly literal: string } => 'literal' in s;

export interface MaskOptions {
  /**
   * Extra template tokens, as `character → matcher` (`{ H: (ch) => /[0-9a-f]/i.test(ch) }`).
   * Redefining a builtin (`9`, `a`, `*`, `\`) throws: a template string must mean the same
   * thing everywhere it is read.
   */
  tokens?: Record<string, TokenMatcher>;
  /** Character shown at an unfilled position. Default `'_'`. */
  placeholder?: string;
}

/** The result of formatting a raw value against a template. */
export interface MaskResult {
  /** What belongs in the DOM input — literals, typed characters, and placeholders. */
  display: string;
  /** The characters actually accepted from `raw`, in order. Literals and placeholders excluded. */
  model: string;
  /** True when every token position is filled. */
  complete: boolean;
}

/** A template compiled once, then reused for every keystroke. */
export interface CompiledMask {
  /** Format raw (unformatted) characters into a display string. */
  format(raw: string): MaskResult;
  /** Pull the data characters out of an arbitrary string — a paste, or an edited display value. */
  extract(value: string): string;
  /**
   * Where the caret belongs once `n` data characters precede it: at the start of the next
   * token position, so typing steps over literals on its own.
   */
  caretAfter(n: number): number;
  /** How many token positions the template has. */
  readonly size: number;
}

/**
 * Compile a template into a reusable masker.
 *
 * @throws if `options.tokens` redefines a builtin token or the escape character, or if the
 * template ends with a dangling escape.
 */
export function compileMask(template: string, options: MaskOptions = {}): CompiledMask {
  const placeholder: string = options.placeholder ?? '_';

  for (const key of Object.keys(options.tokens ?? {})) {
    if (key in BUILTIN_TOKENS || key === ESCAPE) {
      throw new Error(
        `mask: token '${key}' is builtin and cannot be redefined — a template must mean the same thing everywhere.`,
      );
    }
  }
  const tokens: Record<string, TokenMatcher> = { ...BUILTIN_TOKENS, ...options.tokens };

  const slots: Slot[] = [];
  for (let i: number = 0; i < template.length; i++) {
    const ch: string = template[i];
    if (ch === ESCAPE) {
      const next: string | undefined = template[i + 1];
      if (next === undefined) throw new Error(`mask: template ends with a dangling '${ESCAPE}'.`);
      slots.push({ literal: next });
      i++;
      continue;
    }
    const matcher: TokenMatcher | undefined = tokens[ch];
    slots.push(matcher ? { match: matcher } : { literal: ch });
  }

  /** Display index of each token position, filled in by `format`. Stable for a given template. */
  const tokenAt: number[] = [];
  {
    let at: number = 0;
    for (const slot of slots) {
      if (!isLiteral(slot)) tokenAt.push(at);
      at += 1; // every slot renders exactly one character (a literal, a value, or a placeholder)
    }
  }
  const size: number = tokenAt.length;

  const format = (raw: string): MaskResult => {
    let out: string = '';
    let model: string = '';
    let ri: number = 0;
    for (const slot of slots) {
      if (isLiteral(slot)) {
        out += slot.literal;
        continue;
      }
      // Drop anything the position cannot hold rather than stalling on it.
      while (ri < raw.length && !slot.match(raw[ri])) ri++;
      if (ri < raw.length) {
        out += raw[ri];
        model += raw[ri];
        ri++;
      } else {
        out += placeholder;
      }
    }
    return { display: out, model, complete: model.length === size };
  };

  /**
   * Walk `value` and the template together. A character matching the current literal consumes
   * it (so a pasted `(370) …` keeps its brackets); a character that does not is retried against
   * the following slot (so a paste of bare digits still lands correctly); a placeholder consumes
   * a token position without contributing data, which is what preserves positions on a
   * middle-of-string edit.
   */
  const extract = (value: string): string => {
    const raw: string[] = [];
    let si: number = 0;
    for (const ch of value) {
      let handled: boolean = false;
      while (si < slots.length && !handled) {
        const slot: Slot = slots[si];
        if (isLiteral(slot)) {
          if (ch === slot.literal) {
            si++;
            handled = true;
          } else {
            si++; // skip the literal and retry this character against the next slot
          }
          continue;
        }
        if (ch === placeholder) {
          si++;
          handled = true;
        } else if (slot.match(ch)) {
          raw.push(ch);
          si++;
          handled = true;
        } else {
          handled = true; // rejected by this position — drop it, keep the position
        }
      }
      if (si >= slots.length && !handled) break;
    }
    return raw.join('');
  };

  const caretAfter = (n: number): number => {
    if (n <= 0) return tokenAt.length > 0 ? tokenAt[0] : 0;
    if (n >= size) return slots.length;
    return tokenAt[n];
  };

  return { format, extract, caretAfter, size };
}

/* ─────────────────── numeric mode ─────────────────── */

/**
 * Numeric mode: an amount, not a shape. Selected by passing `numeric` instead of `template`.
 *
 * A positional template's `9` count *is* its width, fixed when the template is compiled, and it
 * fills left-to-right. A number has no width and grows from the right, so no template string can
 * express one: `'999.99'` truncates `234569871.36` to `234.56` and still reports it complete, and
 * widening it to `'999999999.99'` renders a typed `123.58` as `12358____.__`. Hence a second core.
 *
 * Separators are taken from here and the ambient locale is never read — the displayed format is the
 * organisation's setting, not the viewer's. Grouping is inserted directly rather than through
 * `Intl.NumberFormat`, which always wants a locale and in some of them emits non-ASCII digits.
 */
export interface NumericMaskOptions {
  /** Digits after the separator. 2 = money; 0 = a plain grouped integer. Default 2. */
  decimals?: number;
  /** Decimal separator as shown. Default `'.'`. */
  decimalSeparator?: string;
  /** Thousands separator as shown; `''` disables grouping. Default `''`. */
  groupSeparator?: string;
  /** Upper bound on integer digits; unset = unbounded. A digit past it is refused, never dropped. */
  maxIntegerDigits?: number;
}

/**
 * The numeric core. Its currency is a **digit string** — every digit the user has entered, with no
 * separators — because that is the only representation in which "type a digit" is an append and
 * "backspace" is a truncation, whichever way the display happens to be grouped.
 */
export interface CompiledNumericMask {
  /** Pull the digits out of any string: a display value, a paste, or a canonical model. */
  digitsOf(value: string): string;
  /** Canonical model for a digit string: `'1050'` → `'10.50'`. Empty digits → `''`. */
  toModel(digits: string): string;
  /** Display for a digit string: `'1050'` → `'10,50'`. Empty digits → `''`. */
  toDisplay(digits: string): string;
  /** Digits for a model string: `'10.50'` → `'1050'`. Excess precision is truncated. */
  fromModel(model: string): string;
  /** True when `digits` would exceed `maxIntegerDigits`. */
  overflows(digits: string): boolean;
}

const DIGITS_ONLY: RegExp = /\d/g;

/** Compile numeric options into a reusable core. Pure and DOM-free, like {@link compileMask}. */
export function compileNumericMask(options: NumericMaskOptions = {}): CompiledNumericMask {
  const decimals: number = options.decimals ?? 2;
  const decimalSeparator: string = options.decimalSeparator ?? '.';
  const groupSeparator: string = options.groupSeparator ?? '';
  const maxIntegerDigits: number | undefined = options.maxIntegerDigits;

  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`mask: numeric.decimals must be a non-negative integer, got ${String(decimals)}.`);
  }
  if (decimals > 0 && decimalSeparator === '') {
    throw new Error('mask: numeric.decimalSeparator cannot be empty while decimals > 0.');
  }
  if (groupSeparator !== '' && groupSeparator === decimalSeparator) {
    throw new Error('mask: numeric.groupSeparator and decimalSeparator cannot be the same character.');
  }

  /**
   * Trim leading zeros down to one integer digit — never past it. `'0'` must survive as `0.00`,
   * because "no price set" (`''`) and "free" (`0.00`) are different states and stripping to
   * emptiness would merge them.
   */
  const normalize = (digits: string): string => {
    let d: string = digits;
    while (d.length > decimals + 1 && d.startsWith('0')) d = d.slice(1);
    return d;
  };

  const digitsOf = (value: string): string => normalize((value.match(DIGITS_ONLY) ?? []).join(''));

  /** Split normalized digits into the integer and fraction halves the display and model share. */
  const split = (digits: string): { int: string; frac: string } => {
    const padded: string = digits.padStart(decimals + 1, '0');
    return {
      int: padded.slice(0, padded.length - decimals),
      frac: decimals > 0 ? padded.slice(padded.length - decimals) : '',
    };
  };

  const group = (int: string): string => {
    if (groupSeparator === '') return int;
    let out: string = '';
    for (let i: number = 0; i < int.length; i++) {
      if (i > 0 && (int.length - i) % 3 === 0) out += groupSeparator;
      out += int[i];
    }
    return out;
  };

  const toModel = (digits: string): string => {
    const d: string = normalize(digits);
    if (d === '') return '';
    const { int, frac } = split(d);
    return decimals > 0 ? `${int}.${frac}` : int;
  };

  const toDisplay = (digits: string): string => {
    const d: string = normalize(digits);
    if (d === '') return '';
    const { int, frac } = split(d);
    return decimals > 0 ? `${group(int)}${decimalSeparator}${frac}` : group(int);
  };

  /**
   * A model string is canonical (`'10.50'`), but a caller may hand over `'10.5'` or `'10.567'`.
   * The fraction is padded or **truncated**, never rounded: a mask is not an arithmetic layer, and
   * silently rounding a computed amount would make the field disagree with what was stored.
   */
  const fromModel = (model: string): string => {
    if (model.trim() === '') return '';
    const dot: number = model.indexOf('.');
    const intPart: string = (dot < 0 ? model : model.slice(0, dot)).replace(/\D/g, '');
    const fracRaw: string = dot < 0 ? '' : model.slice(dot + 1).replace(/\D/g, '');
    if (intPart === '' && fracRaw === '') return '';
    const frac: string = decimals > 0 ? fracRaw.slice(0, decimals).padEnd(decimals, '0') : '';
    return normalize(`${intPart === '' ? '0' : intPart}${frac}`);
  };

  const overflows = (digits: string): boolean => {
    if (maxIntegerDigits === undefined) return false;
    const d: string = normalize(digits);
    if (d === '') return false;
    return split(d).int.length > maxIntegerDigits;
  };

  return { digitsOf, toModel, toDisplay, fromModel, overflows };
}

/**
 * A validator for `@weave-framework/forms` reporting an unfinished value. Deliberately a plain
 * `(value) => string | null` so `@weave-framework/ui` never imports `forms` — the caller passes
 * it to `field()`.
 *
 * The mask prevents impossible characters; this reports an incomplete one. They are different
 * jobs, and a field that must be complete composes both.
 */
export function matchesMask(
  template: string,
  options: MaskOptions & { message?: string } = {},
): (value: string) => string | null {
  const compiled: CompiledMask = compileMask(template, options);
  const message: string = options.message ?? 'Incomplete';
  return (value: string): string | null => {
    if (!value) return null; // emptiness is `required`'s business, not the mask's
    return compiled.format(compiled.extract(value)).complete ? null : message;
  };
}

/** What `use:mask` is given. Exactly one of `template` / `numeric` selects the mode. */
export interface MaskSpec extends MaskOptions {
  /**
   * The caller's signal. Holds the **model** value, never the display.
   *
   * What the model *contains* differs by mode: in positional mode it is the characters the user
   * supplied, with literals stripped (`'(999) 999-9999'` → `'3706001234'`); in numeric mode it is
   * the canonical decimal string (`'10.50'`), whose `.` the user never typed. The mode does not
   * transcribe keystrokes — it maintains a number.
   */
  value: Signal<string>;
  /** Positional mode: a template, e.g. `'(999) 999-9999'`. Mutually exclusive with `numeric`. */
  template?: string;
  /** Numeric mode: an amount. Mutually exclusive with `template`. */
  numeric?: NumericMaskOptions;
}

/**
 * `use:mask={{ { value: phone, template: '(999) 999-9999' } }}` — mask a text input in place.
 *
 * The action owns the element's value channel, so do **not** also put `use:control` on the same
 * element: `bindValue` writes the model straight into `input.value` and reads it back, which
 * would push the display value into the model. Bind the field's own signal here instead.
 *
 * An empty model renders an empty input — the template is not shown until there is something to
 * position against, so an untouched form is not a wall of underscores.
 *
 * **Applied to a wrapping component** — `<Input use:mask>` forwards the action to `<Input>`'s root
 * `<div>`, not the `<input>` inside it. So when `el` is not itself a text control, the mask binds to
 * the first `<input>`/`<textarea>` it contains. It never invents a control: an `el` with neither is
 * a misuse and throws, rather than silently doing nothing (FW-17).
 */
export const mask = (el: Element, spec: MaskSpec): void => {
  const hasTemplate: boolean = spec.template !== undefined;
  const hasNumeric: boolean = spec.numeric !== undefined;
  if (hasTemplate && hasNumeric) {
    throw new Error(
      'mask: pass either `template` or `numeric`, not both — there is no merge of a fixed width and a variable one.',
    );
  }
  if (!hasTemplate && !hasNumeric) {
    throw new Error('mask: pass either `template` (positional) or `numeric` (an amount).');
  }
  const control: HTMLInputElement | HTMLTextAreaElement = resolveControl(el);
  if (spec.numeric !== undefined) {
    numericMask(control, spec.value, spec.numeric);
    return;
  }
  positionalMask(control, spec.value, spec.template as string, spec);
};

/**
 * The text control the mask drives: `el` itself when it is an `<input>`/`<textarea>`, otherwise the
 * first one it contains — the case of `use:mask` forwarded onto a component wrapper (FW-17). The
 * tag check is by `tagName`, not `instanceof`, so it does not depend on a browser global being the
 * one this element was constructed from.
 */
const resolveControl = (el: Element): HTMLInputElement | HTMLTextAreaElement => {
  const tag: string = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return el as HTMLInputElement | HTMLTextAreaElement;
  const inner: HTMLInputElement | HTMLTextAreaElement | null = el.querySelector<
    HTMLInputElement | HTMLTextAreaElement
  >('input, textarea');
  if (!inner) {
    throw new Error(
      `mask: <${tag.toLowerCase()}> is not a text control and contains no <input>/<textarea> to bind to.`,
    );
  }
  return inner;
};

/** Positional mode — see {@link compileMask}. */
const positionalMask = (el: Element, value: Signal<string>, template: string, options: MaskOptions): void => {
  const input: HTMLInputElement = el as HTMLInputElement;
  const compiled: CompiledMask = compileMask(template, options);

  let composing: boolean = false;

  /** Write `raw` to both the element and the signal, placing the caret after `n` data chars. */
  const apply = (raw: string, n: number): void => {
    const result: MaskResult = compiled.format(raw);
    input.value = result.display;
    const caret: number = compiled.caretAfter(Math.min(n, result.model.length));
    input.setSelectionRange(caret, caret);
    if (value() !== result.model) value.set(result.model);
  };

  /** Data characters preceding `pos` in the element's current display value. */
  const dataBefore = (pos: number): number => compiled.extract(input.value.slice(0, pos)).length;

  const onInput = (): void => {
    if (composing) return; // leave the IME alone until it commits
    const caret: number = input.selectionStart ?? input.value.length;
    const n: number = dataBefore(caret);
    apply(compiled.extract(input.value), n);
  };

  /**
   * Backspace has to be intercepted: the mask re-inserts literals, so deleting one would appear
   * to do nothing and the user would have to press the key twice. Delete the data character
   * before the caret instead, however many literals sit in between.
   */
  const onBeforeInput = (ev: Event): void => {
    const e: InputEvent = ev as InputEvent;
    if (e.inputType !== 'deleteContentBackward') return;
    const start: number = input.selectionStart ?? 0;
    const end: number = input.selectionEnd ?? 0;
    if (start !== end) return; // a real selection deletes exactly what is selected
    e.preventDefault();
    const n: number = dataBefore(start);
    if (n === 0) return; // nothing of the user's own to remove
    const raw: string = compiled.extract(input.value);
    apply(raw.slice(0, n - 1) + raw.slice(n), n - 1);
  };

  const onCompositionStart = (): void => {
    composing = true;
  };
  const onCompositionEnd = (): void => {
    composing = false;
    onInput();
  };

  el.addEventListener('beforeinput', onBeforeInput);
  el.addEventListener('input', onInput);
  el.addEventListener('compositionstart', onCompositionStart);
  el.addEventListener('compositionend', onCompositionEnd);

  onDispose(() => {
    el.removeEventListener('beforeinput', onBeforeInput);
    el.removeEventListener('input', onInput);
    el.removeEventListener('compositionstart', onCompositionStart);
    el.removeEventListener('compositionend', onCompositionEnd);
  });

  // Track the signal so a programmatic change re-renders the display — but never fight the user
  // mid-composition, and never rewrite an input the user is actively editing into the same value.
  effect(() => {
    const model: string = value();
    if (composing) return;
    const result: MaskResult = compiled.format(model);
    const shown: string = model === '' ? '' : result.display;
    if (input.value !== shown) input.value = shown;
  });
};

/** How many digits `s` contains. */
const countDigits = (s: string): number => {
  let n: number = 0;
  for (const ch of s) if (ch >= '0' && ch <= '9') n++;
  return n;
};

/**
 * Numeric mode — see {@link compileNumericMask}.
 *
 * The caret rule is the mirror of the positional one: where a template counts data characters from
 * the **left**, an amount counts digits from the **right**. That single inversion is what keeps the
 * caret against the digit the user just typed while inserted group separators shift the text under
 * it, and it is why a grouped field does not need any per-separator bookkeeping.
 */
const numericMask = (el: Element, value: Signal<string>, options: NumericMaskOptions): void => {
  const input: HTMLInputElement = el as HTMLInputElement;
  const compiled: CompiledNumericMask = compileNumericMask(options);

  let composing: boolean = false;

  /** Offset in `display` with exactly `digitsAfter` digits following it. */
  const caretFromRight = (display: string, digitsAfter: number): number => {
    let seen: number = 0;
    for (let i: number = display.length; i > 0; i--) {
      if (seen === digitsAfter) return i;
      const ch: string = display[i - 1];
      if (ch >= '0' && ch <= '9') seen++;
    }
    return 0;
  };

  /** Write `digits` to both the element and the signal, keeping `digitsAfter` digits after the caret. */
  const apply = (digits: string, digitsAfter: number): void => {
    const display: string = compiled.toDisplay(digits);
    const model: string = compiled.toModel(digits);
    input.value = display;
    const caret: number = caretFromRight(display, digitsAfter);
    input.setSelectionRange(caret, caret);
    if (value() !== model) value.set(model);
  };

  /** Re-render from the signal, discarding whatever the element currently shows. */
  const revert = (digitsAfter: number): void => {
    const digits: string = compiled.fromModel(value());
    const display: string = compiled.toDisplay(digits);
    input.value = display;
    const caret: number = caretFromRight(display, digitsAfter);
    input.setSelectionRange(caret, caret);
  };

  const onInput = (): void => {
    if (composing) return; // leave the IME alone until it commits
    const caret: number = input.selectionStart ?? input.value.length;
    const digitsAfter: number = countDigits(input.value.slice(caret));
    const digits: string = compiled.digitsOf(input.value);
    // Past `maxIntegerDigits` the digit is refused, not dropped: dropping it silently is exactly
    // the defect the positional mode has with an over-long amount.
    if (compiled.overflows(digits)) {
      revert(digitsAfter);
      return;
    }
    apply(digits, digitsAfter);
  };

  /**
   * Backspace deletes the digit before the caret, however many separators sit in between — a group
   * separator is not the user's character, so removing it would have to be undone anyway.
   */
  const onBeforeInput = (ev: Event): void => {
    const e: InputEvent = ev as InputEvent;
    if (e.inputType !== 'deleteContentBackward') return;
    const start: number = input.selectionStart ?? 0;
    const end: number = input.selectionEnd ?? 0;
    if (start !== end) return; // a real selection deletes exactly what is selected
    e.preventDefault();
    const digitsAfter: number = countDigits(input.value.slice(start));
    const digits: string = compiled.digitsOf(input.value);
    const at: number = digits.length - digitsAfter - 1;
    if (at < 0) return; // nothing of the user's own before the caret
    apply(digits.slice(0, at) + digits.slice(at + 1), digitsAfter);
  };

  const onCompositionStart = (): void => {
    composing = true;
  };
  const onCompositionEnd = (): void => {
    composing = false;
    onInput();
  };

  el.addEventListener('beforeinput', onBeforeInput);
  el.addEventListener('input', onInput);
  el.addEventListener('compositionstart', onCompositionStart);
  el.addEventListener('compositionend', onCompositionEnd);

  onDispose(() => {
    el.removeEventListener('beforeinput', onBeforeInput);
    el.removeEventListener('input', onInput);
    el.removeEventListener('compositionstart', onCompositionStart);
    el.removeEventListener('compositionend', onCompositionEnd);
  });

  effect(() => {
    const model: string = value();
    if (composing) return;
    const shown: string = compiled.toDisplay(compiled.fromModel(model));
    if (input.value !== shown) input.value = shown;
  });
};
