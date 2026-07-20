# RFC 0010: Input masking (`use:mask`)

- **Status:** Draft
- **Author(s):** Aidas Josas (@aidasjosas)
- **Discussion:** —

## Summary

A headless CDK primitive that formats a text input **as the user types**, against a
caller-written template: `(999) 999-9999`. One mechanism, no locale involvement. Applied to the
existing `<Input>` as a directive; no new component, and `<Input>` itself is untouched.

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

### One mode: a positional template, and nothing else

A mask is a **string of characters matching a template**. That is the whole model.

```html
<Input use:mask={{ mask(phone, '(999) 999-9999') }} />
<Input use:mask={{ mask(iban, 'LT99 9999 9999 9999 9999') }} />
<Input use:mask={{ mask(price, '999999,99') }}><span slot="suffix">€</span></Input>
```

**There is no numeric/currency mode, and no `Intl` involvement.** An earlier draft of this RFC
proposed one, on the reasoning that grouping (`1 234 567,89`) cannot be spelled as a positional
template. That reasoning is correct and the conclusion was still wrong: a currency **symbol** is
not a formatting problem — `<Input>` already has `prefix`/`suffix` slots, so `€` is markup, not
mask behaviour. Dropping the numeric mode removes a second mechanism, a `@weave-framework/i18n`
dependency, and a locale-reactivity question, from a package that otherwise depends only on
`@weave-framework/runtime`.

**What that costs, stated plainly:** no live thousands grouping while typing. A price is entered
as `1234,56` with `€` in the suffix, not as `1 234,56 €`. Restoring grouping later is additive —
nothing in the template design forecloses it.

### Wiring: the mask owns the value channel

`mask` takes a plain `Signal`, not a `Field`, and is **not** combined with `use:control` on the
same element:

```ts
mask(value: Signal<string>, template: string, options?: MaskOptions): (el: Element) => void
```

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
  `Intl`. Carried in an earlier draft and cut. It answered a question nobody had: a currency symbol
  is a `suffix` slot on an `<Input>` that already exists, not a mask concern. Keeping it would have
  meant two mechanisms in one primitive and a `@weave-framework/i18n` edge in a package with one
  dependency. What it would genuinely have bought — live thousands grouping — is recorded as a
  drawback rather than pretended away.
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
- **No live number grouping.** A positional template groups from the left and a number groups from
  the right, so `1 234 567` is not expressible. Accepted deliberately (see "One mode"); the escape
  hatch is that adding it later is additive.
- **Size.** Additive to `@weave-framework/ui`, which is outside the 22 KB SPA-core budget — but
  `verify:size` still has to be re-run and the delta stated, not assumed harmless.
- **Accessibility.** A formatted value read by a screen reader can be worse than a raw one (digits
  regrouped mid-announcement). Needs a decision on `aria-describedby` carrying the expected format.

## Unresolved questions

None. The four questions this RFC opened are settled — extensible alphabet · a partial value
reaches the model · `matchesMask` ships · `_` placeholders in a single colour — and each is
recorded at its own section above, with dimmed placeholders explicitly deferred rather than left
open.
