# RFC 0006: Weave MCP server (`@weave-framework/mcp`)

- **Status:** ✅ Implemented — 2026-07-05 (`0.2.155`, `@weave-framework/mcp`: in-house JSON-RPC/stdio; tools compile_template/check/routes/scaffold_component; `weave mcp` + `weave-mcp` bin). docs_search deferred (docs index is app-local, not a package dep).
- **Author(s):** Aidas Josas (@aidasjosas) — prep for a dedicated session (Tier-2 item).
- **Discussion:** design direction + first steps so a fresh session can build it without re-deriving.

## Summary

A new package `@weave-framework/mcp` — a **Model Context Protocol** server that exposes a Weave
project's toolchain to AI agents and editors as MCP tools (run `weave check`, list routes,
compile/validate a template snippet, scaffold a component, search the docs). It lets any
MCP-capable client (AI coding agents, editors like Cursor, etc.) *drive* a Weave project through structured tools
instead of guessing at the CLI.

## Motivation

- **Adoption / DX.** "Works great with your AI editor out of the box" is a concrete pull for the
  AI-first audience Weave already targets ([[weave-adoption-growth]]).
- **Correctness loop.** An agent can call `weave_compile_template` to *validate* a template it
  wrote (real compiler errors with offsets) instead of shipping broken markup — a tight,
  first-party feedback loop that generic tools can't offer.

## How it fits Weave

- **[[weave-zero-dependencies]].** MCP is JSON-RPC 2.0 over stdio — **implement it in-house**
  (a small JSON-RPC framing + stdio loop), NOT via a third-party MCP SDK. This keeps rule #1 and
  is a manageable amount of code. Flag the decision in the package README.
- **Compose, don't duplicate.** Tools thin-wrap the EXISTING toolchain: `@weave-framework/cli`
  (`check`/`build`/`routes`), `@weave-framework/compiler` (`compileTemplate`), `create-weave`
  templates (scaffold). No re-implementation.
- **Fail loud.** A tool that can't resolve a config / project returns a structured MCP error.

## Design — proposed tools (v1)

| MCP tool | Wraps | Returns |
|----------|-------|---------|
| `weave_check` | `weave check` | template + child-prop diagnostics (path, line, message) |
| `weave_routes` | `fileToRoutes` | the file-based route tree |
| `weave_compile_template` | `compileTemplate(src)` | emitted code **or** parse/codegen errors with offsets |
| `weave_scaffold_component` | `create-weave` templates | files for a new component (name, styleLang) |
| `weave_docs_search` | docs content index | matching guide/reference sections |
| `weave_build` (opt) | `weave build` | build result / errors (long-running; stream or summarize) |

- **Transport:** stdio (the MCP default); a `weave mcp` CLI subcommand launches it.
- **Package:** `packages/mcp/` — `src/server.ts` (JSON-RPC loop), `src/tools/*.ts` (one per tool),
  `bin/weave-mcp.mjs`. Peer-deps the toolchain packages.
- **Config:** resolve the target project via `cwd` (like the Nx executors, RFC 0004) or a
  `--config` flag.

## First steps (for the building session)

1. `packages/mcp/` skeleton + in-house JSON-RPC-over-stdio (`initialize`, `tools/list`, `tools/call`).
2. `weave_compile_template` first (highest value + purely functional — great test target).
3. `weave_check` + `weave_routes`.
4. `weave_scaffold_component` + `weave_docs_search`.
5. `weave mcp` CLI subcommand + README (document the zero-dep in-house MCP decision).
6. Tests per tool (compile/check against fixtures); wire into the repo test gate.
7. Docs page (Tooling → "AI / MCP integration"); add to CI publish set + lockstep version.

## Alternatives considered

- **Use an MCP SDK.** Rejected — violates rule #1; the protocol is small enough to own.
- **Fold into the CLI** (no new package). The server *is* launched via the CLI, but the tools +
  protocol are enough surface to warrant their own package.

## Unresolved questions

1. Resources/prompts (beyond tools) — expose the docs as MCP *resources* too?
2. Streaming for `weave_build`/`weave_dev` (long-running) vs one-shot summarize.
3. Auth/scope — is any tool mutating (scaffold writes files)? Gate writes behind an explicit flag.
