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
 * only be `() => void`, and a `bind:` is decided by what the runtime writes back into the signal;
 * `{{ total }}` could be anything, so nothing is offered for it. Inventing a plausible type would be
 * the fastest way to make this feature something people turn off.
 *
 * It only ever ADDS. It never edits or removes what is already there, so a name that disappears from
 * the template is reported, never deleted — see the rename discipline in ROADMAP.md.
 */

import ts from 'typescript';
import { parseTemplate, type Attr, type TemplateNode } from '@weave-framework/compiler';

/** A single replacement in the component's `.ts`, in offsets into `scriptText`. */
export interface ScriptEdit {
  start: number;
  end: number;
  text: string;
}

/** What a template says the missing name must be, and what declaring it costs the script. */
export interface Declaration {
  /** The statement to insert inside `setup`. */
  declaration: string;
  /** Its type, for the explicit return annotation when the script has one. */
  type: string;
  /** Names the declaration needs in scope. Absent when it needs nothing (a plain arrow function). */
  needs?: { values: string[]; types: string[]; from: string };
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
export function growSetup(
  scriptText: string,
  name: string,
  declaration: string,
  memberType: string,
  needs?: Declaration['needs']
): ScriptEdit | null {
  const grown: { edit: ScriptEdit; wroteType: boolean } | null = growSetupBody(scriptText, name, declaration, memberType);
  if (!grown) return null;
  // The TYPE is only needed when there is an explicit annotation for it to land in. Importing it
  // anyway would leave an unused import in every component that relies on auto-expose.
  const trimmed: Declaration['needs'] =
    needs && !grown.wroteType ? { ...needs, types: [] } : needs;
  return withImports(scriptText, grown.edit, trimmed);
}

/**
 * Fold whatever `needs` is missing into the same edit.
 *
 * `signal('')` does not compile without `signal` in scope, so the import is part of declaring, not a
 * separate favour. It travels inside ONE edit — the span simply starts earlier, with everything
 * between copied verbatim — because a declaration that lands without its import leaves the file worse
 * than it was, and two edits can half-apply. Where the module is already imported the names join that
 * statement's braces rather than opening a second import of the same module.
 */
function withImports(scriptText: string, edit: ScriptEdit, needs: Declaration['needs']): ScriptEdit | null {
  if (!needs) return edit;
  const sf: ts.SourceFile = ts.createSourceFile('setup.ts', scriptText, ts.ScriptTarget.Latest, true);
  const wanted: { name: string; isType: boolean }[] = [
    ...needs.values.map((n) => ({ name: n, isType: false })),
    ...needs.types.map((n) => ({ name: n, isType: true })),
  ];

  let existing: ts.ImportDeclaration | undefined;
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.moduleSpecifier.text === needs.from) existing = st;
  }
  const already: Set<string> = new Set<string>();
  if (existing?.importClause?.namedBindings && ts.isNamedImports(existing.importClause.namedBindings)) {
    for (const el of existing.importClause.namedBindings.elements) already.add(el.name.text);
  }
  const missing: { name: string; isType: boolean }[] = wanted.filter((w) => !already.has(w.name));
  if (!missing.length) return edit;
  const added: string = missing.map((w) => (w.isType ? `type ${w.name}` : w.name)).join(', ');

  if (existing?.importClause?.namedBindings && ts.isNamedImports(existing.importClause.namedBindings)) {
    // Grow the existing braces. The edit now spans from that statement to the declaration.
    const named: ts.NamedImports = existing.importClause.namedBindings;
    const close: number = named.getEnd() - 1; // the `}`
    const head: string = scriptText.slice(named.getStart(sf), close).trimEnd();
    const grown: string = `${head}, ${added} }`;
    const start: number = named.getStart(sf);
    if (start >= edit.start) return edit; // an import below the edit is not a shape this handles
    return { start, end: edit.end, text: grown + scriptText.slice(named.getEnd(), edit.start) + edit.text };
  }

  // No import of that module at all: open one above everything.
  const line: string = `import { ${added} } from '${needs.from}';\n\n`;
  return { start: 0, end: edit.end, text: line + scriptText.slice(0, edit.start) + edit.text };
}

function growSetupBody(
  scriptText: string,
  name: string,
  declaration: string,
  memberType: string
): { edit: ScriptEdit; wroteType: boolean } | null {
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
    if (!ann) return { edit: { start, end: ret.getEnd(), text: grown }, wroteType: false };

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
    return {
      edit: { start: annStart, end: ret.getEnd(), text: newAnn + scriptText.slice(ann.getEnd(), start) + grown },
      wroteType: true,
    };
  }

  // No explicit return: auto-expose writes one from what the template reads, so the declaration alone
  // is enough. Insert it as the body's last statement, at the body's own indentation.
  const last: ts.Statement | undefined = body.statements[body.statements.length - 1];
  const at: number = last ? last.getEnd() : body.getStart(sf) + 1;
  const indent: string = last ? indentAt(scriptText, last.getStart(sf)) : '  ';
  return { edit: { start: at, end: at, text: `\n${indent}${declaration}` }, wroteType: false };
}

