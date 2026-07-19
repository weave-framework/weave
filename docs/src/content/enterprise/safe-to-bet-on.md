# Is Weave safe to bet on?

It's the right question to ask before you build something real on a young framework. Not "is it clever?" — but
"will this still be here, and still not hurt me, in three years?" Here is the honest answer, and the reasons behind it.

## You can never be stranded

Weave is **MIT-licensed and has zero third-party runtime dependencies.** Put those two facts together and you get
something most frameworks can't offer: **you own what you ship, outright.**

There's no company that can pull the rug, no upstream package that can be unpublished, no transitive tree that can
break. In the worst case imaginable — the project stops moving tomorrow — you still have the complete,
dependency-free source under a permissive license. You can read all of it, fork it, and maintain it yourself,
because there's nothing underneath it but your own code and the platform.

That's not a promise about our intentions. It's a property of how Weave is built, and it can't be taken away.

## Nothing can rot out from under you

That same zero-dependency design is why Weave stays calm in a serious codebase:

- **No supply-chain surface.** No transitive packages means effectively nothing to audit, nothing to catch a CVE at 2am, no `npm audit` churn to babysit.
- **No dependency drift.** Your build doesn't quietly change because something three levels down shipped a new minor. What you tested is what you ship.

For a team that has to answer to a security review, *"zero third-party runtime dependencies"* is a sentence that
ends a lot of meetings early.

## Upgrades stay boring — on purpose

Stability isn't a milestone Weave is waiting on — it's a standing priority, and the public record backs it up.
The API was frozen at **1.0**, and the whole 1.x line — more than twenty releases — was patches and minors, with
no breaking change to the code you write. New capability landed additively, behind its own surface: static
generation and resume arrived in 1.6.0 as a whole new rendering mode, and existing code did not change by a
character.

**2.0.0 is the one major so far, and it is worth being precise about what it was.** Nothing was removed, nothing
was renamed, and no signature changed — code written against 1.x still compiles. It is a major because four bug
fixes make existing code *behave* differently: a reactive update that used to be silently dropped is now
delivered, `@await` re-renders when its data changes instead of showing a stale value, store effects live for the
app's lifetime instead of dying with the first component that used one, and the formatter stopped altering the
markup it formatted. Each of those was a defect; fixing a defect can still change behaviour, and the version
number says so rather than hiding it. That is the promise working, not the promise breaking.

(Before 1.0, Weave was on a `0.x` line where the shape of things was still settling — that's what a `0.x` is for.
The commitment below starts from the 1.0 freeze, which is the version you'd be adopting.)

We won't pretend a breaking change can *never* happen — one day something may genuinely need to change at its root.
What we commit to is that when that day comes, it won't blindside you:

- **Never by surprise.** A breaking change would be a deliberate, clearly flagged release of its own — not something that slips into a routine upgrade.
- **Deprecated first.** The old way keeps working through a deprecation window, with warnings that point to the replacement, before anything is removed.
- **With a path forward.** Clear migration notes, and a codemod wherever one is feasible.

So the promise isn't *"it will never change."* It's *"it will never change out from under you."*

## Everything you need is first-party

A lot of "framework risk" is really *ecosystem* risk — betting on fifteen third-party packages that each carry their
own bus factor. Weave removes most of that by shipping the pieces itself, all on one reactive core:

- [Routing](/learn/router), [state](/learn/store), [forms](/learn/forms), and [internationalization](/learn/i18n) — first-party, sharing the same signals as everything else.
- A [complete UI component library](/ui/theming) — buttons to data tables to date pickers — built to the WAI-ARIA accessibility patterns, with keyboard support and focus management handled for you.

You're not assembling a stack and hoping the parts keep agreeing with each other. They're cut from the same cloth.

## Tested, and used in earnest

- A **broad browser test suite** runs against the real framework, not a mocked stand-in.
- Weave is **dogfooded end to end** — the documentation site you're reading right now is built with it.
- **First-class editor support** for VS Code *and* WebStorm, so the tooling holds up on a real team.

## What we're still building — honestly

We won't oversell the young parts. **[Static generation and resume](/learn/static-generation)** shipped in 1.6.0
and are new: `weave build --ssg` prerenders every route to real HTML, and the browser adopts it rather than
rebuilding it. That covers SEO and first paint with no server in the request path. **Rendering per request is
deliberately not built** — if your project needs request-time SSR or streaming today, that is a real gap to
weigh. The third-party ecosystem is still small. The foundation, though — the reactive core, the first-party
stack, the zero-dependency guarantee — is real and tested now.

## The bottom line

Weave asks you to bet on a foundation you can fully own, that can't rot out from underneath you, and that treats
*not breaking your app* as its first job. If it vanished tomorrow, you'd still have everything you shipped. That's
about as safe as a bet on a young framework gets.

> Building something real on Weave and want to talk it through? [Commercial support is available →](/enterprise/support)
