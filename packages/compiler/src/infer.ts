/**
 * Auto-scope inference: walk a template AST and return the names that should
 * resolve to component data (`ctx.*`). Every free identifier in every template
 * expression qualifies, minus JS globals (handled in {@link freeIdentifiers})
 * and minus names a block *declares* — `@for` items + implicit `$` vars, `@let`
 * names, `@if (… as alias)` — since those are bound locally (and, for `@for`
 * `track`, used as real arrow params against the parent scope).
 *
 * Lexical and intentionally simple; M8 replaces it with TS-AST resolution.
 */

import type { TemplateNode } from './ast.js';
import { freeIdentifiers } from './scope.js';

const FOR_VARS = ['$index', '$count', '$first', '$last', '$even', '$odd'];

export function inferCtxNames(nodes: TemplateNode[]): string[] {
  const used = new Set<string>();
  const declared = new Set<string>();

  const add = (expr: string | undefined): void => {
    if (expr) for (const id of freeIdentifiers(expr)) used.add(id);
  };

  const walk = (list: TemplateNode[]): void => {
    for (const node of list) {
      switch (node.type) {
        case 'text':
          break;
        case 'interp':
          add(node.expr);
          break;
        case 'let':
          add(node.expr);
          declared.add(node.name);
          break;
        case 'element':
          for (const attr of node.attrs) {
            if (attr.type === 'use') add(attr.name); // the action identifier resolves to ctx
            if (attr.type === 'transition') add(attr.name); // the transition fn resolves to ctx
            if (attr.type !== 'static') add(attr.expr);
          }
          walk(node.children);
          break;
        case 'if':
          for (const br of node.branches) {
            add(br.cond);
            if (br.alias) declared.add(br.alias);
            walk(br.children);
          }
          break;
        case 'for':
          add(node.list);
          add(node.track);
          declared.add(node.item);
          for (const v of FOR_VARS) declared.add(v);
          walk(node.children);
          if (node.empty) walk(node.empty);
          break;
        case 'switch':
          add(node.expr);
          for (const c of node.cases) {
            add(c.test);
            walk(c.children);
          }
          break;
        case 'defer':
          if (node.trigger.kind === 'when') add(node.trigger.expr);
          if (node.trigger.kind === 'timer') add(node.trigger.ms);
          walk(node.children);
          if (node.placeholder) walk(node.placeholder);
          break;
        case 'await':
          add(node.expr);
          if (node.pending) walk(node.pending);
          if (node.then) {
            if (node.then.alias) declared.add(node.then.alias);
            walk(node.then.children);
          }
          if (node.catch) {
            if (node.catch.alias) declared.add(node.catch.alias);
            walk(node.catch.children);
          }
          break;
        case 'snippet':
          // the snippet name + its params are template-locals, not ctx
          declared.add(node.name);
          for (const p of node.params) declared.add(p);
          walk(node.children);
          break;
        case 'render':
          add(node.expr); // the snippet name is subtracted via `declared`
          break;
        case 'key':
          add(node.expr);
          walk(node.children);
          break;
      }
    }
  };

  walk(nodes);
  return [...used].filter((n) => !declared.has(n)).sort();
}
