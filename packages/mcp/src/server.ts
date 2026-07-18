/**
 * The MCP server core — pure request→response dispatch, no transport, no Node APIs.
 * A transport (see `./stdio.ts`) feeds it parsed {@link JsonRpcRequest}s and writes back
 * the {@link JsonRpcResponse}s. Kept Node-free so it is unit-testable in the browser harness.
 */

import {
  RPC_INTERNAL_ERROR,
  RPC_INVALID_PARAMS,
  RPC_METHOD_NOT_FOUND,
  textResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpTool,
  type McpToolResult,
} from './jsonrpc.js';

/** The MCP protocol revision this server speaks. */
export const PROTOCOL_VERSION: string = '2024-11-05';

export interface McpServerOptions {
  name?: string;
  version?: string;
}

/**
 * A minimal MCP server: register tools, then `handle()` each JSON-RPC request. Implements
 * `initialize`, `tools/list`, `tools/call`, and swallows `notifications/*` (returns null,
 * i.e. no response). Tool *execution* failures are returned as `isError` results (MCP
 * convention); protocol failures (unknown method / unknown tool) are JSON-RPC errors.
 */
export class McpServer {
  private readonly tools: Map<string, McpTool> = new Map<string, McpTool>();
  private readonly name: string;
  private readonly version: string;

  constructor(opts: McpServerOptions = {}) {
    this.name = opts.name ?? '@weave-framework/mcp';
    this.version = opts.version ?? 'dev';
  }

  /** Register a tool (last registration of a name wins). Chainable. */
  registerTool(tool: McpTool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /** The public tool descriptors (no handlers) — the `tools/list` payload. */
  listTools(): Array<{ name: string; description: string; inputSchema: object }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /**
   * Handle one request. Returns the response, or `null` for a notification (a request with
   * no `id`, e.g. `notifications/initialized`) which must not be answered.
   */
  async handle(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id: number | string | null = req.id ?? null;
    const isNotification: boolean = req.id === undefined || req.id === null;

    if (req.method === 'initialize') {
      return this.ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: this.name, version: this.version },
      });
    }

    if (req.method.startsWith('notifications/')) {
      return null; // notifications get no response
    }

    if (req.method === 'tools/list') {
      return this.ok(id, { tools: this.listTools() });
    }

    if (req.method === 'tools/call') {
      const params: { name?: string; arguments?: Record<string, unknown> } = (req.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const tool: McpTool | undefined = params.name ? this.tools.get(params.name) : undefined;
      if (!tool) {
        return this.err(id, RPC_INVALID_PARAMS, `unknown tool: ${String(params.name)}`);
      }
      // Every tool declares `required` in its inputSchema, and nothing enforced it: a caller that
      // omitted a required argument (or misspelled it) fell through to the handler, which saw
      // `undefined` and reported whatever that produced downstream — `weave_compile_template`
      // answered "Empty template fragment", which sends the agent looking at its markup instead
      // of at its call. Say which argument is missing.
      const missing: string[] = (tool.inputSchema.required ?? []).filter(
        (k: string) => (params.arguments ?? {})[k] === undefined
      );
      if (missing.length) {
        return this.ok(
          id,
          textResult(
            `${tool.name}: missing required argument${missing.length > 1 ? 's' : ''}: ` +
              `${missing.join(', ')}. Expected: ${Object.keys(tool.inputSchema.properties).join(', ')}.`,
            true
          )
        );
      }
      try {
        const result: McpToolResult = await tool.handler(params.arguments ?? {});
        return this.ok(id, result);
      } catch (e) {
        // A tool that throws → an isError result (the agent sees the message, keeps the session).
        return this.ok(id, textResult(`${(e as Error)?.message ?? String(e)}`, true));
      }
    }

    if (isNotification) return null;
    return this.err(id, RPC_METHOD_NOT_FOUND, `method not found: ${req.method}`);
  }

  private ok(id: number | string | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private err(id: number | string | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}

// Re-export so consumers can build a server without reaching into ./jsonrpc.
export { RPC_INTERNAL_ERROR };
