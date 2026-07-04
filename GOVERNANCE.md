# Governance

How decisions get made in Weave — how an idea becomes part of the framework, and who
decides.

Weave is maintained with one overriding goal: a small, coherent, signal-native framework
that *doesn't break your app*. Governance exists to protect that coherence while making it
easy for the community to shape where Weave goes.

## The shape of it

Weave is led by a **maintainer** who holds final responsibility for design and release.
The community proposes, discusses, and builds; the maintainer curates and decides. This
isn't bureaucracy for its own sake — a tight, consistent design is Weave's single biggest
asset, and design-by-popular-vote is the fastest way to lose it.

That said, **decisions are made in the open, against published criteria** — not by whim.
Here's the pipeline.

## How an idea becomes part of Weave

Every proposal passes through two gates.

### Gate 1 — Does it fit Weave? (the maintainer decides)

Before anything else, a proposal is checked against Weave's non-negotiable principles —
the **Ground rules** in [CONTRIBUTING.md](CONTRIBUTING.md):

- Zero runtime dependencies
- One reactive model — signals; no Virtual DOM, no second paradigm
- Compose, don't duplicate
- Fail loud, not silent
- Accessible by construction (for UI)
- In scope, and a genuine improvement — not surface area for its own sake

A proposal that breaks a principle is **declined with a reason**, no matter how popular.
This gate is what keeps Weave coherent. "Please support RxJS" doesn't get to a vote — it's
declined at the gate, on the record.

### Gate 2 — Is it wanted, and what's the priority? (the community signals)

Proposals that *do* fit the philosophy move into open discussion. Here the community's
voice matters most, in two ways:

- **Demand** — is this genuinely needed, or just theoretically nice?
- **Priority** — of the good ideas, which should be built first?

Reactions and discussion are **input, not a binding vote.** Some foundational work (say,
server-side rendering) may not top a popularity poll yet still needs to come first; the
maintainer sequences the roadmap, informed by the signal.

### Then: design, build, review

- For anything substantial, the design is written up as an **[RFC](rfcs/)** and gets a
  discussion window (about a week) before a decision is recorded.
- Accepted work is implemented as a pull request and reviewed for quality against the
  [contribution rules](CONTRIBUTING.md).
- Even for an accepted idea, the maintainer owns the **shape of the API** — coherence is
  about how a thing looks, not just whether it's included.

## Where things happen

- **Bugs** → [GitHub Issues](https://github.com/weave-framework/weave/issues), with a reproduction.
- **Ideas, feature requests, questions** → [GitHub Discussions](https://github.com/weave-framework/weave/discussions). Not the issue tracker.
- **Substantial changes** → an [RFC](rfcs/) pull request.
- **Versioning & stability** of what gets built → [VERSIONING.md](VERSIONING.md).

## Decisions are recorded

Accepted and declined proposals are written down with their rationale — in the RFC itself,
or the discussion it came from — so the "why" is never lost. Consistency comes from
applying the same criteria every time, and saying so out loud.
