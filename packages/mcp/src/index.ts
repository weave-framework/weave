/**
 * @weave-framework/mcp — a Model Context Protocol server that exposes the Weave toolchain
 * to AI agents & editors as MCP tools. In-house JSON-RPC over stdio, zero third-party deps
 * (RFC 0006; [[weave-zero-dependencies]]).
 *
 * Tools (v1): weave_compile_template · weave_check · weave_routes · weave_scaffold_component.
 * Launch with the `weave-mcp` bin (or `weave mcp`), or embed via {@link createServer} /
 * {@link runStdioServer}.
 */

import { McpServer, type McpServerOptions } from './server.js';
import { runStdio, type StdioOptions } from './stdio.js';
import { compileTemplateTool } from './tools/compile-template.js';
import { checkTool } from './tools/check.js';
import { routesTool } from './tools/routes.js';
import { scaffoldComponentTool } from './tools/scaffold-component.js';

/** Build a Weave MCP server with all v1 tools registered. */
export function createServer(opts: McpServerOptions = {}): McpServer {
  return new McpServer(opts)
    .registerTool(compileTemplateTool)
    .registerTool(checkTool)
    .registerTool(routesTool)
    .registerTool(scaffoldComponentTool);
}

/** Build the server and run it over the stdio transport (the `weave-mcp` entry point). */
export function runStdioServer(opts: McpServerOptions & StdioOptions = {}): Promise<void> {
  return runStdio(createServer(opts), opts);
}

export {
  McpServer,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type McpServerOptions,
} from './server.js';
export { runStdio, type StdioOptions } from './stdio.js';
export {
  textResult,
  jsonResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcError,
  type McpTool,
  type McpToolResult,
} from './jsonrpc.js';
export { compileTemplateTool } from './tools/compile-template.js';
export { checkTool } from './tools/check.js';
export { routesTool } from './tools/routes.js';
export { scaffoldComponentTool, generateComponent, type GeneratedFile } from './tools/scaffold-component.js';
