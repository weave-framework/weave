# @weave-framework/mcp

A **Model Context Protocol** server that exposes the Weave toolchain to MCP-capable AI agents and
editors — so your AI assistant can compile-check a template, type-check the project, resolve
file-based routes, and scaffold a component through structured tools instead of guessing at the CLI.

Part of [Weave](https://weaveframework.dev).

## Tools

| Tool | What it does |
|------|--------------|
| `weave_compile_template` | Compile a Weave template string → emitted code, or the real compiler error. Validate markup before shipping it. |
| `weave_check` | Type-check a Weave project (templates + child-props) → diagnostics with file/line/col/message. |
| `weave_routes` | Turn a list of page files into Weave's file-based route tree (`[id]`→`:id`, `index`→`""`, `_layout`→nested). |
| `weave_scaffold_component` | Generate a component's boilerplate files (`.ts` + `.html` [+ stylesheet]). Returns the files — never writes without you. |

## Usage

Configure your MCP client to launch the server over **stdio**:

```jsonc
{
  "mcpServers": {
    "weave": {
      "command": "weave-mcp",
      "cwd": "/path/to/your/weave/project"
    }
  }
}
```

Equivalently, `weave mcp` (from `@weave-framework/cli`) starts the same server. The server's working
directory should be your project root so `weave_check` resolves the right files.

## Zero-dependency by design

MCP is JSON-RPC 2.0 over a transport. This package implements the protocol **in-house** (a small
JSON-RPC framing + a newline-delimited stdio loop) rather than pulling a third-party MCP SDK —
keeping Weave's zero-runtime-dependency rule. The tools thin-wrap the existing
`@weave-framework/compiler`, `@weave-framework/check`, and `@weave-framework/router` — no
re-implementation.

## License

MIT
