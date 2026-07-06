# @weave-framework/prettier-plugin

A [Prettier](https://prettier.io) plugin for **Weave** templates — formats `.weave` SFCs and
Weave-template `.html` files ( `{{ }}` interpolation, `@if`/`@for`/`@switch`/`@defer`/`@await`
control flow, and `on:`/`bind:`/`use:`/`class:`/`style:`/`ref` bindings ).

Prettier's stock HTML parser throws on the first Weave-specific token
(`SyntaxError: Opening tag "Button" not terminated`), so the usual workaround is to `.prettierignore`
every template — meaning the files you edit most never get formatted. This plugin makes Weave
templates first-class in the standard toolchain: format-on-save, `prettier --check` in CI, and
pre-commit hooks all work again.

It does **not** ship its own grammar. It reuses `@weave-framework/compiler`'s parser, so the
formatter can never drift from what actually compiles. Embedded expressions are formatted by
delegating to Prettier's own `typescript` printer; a `.weave` SFC's `<script>`/`<style>` blocks go
through the `typescript`/`css`/`scss` printers.

## Install

~~~bash
npm install -D @weave-framework/prettier-plugin
# peer dependency:
npm install -D prettier
~~~

## Usage

Add the plugin to your Prettier config. `.weave` files are picked up automatically:

~~~jsonc
// .prettierrc
{
  "plugins": ["@weave-framework/prettier-plugin"]
}
~~~

### Weave `.html` templates

`.html` is also used for plain HTML, so the plugin does **not** claim every `.html` globally. Route
your Weave templates (the sibling-of-`.ts` convention) to the `weave` parser with an `overrides`
entry:

~~~jsonc
// .prettierrc
{
  "plugins": ["@weave-framework/prettier-plugin"],
  "overrides": [
    { "files": "src/**/*.html", "options": { "parser": "weave" } }
  ]
}
~~~

Point the `files` glob at wherever your Weave templates live. Any `.html` **not** matched is left to
Prettier's normal HTML formatter, untouched.

## What it does

- **Elements / components** — attributes on one line when they fit, else one per line; void elements
  self-close.
- **Bindings preserved by kind** — `on:x={{ }}`, `bind:x={{ }}`, `use:x={{ }}`, `class:x={{ }}`,
  `style:x={{ }}`, `ref={{ }}`, `.prop={{ }}`, plain `attr={{ }}`, static `attr="…"`. Kinds and
  event modifiers are never rewritten.
- **Control flow** — `@if`/`@else`, `@for`/`@empty`, `@switch`/`@case`/`@default`, `@defer`/
  `@placeholder`, `@await`/`@then`/`@catch`, `@let`, `@snippet`/`@render`, `@key` are reindented with
  their `@`-syntax intact (and `@@` stays escaped).
- **Interpolations** — the inner expression of every `{{ … }}` is formatted as TypeScript.
- **SFCs** — `<script>` (TypeScript), template, and `<style>` (CSS/SCSS) each formatted; block order
  preserved.
- **Comments** — HTML comments are preserved.
- **Idempotent** — running it twice produces no further changes.

## Whitespace: conservative by design

The current release reindents block structure and formats expressions, but does **not** aggressively
reflow inline text runs — so nothing that could change rendering (significant whitespace between
inline elements, `<pre>`/`<textarea>` content) is altered. Prettier-grade inline whitespace reflow
is a planned follow-up.

## License

MIT
