/**
 * Minimal JSON-RPC 2.0 types + an MCP tool shape. Zero-dep: MCP is JSON-RPC over a
 * transport (stdio here), and the protocol is small enough to own in-house rather than
 * pull a third-party SDK ([[weave-zero-dependencies]] / RFC 0006).
 */

/** A JSON-RPC 2.0 request. A request with no `id` is a notification (no response). */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

/** A JSON-RPC 2.0 response — exactly one of `result` / `error`. */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Standard JSON-RPC error codes used by the server. */
export const RPC_METHOD_NOT_FOUND: number = -32601;
export const RPC_INVALID_PARAMS: number = -32602;
export const RPC_INTERNAL_ERROR: number = -32603;

/** An MCP tool: a name, a JSON-Schema for its input, and an async handler. */
export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema describing the tool's `arguments` object. */
  inputSchema: object;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;
}

/** The MCP `tools/call` result shape — text content, optionally flagged as an error. */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Convenience: wrap a string (or JSON-serialisable value) as a text tool result. */
export function textResult(text: string, isError: boolean = false): McpToolResult {
  return { content: [{ type: 'text', text }], isError };
}

/** Convenience: wrap a value as pretty JSON text content. */
export function jsonResult(value: unknown): McpToolResult {
  return textResult(JSON.stringify(value, null, 2));
}
