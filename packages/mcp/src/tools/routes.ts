/**
 * `weave_routes` — turn a list of page-file paths into Weave's file-based route tree, so an
 * agent can see how files map to routes (`[id]`→`:id`, `index`→`""`, `_layout`→nested wrapper)
 * without running the CLI. Pure over the DOM-free `@weave-framework/router/files` helper.
 */

import { fileToRoutes, type FileRoute } from '@weave-framework/router/files';
import { jsonResult, type McpTool, type McpToolResult } from '../jsonrpc.js';

export const routesTool: McpTool = {
  name: 'weave_routes',
  description:
    "Build Weave's file-based route tree from a list of page file paths (relative to the pages dir). Shows the resolved routes: [id]→:id, [...rest]→*, index→\"\", _layout→a nested wrapper route.",
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Page file paths relative to the pages directory, e.g. ["index.ts","user/[id].ts","_layout.ts"].',
      },
    },
    required: ['files'],
  },
  handler: (args: Record<string, unknown>): McpToolResult => {
    const files: string[] = Array.isArray(args.files) ? (args.files as string[]).map(String) : [];
    const routes: FileRoute[] = fileToRoutes(files);
    return jsonResult({ routes });
  },
};
