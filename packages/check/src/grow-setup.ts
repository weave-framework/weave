/**
 * The template as a specification: a name it uses, declared into `setup` for you.
 *
 * A component is two files, and today you say every name twice — once where you use it, once where
 * you define it. One of those mirrors is already gone (`injectAutoReturn` writes `setup`'s `return`
 * when you omit it). This removes the other, for the cases where the template says WITHOUT AMBIGUITY
 * what the missing thing is.
 *
 * Deliberately narrow, and it stays that way. It writes DECLARATIONS, never logic — the `TODO` is
 * yours — and it declines wherever the shape is a guess. An `on:click={{ save }}` with no `save` can
 * only be `() => void`; `{{ total }}` could be anything, so nothing is offered for it. Inventing a
 * plausible type would be the fastest way to make this feature something people turn off.
 *
 * It only ever ADDS. It never edits or removes what is already there, so a name that disappears from
 * the template is reported, never deleted — see the rename discipline in ROADMAP.md.
 */

import ts from 'typescript';
import { parseTemplate, type TemplateNode } from '@weave-framework/compiler';

/** A single replacement in the component's `.ts`, in offsets into `scriptText`. */
export interface ScriptEdit {
  start: number;
  end: number;
  text: string;
}

/** The `setup` function in a component script, however it is written. */
function findSetup(sf: ts.SourceFile): ts.FunctionLikeDeclarationBase | undefined {
  let found: ts.FunctionLikeDeclarationBase | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'setup') found = n;
    else if (
      (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) &&
      ts.isVariableDeclaration(n.parent) &&
      ts.isIdentifier(n.parent.name) &&
      n.parent.name.text === 'setup'
    ) {
      found = n;
    } else ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/** A top-level `return { … }` in `setup`'s body — the mirror a new name has to join. */
function topLevelObjectReturn(body: ts.Block): ts.ReturnStatement | undefined {
  for (const st of body.statements) {
    if (ts.isReturnStatement(st) && st.expression && ts.isObjectLiteralExpression(st.expression)) return st;
  }
  return undefined;
}

/** The indentation of the line `offset` sits on. */
function indentAt(text: string, offset: number): string {
  const lineStart: number = text.lastIndexOf('\n', offset - 1) + 1;
  const m: RegExpExecArray | null = /^[ \t]*/.exec(text.slice(lineStart, offset));
  return m ? m[0] : '  ';
}

/**
 * The edit that declares `name` in `setup`, or `null` when the script cannot be read confidently —
 * no `setup`, no block body, or a `return` that is not an object literal. Declining is the correct
 * outcome there: a wrong insertion is worse than none.
 *
 * With an explicit `return { … }` the whole statement is rewritten, so the declaration and its entry
 * in the mirror land as ONE edit; without one, auto-expose already exposes whatever the template
 * reads, and only the declaration is inserted.
 */
export function growSetup(scriptText: string, name: string, declaration: string, memberType: string): ScriptEdit | null {
  const sf: ts.SourceFile = ts.createSourceFile('setup.ts', scriptText, ts.ScriptTarget.Latest, true);
  const setup: ts.FunctionLikeDeclarationBase | undefined = findSetup(sf);
  if (!setup?.body || !ts.isBlock(setup.body)) return null;
  const body: ts.Block = setup.body;

  // An explicit return TYPE has to gain the name too, or adding it to the object is an error. Only a
  // type literal written right here can be updated: a named type (`: TaskDetailSetup`) lives in some
  // other declaration, and reaching into it is not this function's business - so it declines instead.
  const ann: ts.TypeNode | undefined = (setup as { type?: ts.TypeNode }).type;
  if (ann && !ts.isTypeLiteralNode(ann)) return null;

  const ret: ts.ReturnStatement | undefined = topLevelObjectReturn(body);
  if (ret) {
    const start: number = ret.getStart(sf);
    const indent: string = indentAt(scriptText, start);
    const retText: string = scriptText.slice(start, ret.getEnd());
    const close: number = retText.lastIndexOf('}');
    if (close === -1) return null;
    const inner: string = retText.slice(retText.indexOf('{') + 1, close).trim();
    const joined: string = inner ? `{ ${inner}${inner.endsWith(',') ? '' : ','} ${name} }` : `{ ${name} }`;
    const open: number = retText.indexOf('{');
    const rewritten: string = retText.slice(0, open) + joined + retText.slice(close + 1);
    const grown: string = `${declaration}\n${indent}${rewritten}`;
    if (!ann) return { start, end: ret.getEnd(), text: grown };

    // One contiguous edit from the annotation through the return, with everything between copied
    // verbatim - so the declaration, the mirror and the declared type move together or not at all.
    const annStart: number = ann.getStart(sf);
    const annText: string = scriptText.slice(annStart, ann.getEnd());
    const annClose: number = annText.lastIndexOf('}');
    if (annClose === -1) return null;
    const annInner: string = annText.slice(annText.indexOf('{') + 1, annClose).trim();
    const sep: string = annInner && !annInner.endsWith(';') && !annInner.endsWith(',') ? ';' : '';
    const annJoined: string = annInner ? `{ ${annInner}${sep} ${name}: ${memberType} }` : `{ ${name}: ${memberType} }`;
    const newAnn: string = annText.slice(0, annText.indexOf('{')) + annJoined + annText.slice(annClose + 1);
    return { start: annStart, end: ret.getEnd(), text: newAnn + scriptText.slice(ann.getEnd(), start) + grown };
  }

  // No explicit return: auto-expose writes one from what the template reads, so the declaration alone
  // is enough. Insert it as the body's last statement, at the body's own indentation.
  const last: ts.Statement | undefined = body.statements[body.statements.length - 1];
  const at: number = last ? last.getEnd() : body.getStart(sf) + 1;
  const indent: string = last ? indentAt(scriptText, last.getStart(sf)) : '  ';
  return { start: at, end: at, text: `\n${indent}${declaration}` };
}

/**
 * The declaration a missing name should get, or `null` when the template does not say without doubt.
 *
 * Only one shape qualifies today: a name bound as an event handler. `on:click={{ save }}` can be
 * nothing but `() => void`, so declaring it cannot be wrong. Everything else — `{{ total }}`,
 * `@for (t of items)` — has a shape the template does not pin down, and a plausible-looking guess is
 * how a helpful tool turns into one people switch off. More shapes can be added here, each on the
 * same test: is there exactly one answer?
 */
export function declarationFor(templateText: string, name: string): { declaration: string; type: string } | null {
  let nodes: TemplateNode[];
  try {
    nodes = parseTemplate(templateText);
  } catch {
    return null;
  }
  if (!usedAsHandler(nodes, name)) return null;
  return { declaration: `const ${name} = (): void => {\n    // TODO\n  };`, type: '() => void' };
}

/** Is `name` bound, on its own, to an `on:` handler anywhere in the template? */
function usedAsHandler(nodes: TemplateNode[] | undefined, name: string): boolean {
  for (const node of nodes ?? []) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'element') {
      for (const a of node.attrs) if (a.type === 'event' && a.expr.trim() === name) return true;
      if (usedAsHandler(node.children, name)) return true;
      continue;
    }
    for (const v of Object.values(node as unknown as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      if (v.length && typeof v[0] === 'object' && v[0] !== null && 'type' in (v[0] as object)) {
        if (usedAsHandler(v as TemplateNode[], name)) return true;
      } else {
        for (const b of v as Array<{ children?: TemplateNode[] }>) {
          if (b && typeof b === 'object' && usedAsHandler(b.children, name)) return true;
        }
      }
    }
  }
  return false;
}
