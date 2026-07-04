/**
 * `weave_check` — type-check a Weave project (template + child-prop diagnostics) and return
 * the diagnostics. Wraps `@weave-framework/check`'s `checkProject`, which walks the given
 * directories relative to the server's cwd (the target project). Node-only (filesystem).
 */

import { checkProject, type Diagnostic } from '@weave-framework/check';
import { jsonResult, type McpTool, type McpToolResult } from '../jsonrpc.js';

export const checkTool: McpTool = {
  name: 'weave_check',
  description:
    'Type-check a Weave project — template expressions and child-prop usage included. Returns diagnostics { file, line, col, code, message, category }. Runs against the server working directory.',
  inputSchema: {
    type: 'object',
    properties: {
      roots: {
        type: 'array',
        items: { type: 'string' },
        description: 'Directories to check, relative to the project root. Default ["src"].',
      },
    },
  },
  handler: (args: Record<string, unknown>): McpToolResult => {
    const roots: string[] =
      Array.isArray(args.roots) && args.roots.length ? (args.roots as string[]).map(String) : ['src'];
    const diagnostics: Diagnostic[] = checkProject(roots);
    const errorCount: number = diagnostics.filter((d) => d.category === 'error').length;
    return jsonResult({ ok: errorCount === 0, errorCount, diagnostics });
  },
};
