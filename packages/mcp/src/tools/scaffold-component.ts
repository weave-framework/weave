/**
 * `weave_scaffold_component` — generate the boilerplate for a new Weave component (the
 * sibling-convention `.ts` + `.html` [+ style] trio), following the create-weave idiom. Pure:
 * it RETURNS the files (path + content) rather than writing them, so the agent/editor stays in
 * control of the filesystem (RFC 0006 §Unresolved #3 — no unsolicited writes).
 */

import { jsonResult, type McpTool, type McpToolResult } from '../jsonrpc.js';

/** One generated file. */
export interface GeneratedFile {
  path: string;
  content: string;
}

const kebab = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');

/** Generate a component's files. `styleLang` of `'none'` omits the stylesheet. */
export function generateComponent(
  name: string,
  styleLang: 'css' | 'scss' | 'none' = 'css'
): GeneratedFile[] {
  const base: string = kebab(name) || 'component';
  const files: GeneratedFile[] = [];

  const styleImport: string = styleLang === 'none' ? '' : `\n// styles: ./${base}.${styleLang}`;
  files.push({
    path: `${base}/${base}.ts`,
    content:
      `import { signal, type Signal } from '@weave-framework/runtime';\n\n` +
      `export function setup(): { count: Signal<number>; inc: () => void } {\n` +
      `  const count: Signal<number> = signal(0);\n` +
      `  const inc = (): void => { count.set((n) => n + 1); };\n` +
      `  return { count, inc };\n` +
      `}${styleImport}\n`,
  });

  files.push({
    path: `${base}/${base}.html`,
    content:
      `<section class="${base}">\n` +
      `  <button on:click={{ inc }}>clicked {{ count() }} times</button>\n` +
      `</section>\n`,
  });

  if (styleLang !== 'none') {
    files.push({
      path: `${base}/${base}.${styleLang}`,
      content: `.${base} {\n  display: block;\n}\n`,
    });
  }

  return files;
}

export const scaffoldComponentTool: McpTool = {
  name: 'weave_scaffold_component',
  description:
    'Generate the boilerplate files for a new Weave component (a .ts + .html [+ stylesheet], the sibling-convention trio). Returns the files (path + content) WITHOUT writing them — write them yourself.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Component name (PascalCase or kebab-case), e.g. "UserCard".' },
      styleLang: {
        type: 'string',
        enum: ['css', 'scss', 'none'],
        description: 'Stylesheet language, or "none" to skip the stylesheet. Default "css".',
      },
    },
    required: ['name'],
  },
  handler: (args: Record<string, unknown>): McpToolResult => {
    const name: string = String(args.name ?? '');
    const styleLang: 'css' | 'scss' | 'none' =
      args.styleLang === 'scss' || args.styleLang === 'none' ? args.styleLang : 'css';
    return jsonResult({ files: generateComponent(name, styleLang) });
  },
};
