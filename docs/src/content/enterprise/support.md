# Support

**Weave is free, open-source, and MIT-licensed — and it always will be.** For teams running Weave in production,
commercial support is available for when you want a name to call, not just an issue tracker.

## Community — free, forever

Everything most projects ever need:

- Full documentation, guides, and API reference
- GitHub issues for bug reports, triaged on a best-effort basis
- A public changelog and a *don't-break-your-app* stability commitment

No account, no paywall. This is the default, and it's real.

## Priority support — for teams in production

When Weave is on your critical path and best-effort isn't enough:

- A **direct support channel**, not the public queue
- **Priority triage** of your bug reports — your issues jump the line
- **Response targets agreed with you before we start**, scoped to what we can actually hold to
- Guidance on upgrades and version pinning

Terms are set per engagement. We would rather agree a narrower commitment and meet it than publish a
number here that turns out to be optimistic for your situation.

[Get in touch :icon[arrow-right]](mailto:support@weaveframework.dev)

## Consulting & integration — hands-on help

Want Weave working in your codebase fast, or running alongside what you already have?

- Architecture and adoption review
- **Incremental integration** into an existing application, whatever it's built with
- Migration planning, custom components, and internal training
- Performance and accessibility deep-dives

[Get in touch :icon[arrow-right]](mailto:support@weaveframework.dev)

## Enterprise — tailored to you

Everything above, plus terms scoped to what you actually need — private advisory, roadmap input, and prioritized
fixes for the issues that block you.

[Get in touch :icon[arrow-right]](mailto:support@weaveframework.dev)

---

**One honest note.** Weave is deliberately zero-dependency and MIT-licensed, which means the ultimate support
guarantee is already built in: you own the code outright, with no third-party packages that can rot out from under
you. Commercial support makes Weave *faster and easier* to run in production — it's never the thing standing between
you and shipping. [Is Weave safe to bet on? :icon[arrow-right]](/enterprise/safe-to-bet-on)

## When you are stuck

Before support of any kind, three checks close most problems faster than a reply could — and doing them
first is also what makes a report answerable.

:::callout see "The three that solve it most often"
**Run `weave check`.** It reads your templates as well as your `.ts`, and most "it does not work" turns
out to be something it already names — an uncalled signal, a prop a child requires, a directive on a
component tag.

**Read the build output.** Weave warns rather than failing for things that still run: a component that
cannot resume, an entity that renders as text, a URL that executes code. A warning here is a subtree
behaving differently from how you think it does.

**Check the stylesheet.** If something renders correctly and looks wrong, it is almost always the missing
`@use` or a theme emitted from the wrong file. See [UI installation](/ui/installation#when-it-goes-wrong).
:::

**A report that gets answered quickly** names the version (`weave --help` prints it alongside the
commands), says whether it reproduces with `weave build` as well as `weave dev`, and includes the exact
message rather than a description of it. A component that fails in your app and not in a fresh scaffold
is a different bug from one that fails in both, and knowing which halves the work.

:::callout info "What support cannot do"
None of the tiers reviews your application's business logic or takes on your deadline. Priority support
is faster access to the people who wrote the framework, about the framework. Consulting is where somebody
works inside your codebase — they are different things, and the difference is which of them you need.
:::
