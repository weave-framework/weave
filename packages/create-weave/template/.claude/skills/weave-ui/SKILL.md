---
name: weave-ui
description: >-
  The @weave-framework/ui component library — using its ready-made components AND
  authoring new ones. Use this whenever you reach for UI building blocks (Button,
  Input, Select, Dialog, Table, Menu, Tabs, Datepicker, Tooltip, List, Snackbar,
  …), theme/token styling of them, forms integration, or when building a new
  reusable styled component or CDK behavior primitive (overlay, focus, positioning,
  drag-drop). Reach for it on any mention of a UI component, design system, theming,
  "a dialog/table/dropdown/date picker", accessibility of a control, or "make a
  reusable component". For plain templates use weave-templates.
---

# Weave UI (@weave-framework/ui)

A full application component library built ON Weave, in two layers: styled
components on top of a headless behavior layer (the CDK). Signal-native,
zero-dep, accessible (WAI-ARIA), themeable via SCSS tokens. Two audiences:
**(1) consuming** the ready components, **(2) authoring** new ones. Each component
is a subpath import; the dist ships a typed `export default`, so
`import Button from '@weave-framework/ui/button'` just works.

## Consuming components

```ts
import Button from '@weave-framework/ui/button';
import Input from '@weave-framework/ui/input';
import Dialog from '@weave-framework/ui/dialog';
```
```html
<Input bind:value={{ name }} label="Name" />
<Button variant="primary" on:click={{ save }} disabled={{ !valid() }}>Save</Button>
```
- Import each component from its subpath (`@weave-framework/ui/<name>`). Used only in the template? No `void` keep-alive needed with the editor tooling active (weave-component).
- Props are passed as attributes; **`on:x` events are callback props**; **`bind:value`/`bind:checked`** wire two-way; a **bare** attribute is `true` (`<Button disabled>`).
- Compose them — a component's `on:` and data props forward as documented per component.

### The catalog (import name = subpath)

All **38**, each importable as `@weave-framework/ui/<name>`:

`autocomplete` · `badge` · `bottom-sheet` · `button` · `button-toggle` · `card` · `checkbox` · `chips` · `context-menu` · `date-range-picker` · `datepicker` · `dialog` · `expansion` · `form-field` · `grid-list` · `icon` · `input` · `list` · `menu` · `menubar` · `paginator` · `popover-edit` · `progress-bar` · `progress-spinner` · `radio` · `ripple` · `select` · `sidenav` · `slide-toggle` · `slider` · `snackbar` · `stepper` · `table` · `tabs` · `timepicker` · `toolbar` · `tooltip` · `tree`.

Don't invent a component outside this list. Note `divider` and `overlay` are **style-only** subpaths (SCSS, no JS component to import); `context-menu` is JS-only.

Form controls (`input`, `select`, `checkbox`, `radio`, `slide-toggle`, `slider`, `datepicker`, `chips`, `autocomplete`) integrate with **weave-forms** (`use:control`) and with `bind:`. Overlays (`dialog`, `menu`, `tooltip`, `snackbar`, `bottom-sheet`) sit on the CDK overlay/positioning layer.

## Theming & tokens

Components are styled entirely through **CSS custom properties (tokens)** — every value in a component's SCSS comes from a `var()` off that component's token schema, never a hardcoded literal. Theme by setting tokens (globally or scoped):

```scss
:root {
  --w-button-bg: #4f46e5;
  --w-button-fg: #fff;
  --w-radius: 8px;
}
```
Set brand/contrast tokens at the app root; component look follows. Dark mode / RTL are supported (logical CSS + `[dir=rtl]` handling).

## Authoring a NEW UI component — the rules

If a built-in falls short, follow these (they keep the library coherent):

