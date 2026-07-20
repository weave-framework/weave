# RFC 0010: Input masking (`use:mask`)

- **Status:** Draft
- **Author(s):** Aidas Josas (@aidasjosas)
- **Discussion:** —

## Summary

A headless CDK primitive that formats a text input **as the user types**, in one of two modes: a
caller-written positional template (`(999) 999-9999`) for anything with a fixed shape, and a
numeric mode for amounts, which have no fixed width and fill from the right. No locale involvement
in either. Applied to the existing `<Input>` as a directive; no new component, and `<Input>` itself
is untouched.

## Motivation

There is no supported way to format a value while it is being typed, keep the caret where the user
expects it, and hand a clean value back to a form. Every screen that needs one grows its own
`oninput` handler.

Pulled by a real application (a dance-school admin app, the current dogfooding consumer): phone
numbers, IBANs and prices are entered by hand in several forms, and each screen would otherwise
grow its own ad-hoc `oninput` handler. That is the milestone-pull rule in `ROADMAP.md` — this is
not speculative.

## How it fits Weave

- **Compose, don't duplicate.** A `<CurrencyInput>` / `<PhoneInput>` family would be `<Input>`
  copies differing in one behaviour. UI rule #1 rejects that. Masking is behaviour, so it belongs
  in the CDK layer beside `focus-trap`, `key-manager` and `drag-drop`.
- **Zero third-party dependencies**, and no new first-party ones either: `@weave-framework/ui`
  depends only on `@weave-framework/runtime`, and this primitive keeps it that way (see "Wiring").
- **One reactive model.** The mask holds no state of its own beyond caret bookkeeping; the value
  lives in the caller's signal.
- **Not `extend`/`patch` (RFC 0008).** Extension composes *markup*. This proposal changes no markup
  at all — only behaviour — so extension would be the wrong instrument.

## Design

### Two modes, because a number is not a string of positions

A mask is a **string of characters matching a template**. That is the whole model for anything with
a fixed shape:

```html
<Input use:mask={{ { value: phone, template: '(999) 999-9999' } }} />
<Input use:mask={{ { value: iban, template: 'LT99 9999 9999 9999 9999' } }} />
```

An **amount of money is not such a thing**, and a second mode exists for it. See "Numeric mode"
below for the design and "Why the first draft was wrong" for why this RFC once said otherwise.

### Numeric mode

Selected by passing a `numeric` spec instead of a `template`. The two are mutually exclusive;
passing both **throws**, because there is no sensible merge of a fixed width and a variable one.

```html
<Input use:mask={{ { value: price, numeric: { decimals: 2, decimalSeparator: ',' } } }}>
  <span slot="prefix">€</span>
</Input>
```

```ts
export interface NumericMaskOptions {
  /** Digits after the separator. 2 = money; 0 = a plain grouped integer. Default 2. */
  decimals?: number;
  /** Decimal separator as shown. Default '.'. */
  decimalSeparator?: string;
  /** Thousands separator as shown; '' disables grouping. Default '' (no grouping). */
  groupSeparator?: string;
  /** Upper bound on integer digits; unset = unbounded. */
  maxIntegerDigits?: number;
}
```

#### Digits fill from the right

This is the whole reason the mode exists. A positional template fills left-to-right, so its `9`
count *is* the field width, fixed when the template is compiled. A number grows from the right and
has no width. The two cannot be reconciled by any template string.

Measured against the positional implementation, with `'999.99'`:

| typed | display | model | |
| --- | --- | --- | --- |
| `123.58` | `123.58` | `12358` | correct only because the integer part is exactly 3 digits |
| `234569871.36` | `234.56` | `23456` | **silently truncated, and reported `complete: true`** |
| `1,50` into `999,99` | `150,__` | `150` | reads as one hundred fifty |
| `00150` into `999,99` | `001,50` | `00150` | correct — at the cost of four leading zeros for one cent |

Widening the template does not help: `999999999.99` renders a typed `123.58` as `12358____.__`,
because those five digits land in the millions positions. There is no width that is right for an
amount whose width is not known in advance.

In numeric mode the keystrokes `1`, `0`, `5`, `0` read `0.01` → `0.10` → `1.05` → `10.50`. This
behaviour is not optional and has no flag: a numeric mask that filled from the left would be the
positional mode with extra steps.

#### The model is a canonical decimal string

**Decided, and this extends the value contract above:** in numeric mode the model is
`"10.50"` — always a `.` as the decimal separator, never grouped, never carrying `prefix`/`suffix`.