/**
 * The declaration a missing name should get, or `null` when the template does not say without doubt.
 *
 * Two shapes qualify, each on the same test — is there exactly one answer?
 *
 *  - an event handler. `on:click={{ save }}` can be nothing but `() => void`.
 *  - a two-way binding. `bind:` is not a hint about intent: the runtime writes a specific type back
 *    into the signal, and the markup says which (see {@link forcedBy}).
 *
 * Everything else is refused, and the refusals are the load-bearing half. `{{ total }}` could be any
 * type at all. `@for (t of items())` forces only that `items` returns something iterable — the element
 * type is unknown, and `unknown[]` makes every use of `t` an error, so it is worse than silence.
 * A plausible-looking guess is how a helpful tool becomes one people switch off.
 */
export function declarationFor(templateText: string, name: string): Declaration | null {
  let nodes: TemplateNode[];
  try {
    nodes = parseTemplate(templateText);
  } catch {
    return null;
  }
  if (usedAsHandler(nodes, name)) {
    return { declaration: `const ${name} = (): void => {\n    // TODO\n  };`, type: '() => void' };
  }
  const bound: BoundValue | null = boundTo(nodes, name);
  if (bound) {
    return {
      declaration: `const ${name} = signal${bound.arg};`,
      type: `Signal<${bound.type}>`,
      needs: { values: ['signal'], types: ['Signal'], from: '@weave-framework/runtime' },
    };
  }
  return null;
}

/** What a two-way binding forces the signal to hold, and the `signal(…)` call that starts it there. */
interface BoundValue {
  type: string;
  /** The call's argument list, written out — `('')`, `(0)`, `<string[]>([])`. */
  arg: string;
}

/**
 * The type a `bind:` forces on `name`, or `null` when the markup does not force one.
 *
 * This is not a guess about what the author meant: the runtime writes a specific type BACK into the
 * signal, and which one is decided by the element and its attributes. `bind:checked` writes
 * `box.checked`; a `number`/`range` input writes `valueAsNumber`; a multiple select writes an array
 * of option values; everything else writes `input.value`, a string.
 *
 * Two shapes are refused. `bind:group` writes back in whatever type the signal ALREADY holds
 * (`typeof cur === 'number' ? Number(v) : v`), so a fresh declaration has no forced type at all. And
 * an input whose `type` is itself a binding is not knowable here — the same markup is a string one
 * render and a number the next.
 */
function boundTo(nodes: TemplateNode[] | undefined, name: string): BoundValue | null {
  for (const node of nodes ?? []) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'element') {
      const bind: Attr | undefined = node.attrs.find((a: Attr) => a.type === 'bind' && a.expr.trim() === name);
      if (bind && bind.type === 'bind') {
        const forced: BoundValue | null = forcedBy(node.tag, node.attrs, bind.name);
        if (forced) return forced;
      }
      const inner: BoundValue | null = boundTo(node.children, name);
      if (inner) return inner;
      continue;
    }
    for (const v of Object.values(node as unknown as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      if (v.length && typeof v[0] === 'object' && v[0] !== null && 'type' in (v[0] as object)) {
        const inner: BoundValue | null = boundTo(v as TemplateNode[], name);
        if (inner) return inner;
      } else {
        for (const b of v as Array<{ children?: TemplateNode[] }>) {
          if (!b || typeof b !== 'object') continue;
          const inner: BoundValue | null = boundTo(b.children, name);
          if (inner) return inner;
        }
      }
    }
  }
  return null;
}

/** The forced type for one `bind:<what>` on `<tag …attrs>`, or `null` when nothing is forced. */
function forcedBy(tag: string, attrs: Attr[], what: string): BoundValue | null {
  if (/^[A-Z]/.test(tag)) return null; // a component's prop contract is its own; this is about form controls
  if (what === 'checked') return { type: 'boolean', arg: '(false)' };
  if (what !== 'value') return null; // `group` writes back in the type the signal already holds
  if (tag === 'select') {
    const multiple: boolean = attrs.some((a: Attr) => a.type === 'static' && a.name === 'multiple');
    return multiple ? { type: 'string[]', arg: '<string[]>([])' } : { type: 'string', arg: "('')" };
  }
  if (tag === 'textarea') return { type: 'string', arg: "('')" };
  if (tag !== 'input') return null;
  // A bound `type` makes this markup a string one render and a number the next.
  if (attrs.some((a: Attr) => 'name' in a && a.name === 'type' && a.type !== 'static')) return null;
  const type: Attr | undefined = attrs.find((a: Attr) => a.type === 'static' && a.name === 'type');
  const value: string = type && type.type === 'static' ? type.value : 'text';
  if (value === 'number' || value === 'range') return { type: 'number', arg: '(0)' };
  // Every other input, a checkbox included: `bind:value` reads `input.value`, which is a string. The
  // binding NAME is what decides between the three modes, so `type` does not get a second say here —
  // an earlier version also refused `type="checkbox"`, which both disagreed with the runtime and made
  // the `bind:group` refusal above untestable, since a radio was already being refused twice.
  return { type: 'string', arg: "('')" };
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
