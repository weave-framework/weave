# Contributing to Weave

Thanks for your interest in improving Weave 🧵 — a signal-native, no-Virtual-DOM,
zero-dependency front-end framework. Contributions of all sizes are welcome: bug
reports, docs, tests, and code.

## Ground rules (what makes a change land)

Weave has a few hard, non-negotiable principles. A change that breaks one won't be merged:

- **Zero runtime dependencies.** Everything is built in-house. Native `Intl` / DOM /
  Web Animations are fine; a new third-party runtime dependency is not.
- **One reactive model.** Signals all the way down (`signal` / `computed` / `effect`).
  No Virtual DOM, no second paradigm.
- **Compose, don't duplicate.** In `@weave-framework/ui`, build on the existing
  components and CDK primitives; don't re-create a look-alike. Shared visuals live in
  SCSS mixins; every value flows from a component's own design tokens.
- **Fail loud, not silent.** Ambiguous input should error at parse/compile time with a
  clear message rather than misbehave at runtime.
- **Accessible by construction** (for UI). Components follow the WAI-ARIA patterns — correct
  roles and state, keyboard support, focus management, reduced motion — as part of the change,
  not as a follow-up.
- **A fix isn't done until a test fails without it.** Add a test that reproduces the bug
  (or covers the feature) and would fail on `main` — then make it pass.

These are Gate 1: a change that breaks one is declined regardless of how popular it is. For
the full picture of how a proposal becomes part of Weave, see [GOVERNANCE.md](GOVERNANCE.md);
for how changes are versioned, see [VERSIONING.md](VERSIONING.md).

## Getting started

Prerequisites: **Node 22+** and **pnpm 11+**.

```bash
pnpm install                 # install the workspace
pnpm test                    # run the full browser test suite (Playwright / Chromium)
pnpm typecheck               # type-check every package
pnpm lint                    # eslint .
pnpm verify:ui-sass          # verify the UI token schemas compile
```

Beyond those four, the repo has a family of `verify:*` scripts that check contracts an ordinary
test can't see — bundle-size budgets, the server-render/resume round-trip in a real browser, the
UI library's consumability from its built `dist`, and each editor/tooling integration. CI runs
them all; `package.json` lists them.

The repo is a pnpm workspace under `packages/`. The framework runtime, compiler, CLI,
router, forms, store, i18n, data layer, and UI library are each their own package.

## Making a change

1. **Fork** the repository and create a branch off `main`.
2. Make your change with a focused scope — one logical change per pull request.
3. **Add or update tests** (`*.browser.ts`) so the change is covered and would fail
   without it. Keep the suite green.
4. Make sure `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass locally. CI runs those on
   your pull request, plus the build, the size budgets, and the `verify:*` suite — so it's worth
   running the `verify:*` script closest to what you touched before pushing.
5. Match the surrounding code — naming, comment density, and idioms. New code should read
   like the code already there.

## Pull requests

- Keep the PR description clear: what changed, why, and how it was verified.
- Reference any related issue.
- All CI checks must pass and the change needs a maintainer review before it can be merged.
- Small, well-tested PRs are reviewed fastest.

## Developer Certificate of Origin (sign-off)

By contributing, you certify that you wrote the patch (or otherwise have the right to
submit it) under the project's license — the [Developer Certificate of Origin](https://developercertificate.org/).
Certify it by **signing off** each commit:

```bash
git commit -s -m "fix: ..."
```

This adds a `Signed-off-by: Your Name <you@example.com>` line to the commit message.

## Reporting bugs & proposing changes

- **Bugs** → open a [GitHub Issue](https://github.com/weave-framework/weave/issues) with a
  minimal reproduction, what you expected, and what happened.
- **Ideas & feature requests** → start a [GitHub Discussion](https://github.com/weave-framework/weave/discussions),
  not an issue. Describe the use case first — the "why" matters more than the "how".
- **Substantial changes** then go through an [RFC](rfcs/) — see the
  [RFC process](rfcs/README.md) and [GOVERNANCE.md](GOVERNANCE.md).

## License

By contributing, you agree that your contributions are licensed under the same license as
the project (see [LICENSE](LICENSE)).