This is a deliberate widening of the contract, and it must be named rather than slipped in. In
positional mode the model is *the characters the user supplied* — `'999.99'` yields `'12358'`,
with the `.` stripped as the literal it is. In numeric mode the model is *the canonical value*, and
its `.` is a character the user never typed. The mode does not transcribe keystrokes; it maintains
a number.

The reason is the consumer's, and it is the right one: an amount travels as a decimal string from a
`DECIMAL(10,2)` column through the API and back, and is never a float. A model carrying the
display's comma, grouping or currency symbol would have to be un-formatted at every call site — the
exact class of bug this primitive exists to prevent.

**Empty input yields an empty model (`''`), not `'0.00'`.** "No price set" and "free" are different
states and must not collapse into one. This matches positional mode, where an empty model renders
an empty input rather than a row of placeholders.

**A programmatically-set model is canonicalised for display, truncating excess precision** —
`'10.567'` with `decimals: 2` displays `10.56`, not `10.57`. Truncation over rounding because a mask
is not an arithmetic layer: silently rounding a value the application computed would make the
displayed amount disagree with the stored one. Callers that want rounding round before assigning.

#### Formatting comes from props, never from the locale

**Decided: separators are caller options, and the ambient locale is not read** — no
`navigator.language`, no `Intl` default. In the consuming application the money format is a system
setting an administrator picks, alongside date format and week start. A Dutch-formatted amount must
stay Dutch-formatted for a user reading the interface in English; deriving it from the locale would
make the displayed amount depend on the viewer rather than on the organisation.

**Decided: grouping is implemented directly, not through `Intl.NumberFormat`.** `Intl` always takes
a locale, so feeding it a fixed one and string-replacing its separators afterwards is a locale
dependency wearing a disguise — and in some locales it emits non-ASCII digits, which a masked input
must never do. Inserting a separator every three digits from the right is a few lines, fully
deterministic, and keeps the "no locale involvement" property this RFC claims elsewhere.

#### Behaviour

- **Rejecting, not truncating.** With `maxIntegerDigits` set, a digit past the bound is refused and
  the caret does not move — the same rule as a letter typed into a `9`. Silently dropping it is the
  defect measured above, and it must not survive into the new mode.
- **Caret.** Typing keeps the caret against the last typed digit as inserted separators shift the
  text. Where positional mode counts data characters from the left, numeric mode counts them from
  the right; that mirror is the entire caret rule.
- **Deleting a separator deletes the digit before it.** A separator is not the user's character —
  the same reasoning that already makes backspace step over literals.
- **Paste.** `1 234,56`, `1,234.56` and `€1234.56` all extract to `1234.56`: digits are kept, the
  last separator that is followed by exactly `decimals` digits is the decimal point, everything
  else is discarded.
- **`decimals: 0`** gives a grouped integer field, which also serves capacity and ticket counts.

#### Completeness does not apply

**Decided: `matchesMask` stays positional-only and numeric mode has no completeness notion.** With
no fixed width there is nothing to be complete against — `1.50` is as finished as `1234.50`. Bounds
on a numeric field are range checks (`>= 0.01`, `<= 999.99`), which are ordinary validators the
caller already writes, not shape enforcement. Making `matchesMask` accept a numeric spec would have
it return "Incomplete" for values that are simply small.

### Why the first draft was wrong

The first draft of this RFC cut the numeric mode, and the argument it used does not survive
contact with the problem. It said a currency **symbol** is a `prefix`/`suffix` slot on `<Input>`
rather than mask behaviour — which is true, and answers a question nobody was asking. The symbol
was never the difficulty. Right-to-left filling and a separator that moves as you type are, and the
draft recorded exactly that under "Drawbacks", as *"no live number grouping"*, while treating it as
an acceptable cost.

It was not acceptable. Measured on the shipped build, the positional workaround for money either
truncates an amount silently (`234569871.36` → `234.56`, reported complete) or demands four leading
zeros to enter one cent. The second objection — that a numeric mode would drag in
`@weave-framework/i18n` and a locale-reactivity question — is answered by taking the separators as
props and grouping directly, which is what "Formatting comes from props" specifies.

What remains true from the original argument is the cost of **two mechanisms in one primitive**.
That cost is accepted here rather than waved away: the modes share the `use:` action, the signal
contract and the caret discipline, and differ in the formatting core alone.

This amendment follows the same milestone-pull rule that created the RFC: it is written because the
dogfooding consumer hit the limit in a real price field, not in anticipation of one.

### Wiring: the mask owns the value channel

`mask` takes a plain `Signal`, not a `Field`, and is **not** combined with `use:control` on the
same element:

```ts
export interface MaskSpec extends MaskOptions {
  /** The caller's signal. Holds the **model** value, never the display. */
  value: Signal<string>;
  /** Positional mode. Mutually exclusive with `numeric`; passing both throws. */
  template?: string;
  /** Numeric mode. Mutually exclusive with `template`; passing both throws. */
  numeric?: NumericMaskOptions;
}

mask(el: Element, spec: MaskSpec): void
```

What the model *contains* differs by mode — typed characters in positional mode, a canonical
decimal string in numeric mode (see "The model is a canonical decimal string"). What it never
contains, in either mode, is the display.

`use:control` binds through `bindValue` (`packages/runtime/src/dom.ts`), which writes
`input.value = String(model)` in an effect and reads `input.value` back on every `input` event. A
mask rewriting `el.value` into its display form would therefore push the **display** value into the
model — precisely what the value contract below forbids. Only one of the two can own the channel,
and for a masked field it is the mask.

Consequences: taking a `Signal` (from `runtime`) rather than a `Field` keeps `@weave-framework/ui`
free of a `@weave-framework/forms` dependency, and `matchesMask` is an ordinary
`(v) => string | null` validator the caller passes to `field()` — so the dependency runs from the
application inward, never from `ui` to `forms`.

### Template alphabet

