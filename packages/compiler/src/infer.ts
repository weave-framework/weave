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

const FOR_VARS: string[] = ['$index', '$count', '$first', '$last', '$even', '$odd'];

/** The child node-lists of a node (for the snippet-name pre-pass). */
function childLists(node: TemplateNode): TemplateNode[][] {
  switch (node.type) {
    case 'element':
    case 'snippet':
    case 'key':
      return [node.children];
    case 'if':
      return node.branches.map((b) => b.children);
    case 'for':
      return node.empty ? [node.children, node.empty] : [node.children];
    case 'switch':
      return node.cases.map((c) => c.children);
    case 'defer':
      return node.placeholder ? [node.children, node.placeholder] : [node.children];
    case 'await': {
      const lists: TemplateNode[][] = [];
      if (node.pending) lists.push(node.pending);
      if (node.then) lists.push(node.then.children);
      if (node.catch) lists.push(node.catch.children);
      return lists;
    }
    default:
      return [];
  }
}

export function inferCtxNames(nodes: TemplateNode[]): string[] {
  const used: Set<string> = new Set<string>();

  // Snippet names are template-wide locals (a `@render` may reference one anywhere, even before its
  // definition), so collect them up front and always subtract them — unlike block locals below.
  const snippetNames: Set<string> = new Set<string>();
  const collectSnippets = (list: TemplateNode[]): void => {
    for (const node of list) {
      if (node.type === 'snippet') snippetNames.add(node.name);
      for (const cl of childLists(node)) collectSnippets(cl);
    }
  };
  collectSnippets(nodes);

  // A name a block *declares* (`@for` item + `$` vars, `@let`, `@if (… as x)`, `@then`/`@catch` alias,
  // snippet params) is subtracted ONLY within that block's scope — `declared` is per-scope, not global,
  // so the same name used elsewhere as component data is still inferred as ctx. (M4)
  const add = (expr: string | undefined, declared: Set<string>): void => {
    if (!expr) return;
    for (const id of freeIdentifiers(expr)) {
      if (!declared.has(id) && !snippetNames.has(id)) used.add(id);
    }
  };

  const walk = (list: TemplateNode[], parentDeclared: Set<string>): void => {
    let declared: Set<string> = parentDeclared; // a `@let` extends it for its following siblings
    for (const node of list) {
      switch (node.type) {
        case 'text':
          break;
        case 'interp':
          add(node.expr, declared);
          break;
        case 'let':
          add(node.expr, declared);
          declared = new Set(declared).add(node.name);
          break;
        case 'element':
          for (const attr of node.attrs) {
            if (attr.type === 'use') add(attr.name, declared); // the action identifier resolves to ctx
            if (attr.type === 'transition') add(attr.name, declared); // the transition fn resolves to ctx
            if (attr.type !== 'static') add(attr.expr, declared);
          }
          walk(node.children, declared);
          break;
        case 'if':
          for (const br of node.branches) {
            add(br.cond, declared);
            walk(br.children, br.alias ? new Set(declared).add(br.alias) : declared);
          }
          break;
        case 'for': {
          add(node.list, declared); // the list is evaluated in the parent scope (item not yet bound)
          const inner: Set<string> = new Set(declared).add(node.item);
          for (const v of FOR_VARS) inner.add(v);
          add(node.track, inner); // `track` references the loop item
          walk(node.children, inner);
          if (node.empty) walk(node.empty, declared); // the empty block has no item in scope
          break;
        }
        case 'switch':
          add(node.expr, declared);
          for (const c of node.cases) {
            add(c.test, declared);
            walk(c.children, declared);
          }
          break;
        case 'defer':
          if (node.trigger.kind === 'when') add(node.trigger.expr, declared);
          if (node.trigger.kind === 'timer') add(node.trigger.ms, declared);
          walk(node.children, declared);
          if (node.placeholder) walk(node.placeholder, declared);
          break;
        case 'await':
          add(node.expr, declared);
          if (node.pending) walk(node.pending, declared);
          if (node.then) walk(node.then.children, node.then.alias ? new Set(declared).add(node.then.alias) : declared);
          if (node.catch) walk(node.catch.children, node.catch.alias ? new Set(declared).add(node.catch.alias) : declared);
          break;
        case 'snippet': {
          const inner: Set<string> = new Set(declared);
          for (const p of node.params) inner.add(p); // params are locals inside the snippet body
          walk(node.children, inner);
          break;
        }
        case 'render':
          add(node.expr, declared); // the snippet name is subtracted via `snippetNames`
          break;
        case 'key':
          add(node.expr, declared);
          walk(node.children, declared);
          break;
      }
    }
  };

  walk(nodes, new Set<string>());
  return [...used].sort();
}
