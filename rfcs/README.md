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

## Status vocabulary

Every RFC carries a **Status** line in its header. The values in use:

| Status | Meaning |
|--------|---------|
| **Draft** | Written, not yet decided. |
| **Accepted** | Decided and committed to; not built yet. |
| **Partially implemented** | Part of the scope shipped; the rest is still design-of-record. The header says which is which. |
| **Implemented** | The scope described here shipped. Where the built API diverges from the proposal, the RFC says so. |
| **Deferred** | Accepted in principle, parked with no active work. |
| **Declined** | Decided against; kept for the reasoning. |
| **Superseded** | Replaced by a later RFC, which the header names. |

An RFC is a **historical record of a decision**. When something ships, the status and any
factual divergence are corrected — the original motivation, alternatives and rationale are
left as written, even where the outcome went another way.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-ssr-hydration.md) | Server-side rendering & hydration | Partially implemented — SSG slice shipped; request-time SSR & streaming deferred |
| [0002](0002-extension-points.md) | Component extension points (plugins) | Partially implemented — schema-driven forms shipped; component extension points still design-of-record |
| [0003](0003-router-v2.md) | Router v2 | Implemented |
| [0004](0004-nx-integration.md) | Nx integration (`@weave-framework/nx`) | Implemented |
| [0005](0005-api-surface-audit.md) | Public API surface audit (freeze prep) | Implemented |
| [0006](0006-mcp-server.md) | Weave MCP server (`@weave-framework/mcp`) | Implemented — `weave_docs_search` deferred |
| [0007](0007-devtools-deep.md) | DevTools deep — trigger-trace & component tree | Implemented |
| [0008](0008-component-extension.md) | Component extension | Implemented |
| [0009](0009-resumable-signal-core.md) | Serializable / resumable signal core | Implemented |

[`0000-template.md`](0000-template.md) is the template, not an RFC.
