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

/** What `use:mask` is given. */
export interface MaskSpec extends MaskOptions {
  /** The caller's signal. Holds the **model** value — typed characters only, never the display. */
  value: Signal<string>;
  /** The positional template, e.g. `'(999) 999-9999'`. */
  template: string;
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
 */
export const mask = (el: Element, spec: MaskSpec): void => {
  const input: HTMLInputElement = el as HTMLInputElement;
  const compiled: CompiledMask = compileMask(spec.template, spec);
  const value: Signal<string> = spec.value;

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
