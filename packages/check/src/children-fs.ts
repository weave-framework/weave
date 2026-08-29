/**
 * The filesystem half of child-component resolution — Node only.
 *
 * It is a module of its own so `emit.ts` stays free of any environment: the mapping tests bundle that
 * file into a browser, where a single `node:fs` import fails the build. Callers that HAVE a filesystem
 * (`checkProject`, the language server, and the CLI's build loader) pass this in.
 *
 * The rule itself is shared with the build on purpose. The loader resolves `<TodoItem>` to
 * `./todo-item/todo-item.ts` and wires the import, so an app that never writes that import runs fine —
 * and `weave check` used to call it broken. Two implementations of one rule is how that happens.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { childImportCandidates } from '@weave-framework/compiler';

/**
 * Resolve a PascalCase child tag (`<Input>`) to a sibling component module by convention, returning the
 * extension-less specifier to import (`../input/input`). Probes the canonical layouts (dir-per-component,
 * flat) for a `.ts`/`.weave` source; null when none exists, so the caller reports the tag as unknown.
 */
export function resolveChildModule(tag: string, dir: string): string | null {
  for (const cand of childImportCandidates(tag)) {
    for (const ext of ['.ts', '.weave']) {
      if (existsSync(resolve(dir, cand + ext))) return cand;
    }
  }
  return null;
}