1. **No duplication (RULE #1).** Never re-create a Button/Input/Select — **compose** the existing one. A new component is built out of existing components + CDK primitives, not from scratch.
2. **Only Weave**, signal-native, zero third-party deps. Behavior is in-house.
3. **One style.** Every SCSS value comes from `var()` off the component's own **token schema** — no hard-coded colors/sizes. Define the token schema; expose sensible defaults.
4. **Accessible.** WAI-ARIA roles/states, keyboard nav, focus management, `prefers-reduced-motion`. Use the CDK primitives rather than hand-rolling.
5. **Native-first.** Prefer a real `<input>`/`<button>`/`<dialog>` + enhancement over a div soup.

### CDK primitives (`@weave-framework/ui/cdk`) — the headless behavior layer

Build interactive components on these instead of reinventing them: **Overlay** + connected **positioning**, **Portal**, **focus-trap** / **focus-monitor**, **live-announcer**, **key-managers** (list/tree, RTL-aware), **Observers**, **BreakpointObserver**, **virtual scroll**, **drag & drop**, **SelectionModel**, **mask**, clipboard, date-adapter. They are unstyled and reusable — the same overlay powers dialog/menu/tooltip.

**Input masking** (`@weave-framework/ui/mask`, RFC 0010) — format a text input as the user types, against a template you write:

```html
<Input use:mask={{ { value: phone, template: '(999) 999-9999' } }} />
<Input use:mask={{ { value: iban, template: 'LT99 9999 9999 9999 9999' } }} />
```

Template tokens: `9` digit · `a` letter · `*` either · `\` escapes the next character into a literal · anything else is a literal. Extend the alphabet with `tokens: { H: (ch) => /[0-9a-f]/i.test(ch) }`; redefining a builtin throws.

- `use:mask` on a component binds the **inner** `<input>`/`<textarea>`, so `<Input use:mask>` works as written — the action lands on the wrapper and resolves the control within (a wrapper with no text control throws).
- `value` is a **`Signal<string>`, not a `Field`**, and holds the **model** value — typed characters only (`3706001234`), never the display (`(370) 600-1234`).
- **Do not put `use:control` on the same element.** The mask owns the value channel; `bindValue` would push the display value into the model. Bind the field's own `.value` signal here instead.
- Completeness is a validator, not an entry rule: `field('', [matchesMask('(999) 999-9999')])`.

**Money and other amounts use `numeric`, never a template** — a template's `9` count is a fixed width filled left-to-right, so `'999.99'` truncates `234569871.36` to `234.56` and needs `00001` typed for one cent:

```html
<Input use:mask={{ { value: price, numeric: { decimals: 2, decimalSeparator: ',', groupSeparator: '.' } } }}>
  <span slot="prefix">€</span>
</Input>
```

- Digits fill from the **right**: `1`,`0`,`5`,`0` → `0,01` → `0,10` → `1,05` → `10,50`. Integer part unbounded unless `maxIntegerDigits` is set (a digit past it is refused, not dropped).
- The model is a **canonical decimal string** (`'10.50'`) — always `.`, never grouped, never the prefix. Note this differs from positional mode, where the model is the typed characters.
- Empty → `''`, not `'0.00'` ("no price" ≠ "free"); a typed `0` → `'0.00'`.
- Separators come from **props, never the locale** — the format belongs to the organisation, not the viewer.
- `template` and `numeric` are mutually exclusive; passing both throws. `matchesMask` is positional-only — bound an amount with ordinary validators.

### Component composition mechanics

- Tags are PascalCase `<Component>`; `on:X` auto-forwards to the child root; shared look lives in shared SCSS mixins (`_helpers.scss`), shared token defaults in one place.
- A component may **extend** another (RFC 0008: `export const extend = Base` for full override, or `export const patch = [...]` for declarative template patches) — reuse a base's behavior/markup instead of copying.

## Patterns

- **Forms**: `use:control={{ field }}` on `@weave-framework/ui` inputs, or `bind:value` for plain two-way (weave-forms).
- **Lists**: `<List>` with a `rowTemplate` `@snippet` (typed) + `CursorList` + `InfiniteScroll` for large/cursor-paged data (weave-data).
- **Overlays**: prefer the built-in `Dialog`/`Menu`/`Snackbar` over hand-rolled portals.
- **Theme once** at the root via tokens; don't override component internals with `!important`.

## Gotchas

- Import from the **subpath** (`@weave-framework/ui/button`), not a barrel.
- Don't hardcode style values in a new component — thread everything through `var()` tokens.
- Don't duplicate an existing control — compose it.
- Overlays/positioning: reach for the **CDK** primitives, not raw DOM math.
