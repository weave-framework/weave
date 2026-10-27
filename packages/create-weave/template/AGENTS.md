# Working in this Weave app

Instructions for an AI coding assistant. A human is welcome to read them too; they are the project's
conventions in one page.

## Read the skill for the area first

The scaffold ships one skill per subsystem, written by the framework's authors and kept in step with the
installed version — a `SKILL.md` file per area, under the editor-skills directory at the project root
(search the project for `SKILL.md`). Before writing or changing code in an area, read its skill:

| Area | Skill |
| --- | --- |
| How an app fits together (start here) | `weave-app` |
| A component: `setup()` + its template | `weave-component` |
| Template syntax (`{{ }}`, `@if`, `@for`, `on:`, `bind:`) | `weave-templates` |
| Signals, computeds, effects | `weave-reactivity` |
| Routing | `weave-router` |
| Forms and validation | `weave-forms` |
| Shared app state | `weave-store` |
| Fetching and mutations | `weave-data` |
| Translations | `weave-i18n` |
| The UI component library | `weave-ui` |
| CLI, config, type-checking, editors | `weave-tooling` |

## The conventions in short

- **A component is two files**, same base name: `name.ts` exporting `setup()` and `name.html`. An optional
  `name.css` beside them is scoped to the component automatically. No class, no decorator, no registration.
- **Do not write `return` in `setup()`.** The compiler reads the template and exposes exactly the names it
  uses. Write one only to rename or to keep something private.
- **A signal is read by calling it**: `{{ count() }}`, never `{{ count }}` (that prints the function's
  source). Events are `on:click={{ handler }}`; every binding uses double braces.
- **A tag that starts with a capital letter is a component**, found by its folder next to the parent
  (`./user-card/user-card`), so no import is needed for a sibling. `npx weave add component UserCard`
  writes the files in the right place.
- **Type-check after editing**: `npm run check`. `npm run dev` also runs it after every rebuild and shows
  the result at the bottom of the page.
- **The UI library** is `npm install @weave-framework/ui` plus one line in `weave.config.ts`:
  `styles: ['@weave-framework/ui/weave-ui.css']`. Components are per-subpath imports
  (`import Button from '@weave-framework/ui/button'`).
- **No third-party runtime dependencies** is a framework rule; keep it in the app unless the human asks.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with live reload and an after-rebuild type-check |
| `npm run check` | Type-check templates and the rest of the `.ts` |
| `npm run build` | A deployable static `dist/` |
| `npx weave add component <Name>` | A new component next to the root component |

Documentation: https://weaveframework.dev
