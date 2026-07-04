# Weave RFCs

Substantial changes to Weave go through an **RFC** (Request for Comments) — a short
written proposal, discussed in the open before it's accepted. This keeps big decisions
deliberate, documented, and shaped by more than one person. See [GOVERNANCE.md](../GOVERNANCE.md)
for how this fits the wider decision process.

## When you need an RFC

Most changes don't. Bug fixes, docs, tests, and small additions go straight to a pull
request. Reach for an RFC when a change is substantial — a new package or public API, a
change to the template syntax or the reactive model, a new UI component's public contract,
or anything that would be hard to reverse.

Not sure? Start a [Discussion](https://github.com/weave-framework/weave/discussions)
first — that's also where ideas are gauged before they're worth writing up.

## The process

1. **Fits Weave?** The idea must first clear Gate 1 — the **Ground rules** in
   [CONTRIBUTING.md](../CONTRIBUTING.md) and [GOVERNANCE.md](../GOVERNANCE.md). A proposal
   that breaks a core principle is declined before an RFC is worth writing.
2. **Write it up.** Copy [`0000-template.md`](0000-template.md) to
   `rfcs/0000-my-proposal.md`, fill it in, and open it as a pull request.
3. **Discuss.** The RFC gets an open comment window (about a week). Expect questions and
   revisions.
4. **Decision.** The maintainer accepts or declines, with the reasoning recorded in the
   RFC. Accepted RFCs are merged and given a number; declined ones are closed with a note
   on why.
5. **Build.** An accepted RFC can then be implemented as a normal pull request.

An accepted RFC is a plan, not a guarantee of the final API — the maintainer owns the
shape of the design as it's built.
