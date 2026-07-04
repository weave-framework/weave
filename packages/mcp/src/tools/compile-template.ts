/**
 * `weave_compile_template` — compile a Weave template string and return the emitted code,
 * or the parse/codegen error. The highest-value MCP tool: an agent that just wrote template
 * markup can *validate* it against the real Weave compiler (real errors, not guesses) before
 * shipping it. Purely functional — no filesystem, no project resolution.
 */

import { compileTemplate, type CompileResult } from '@weave-framework/compiler';
import { jsonResult, textResult, type McpTool, type McpToolResult } from '../jsonrpc.js';

export const compileTemplateTool: McpTool = {
  name: 'weave_compile_template',
  description:
    'Compile a Weave template string to runtime code, or return the compiler error. Use this to VALIDATE Weave template markup you wrote before shipping it — you get the real parse/codegen error rather than guessing.',
  inputSchema: {
    type: 'object',
    properties: {
      template: { type: 'string', description: 'The Weave template source (the markup) to compile.' },
      mode: {
        type: 'string',
        enum: ['module', 'function'],
        description: 'Codegen mode (default "module").',
      },
      scope: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names of identifiers already in scope (component fields/imports), so references resolve.',
      },
    },
    required: ['template'],
  },
  handler: (args: Record<string, unknown>): McpToolResult => {
    const template: string = String(args.template ?? '');
    const mode: 'module' | 'function' | undefined =
      args.mode === 'function' || args.mode === 'module' ? args.mode : undefined;
    const scope: string[] | undefined = Array.isArray(args.scope) ? (args.scope as string[]) : undefined;
    try {
      const res: CompileResult = compileTemplate(template, { mode, scope });
      return jsonResult({ ok: true, code: res.code, components: res.components });
    } catch (e) {
      return textResult(`Compile error: ${(e as Error)?.message ?? String(e)}`, true);
    }
  },
};