| Token | Accepts |
| ----- | ------- |
| `9` | a digit |
| `a` | a letter |
| `*` | a digit or a letter |
| `\` | escape — the next character is a literal |
| anything else | a literal (spaces, brackets, dashes, fixed letters) |

`\` exists so a mask can require a literal `9`, `a` or `*`. Without it, an alphabet built from
`x`-style wildcards makes those characters permanently unwritable — which rules out real formats
(`AB-9999-\a`, product codes, some national IDs).

**Decided: the alphabet is extensible.** A caller may register additional tokens — a character and
a matcher — so formats the four builtins cannot express (`H` for hexadecimal, a national-alphabet
letter class, a restricted digit range) do not become feature requests:

```ts
mask('HH:HH', { tokens: { H: (ch) => /[0-9a-fA-F]/.test(ch) } })
```

A registered token shadows nothing: redefining `9`, `a`, `*` or `\` is an error, not an override —
a mask string must mean the same thing everywhere it is read.

### Placeholder rendering

**Decided: unfilled positions render as `_`, in the same colour as everything else.** Literals stay
visible throughout, so a half-typed phone reads `(370) 12_-____`. The underscore is what users
already read as "this must be filled".

**Deliberately not done: dimming the unfilled positions.** A lighter placeholder is the obvious
refinement, and it is the expensive one — a native `<input>` renders one string in one colour, so
two weights in one field require an overlay layer beneath a transparent input, with the two texts
kept in exact metric alignment. That would cost a new colour token (and a `token-contract.json`
entry), pixel-alignment tests, an RTL pass through `bidi.ts`, and it would make the primitive no
longer purely behavioural. **Deferred until users actually ask for it**, per the same
no-speculative-building rule that pulled this RFC into existence. The single-colour form is not a
stepping stone to it — it is the shipped answer unless demand appears.

Because the `_` characters live in the input's own value, they are included in a copy or a
select-all. The model value strips them, so what is submitted is unaffected.

### Value contract

The mask exposes two values and they are **not** the same:

- **display value** — what sits in the DOM input, formatted (`(370) 600-1234`).
- **model value** — what the caller's signal holds: the characters the user actually supplied,
  with every literal and placeholder stripped (`3706001234`).

The model value is what validators see and what is submitted. A mask that leaked its display value
into the model would make every server-side format assumption a caller's problem.

**Decided: an incomplete value reaches the model as a partial string, not as empty.** Discarding it
would either lose characters the user actually typed or make `required` pass on a half-filled
field. Completeness is therefore *not* enforced at entry — it is a validation result.

**Decided: the mask ships a `matchesMask` validator** for `@weave-framework/forms`. Shape
enforcement while typing and validity are different jobs: the mask prevents impossible characters,
the validator reports an unfinished value. A field that must be complete composes both.

### Caret behaviour

This is the substance of the primitive, not an afterthought — masking libraries fail here, not at
formatting. The specified rules:

- typing at the end appends past literals without the user typing them;
- editing in the middle keeps the caret on the same *model* character, not the same offset;
- backspace over a literal deletes the model character before it, not the literal;
- paste re-masks the whole value and places the caret after the last accepted character;
- a rejected character (a letter into `9`) is dropped and the caret does not move;
- composition (IME) is left alone until `compositionend`.

### Placement — opt-in, and `<Input>` is untouched

`packages/ui/src/cdk/mask.ts` + `mask.browser.ts`, published under **its own subpath export**,
`@weave-framework/ui/mask`, alongside the per-component subpaths the package already has. `phone`,
`card` and `iban` — if provided at all — are exported **template constants**, not code.

`<Input>` does not change by a single character and has no knowledge of masking. The package is
already `sideEffects: false` with per-component subpaths, so:

```ts
import { Input } from '@weave-framework/ui/input'; // no mask in the bundle — 0 bytes
import { mask } from '@weave-framework/ui/mask';   // present only once this line is written
```

**Decided over a separate npm package** (`@weave-framework/mask`). A standalone package would ship
the same bytes, still depend on `ui` and `i18n`, and so own no independent boundary — while adding
a seventeenth entry to the publish pipeline, its own README, docs page and release line. The
subpath is a plugin in every sense visible at the call site; the package would differ only in
having its own version number.

## Alternatives considered

- **Named presets as the primary API** (`mask="phone"`). Rejected: every unlisted format becomes a
  feature request, and no preset list survives contact with national formats. A caller-written
  template makes presets fall out as constants.
- **A dedicated `<MaskedInput>` component, or a family per format.** Rejected under UI rule #1.
- **A separate npm package.** Rejected in favour of a subpath export — see "Placement" for the full
  argument. Worth recording *why* it came up: from the outside, "a directive in the UI package"
  reads as though `<Input>` gains the capability by default. It does not, and the subpath plus
  `sideEffects: false` is what makes that true rather than merely intended.
- **A locale-aware numeric mode** (`currency('EUR')`, `number()`, `percent()`), formatting through
  `Intl`. Cut in the first draft, and the *locale-aware* half stays cut: the mode this RFC now
  specifies takes its separators as props and never reads the ambient locale. What was wrongly cut
  along with it — right-to-left filling — is restored; see "Why the first draft was wrong".
- **Leaving money to the positional mode.** What the consumer would otherwise have shipped. Rejected
  on measurement, not taste: `'999,99'` needs `00001` typed to enter one cent, and any amount wider
  than its template is truncated without an error.
- **An application-side "format on blur" wrapper.** Proposed and declined by the consumer itself.
  The caret, paste and selection rules are precisely what this primitive already owns, and a second
  weaker implementation beside it is how two behaviours drift apart.
- **A real phone-number library.** `libphonenumber` is ~150 KB *and* a third-party runtime
  dependency, which rule #1 forbids outright. Consequence, stated plainly rather than hidden: a
  template mask enforces *shape*, not validity. `(999) 999-9999` cannot know that a Lithuanian
  mobile number starts with 6. Number **validation** is a validator's job, not the mask's.
- **Do nothing.** Callers keep writing per-screen `oninput` handlers. Workable, and the reason this
  waited for a real pull rather than being built ahead of one.

## Drawbacks & risks

- **Caret handling is where this breaks.** Middle-edit, paste-over-selection, backspace across a
  separator, IME, and mobile virtual keyboards (which report input events inconsistently) are all
  known-hard. The test suite has to cover them explicitly or the primitive ships broken in the ways
  users actually notice.
- **Two mechanisms in one primitive.** The original draft's one real objection, now accepted rather
  than dismissed: `template` and `numeric` are separate formatting cores behind one action. The
  mitigation is that everything *outside* the core — the signal contract, the value/display split,
  caret discipline, IME handling — is shared, and that the modes are mutually exclusive so no call
  site has to reason about both at once.
- **Size.** Additive to `@weave-framework/ui`, which is outside the 22 KB SPA-core budget — but
  `verify:size` still has to be re-run and the delta stated, not assumed harmless.
- **Accessibility.** A formatted value read by a screen reader can be worse than a raw one (digits
  regrouped mid-announcement). Needs a decision on `aria-describedby` carrying the expected format.

## Unresolved questions

None. The four questions the first draft opened are settled — extensible alphabet · a partial value
reaches the model · `matchesMask` ships · `_` placeholders in a single colour — and each is
recorded at its own section above, with dimmed placeholders explicitly deferred rather than left
open.

The three the numeric-mode amendment opened are settled with it: the model is a **canonical decimal
string**, not a keystroke transcript · **completeness does not apply** to a variable-width field, so
`matchesMask` stays positional-only and range is a validator · the caret **counts digits from the
right**, mirroring the positional rule. Each is recorded at its own section, and none is deferred.
