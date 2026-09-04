/**
 * Turn migration facts into a graph worth looking at.
 *
 * The temptation is to draw everything: 102 routes, 38 components, 221 DI edges and 162 call edges on one
 * canvas. That produces what graph people call a hairball — impressive, and unable to answer a question. So this
 * builds the graph the application already has rather than every edge that exists in it.
 *
 * The spine is the ROUTE TREE, because that is the shape a person recognises as their own app, and because
 * Angular's lazy boundaries cut it into pieces that can be migrated one at a time. Measured on a real
 * application: 49 lazy boundaries, all 49 resolving to the file whose routes they load. Components and services
 * hang off that spine, and are meant to be revealed under one node at a time — not all at once.
 */

import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath, sep } from 'node:path';
import {
  outOfReach,
  parseFile,
  resolveRelative,
  type ComponentFact,
  type DiEdge,
  type MigrationFacts,
  type Reach,
  type RouteFact,
  type ServiceFact,
} from './analyze.js';
import type { Edge, Graph, GraphNode, NodeKind } from './types.js';

/** A stable id for a node. Ids are opaque to the UI; only their equality matters. */
function id(kind: NodeKind, key: string): string {
  return `${kind}:${key}`;
}

/**
 * A file, shown relative to the analysed unit.
 *
 * Compared case-insensitively and separator-blind: on Windows the unit directory arrives as the user typed it
 * (`C:/_WORK/…`) while the walked files come back resolved (`C:\_WORK\…`), so a plain `startsWith` matches
 * nothing and every label falls back to the absolute path — which is exactly what the first run printed.
 */
function shortPath(file: string, root: string): string {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  const nf: string = norm(file);
  const nr: string = norm(root).replace(/\/$/, '');
  const rel: string = nf.startsWith(`${nr}/`) ? file.slice(root.length) : file;
  return rel.replace(/^[\\/]/, '').split(sep).join('/');
}

/** Segments every workspace repeats, which say nothing about what a file IS. */
const CARRIER: ReadonlySet<string> = new Set<string>(['src', 'app', 'lib', 'libs', 'apps', 'projects']);

/**
 * The deepest folder that contains every file the analysis read.
 *
 * Not the analysed unit: an application reaches into sibling workspace libraries, so half the files sit
 * OUTSIDE it. Measured, using the unit put 110 of 227 nodes into one bucket named after the drive.
 */
function commonRoot(files: string[]): string {
  const norm = (p: string): string => p.split('\\').join('/').toLowerCase();
  if (!files.length) return '';
  let root: string = norm(files[0]);
  for (const file of files) {
    const f: string = norm(file);
    while (root && !f.startsWith(root)) root = root.slice(0, root.lastIndexOf('/'));
  }
  return root;
}

/**
 * The folder a file belongs to, as a grouping key.
 *
 * Slash-separated and relative to `root`, with the file name and the carrier segments removed, so
 * `C:/ws/apps/archiving/src/app/app-modules/documents/x.component.ts` becomes
 * `archiving/app-modules/documents`. Empty when the file sits directly at the root.
 */
function folderOf(file: string, root: string): string {
  const norm: string = file.split('\\').join('/').toLowerCase();
  const rel: string = norm.startsWith(root) ? norm.slice(root.length) : norm;
  const parts: string[] = rel.split('/').filter(Boolean).slice(0, -1);
  return parts.filter((p: string): boolean => !CARRIER.has(p)).join('/');
}

/**
 * Which routes file a lazy specifier leads to.
 *
 * The specifier is relative to the route's own file (`./app-modules/home/index`), and the target may be that
 * exact module, a file beneath it, or the folder holding it — all three spellings appear in one real codebase,
 * so all three are matched rather than assuming the tidy one.
 */
function resolveLazy(route: RouteFact, files: string[]): string | null {
  if (!route.lazyTarget) return null;

  // Step one: where does the specifier actually point? Asked of the analysis's own resolver — the one that
  // followed every other import in this codebase — rather than guessed at here. An earlier version of this
  // function had three hand-written rules and got a barrel wrong, which is what guessing at file layout buys
  // you: it works on the projects you happened to look at.
  const entry: string | null = resolveRelative(route.lazyTarget, route.file);
  if (!entry) return null;
  if (files.includes(entry)) return entry;

  /* Step two: that file holds no routes, which is normal — `index.ts` is a barrel, and the routes live in
     whatever it re-exports. Follow those exports, once, and take the first that does declare routes.
     One hop, not a full graph walk: a barrel re-exporting a barrel is rare, and an unbounded chase through
     someone else's re-export web is a good way to be slow and still wrong. */
  for (const spec of reexportSpecifiers(entry)) {
    const next: string | null = resolveRelative(spec, entry);
    if (next && files.includes(next)) return next;
  }
  return null;
}

/** The specifiers a file re-exports (`export * from './x'`, `export { A } from './x'`). */
function reexportSpecifiers(file: string): string[] {
  const source: ts.SourceFile | null = parseFile(file);
  if (!source) return [];
  const out: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const from: ts.Expression | undefined = statement.moduleSpecifier;
    if (from && ts.isStringLiteral(from)) out.push(from.text);
  }
  return out;
}

/**
 * Which components a component's template puts on screen.
 *
 * Reported, and it was the biggest hole left: the graph knew which component a ROUTE renders and nothing about
 * what that component renders in turn. An application is mostly components using other components, and none of
 * those edges existed.
 *
 * Read from the markup rather than guessed: every tag in the template is looked up in the map of declared
 * selectors, so `<app-header>` becomes an edge only if some component actually declares `app-header`. A
 * standalone component's `imports: [...]` is taken too — it names its dependencies directly, which catches the
 * ones a template builds dynamically.
 */
function templateOf(component: ComponentFact): string {
  if (component.templateText) return component.templateText;
  if (!component.templateUrl) return '';
  try {
    return readFileSync(resolvePath(dirname(component.file), component.templateUrl), 'utf8');
  } catch {
    // A template that cannot be read is a fact about that component, not a reason to stop.
    return '';
  }
}

/** Every element name a piece of markup uses. Deliberately loose: it is matched against declared selectors. */
function tagsIn(markup: string): Set<string> {
  const out: Set<string> = new Set<string>();
  const pattern: RegExp = /<([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match: RegExpExecArray | null = pattern.exec(markup);
  while (match) {
    out.add(match[1].toLowerCase());
    match = pattern.exec(markup);
  }
  return out;
}

/**
 * The module a routes file stands for.
 *
 * `src/app/app-modules/login/index.ts` is the login module; naming the node after the file made it read as a
 * file, which is not what a lazy route points at. An `index.ts` takes its folder's name, anything else keeps
 * its own basename — `documents.module.ts` is already saying which module it is.
 */
function moduleName(file: string, root: string): string {
  const rel: string = shortPath(file, root);
  const parts: string[] = rel.split('/').filter(Boolean);
  const base: string = (parts[parts.length - 1] ?? rel).replace(/\.ts$/, '');
  if (base !== 'index') return base.replace(/\.module$/, '');
  return parts[parts.length - 2] ?? base;
}

/**
 * A readable label for a route.
 *
 * A bare `/` for `path: ''` was unreadable on a canvas: dozens of lone slashes saying nothing about which route
 * they were. Angular's two nameless paths get named for what they DO, which is what a reader is looking for.
 */
function routeLabel(route: RouteFact): string {
  if (route.path === '') return route.redirectTo ? '(redirect)' : '(default)';
  if (route.path === '**') return '(fallback)';
  return route.path ?? '(no path)';
}

/**
 * Build the graph.
 *
 * Every node carries `weight` — how many other things point at it. It is what makes a drawing legible without
 * anyone reading a number: the interface library used by forty files is simply bigger than the one used once.
 */
export function buildGraph(facts: MigrationFacts): Graph {
  const nodes: Map<string, GraphNode> = new Map<string, GraphNode>();
  const edges: Edge[] = [];
  const root: string = facts.unit;

  /* Where the folder keys are measured from — see `commonRoot`. Built from the files that actually back a
     node, not from `facts.files`, so a stray script somewhere high in the tree cannot flatten every key. */
  const factFiles: string[] = [
    ...facts.components.map((c: ComponentFact): string => c.file),
    ...facts.services.map((s: ServiceFact): string => s.file),
    ...facts.ngModules.map((m: { file: string }): string => m.file),
  ].filter(Boolean);
  const folderRoot: string = commonRoot(factFiles);

  const add = (node: GraphNode): GraphNode => {
    const existing: GraphNode | undefined = nodes.get(node.id);
    if (existing) return existing;
    nodes.set(node.id, node);
    return node;
  };
  const link = (from: string, to: string, kind: Edge['kind']): void => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    edges.push({ from, to, kind });
  };

  /* ── the spine: one node per routes FILE, one per route ── */
  const routeFiles: string[] = [...new Set(facts.routes.map((r: RouteFact): string => r.file))];
  for (const file of routeFiles) {
    add({
      id: id('module', file),
      kind: 'module',
      label: moduleName(file, root),
      // The path belongs in the detail line: a lazy route points at a MODULE, and `index.ts` is only where that
      // module happens to live. Labelling nodes with the filename made every one of them read as a file.
      detail: `${facts.routes.filter((r: RouteFact): boolean => r.file === file).length} route(s) · ${shortPath(file, root)}`,
      weight: 0,
      lazy: false,
    });
  }

  facts.routes.forEach((route: RouteFact, index: number): void => {
    add({
      id: id('route', `${route.file}#${index}`),
      kind: 'route',
      label: routeLabel(route),
      detail: route.redirectTo ? `→ ${route.redirectTo}` : (route.component ?? ''),
      weight: 0,
      lazy: route.lazy,
      guards: route.guards,
      outlet: route.outlet,
      parent: id('module', route.file),
    });
  });

  // A route belongs to its file, and a nested route to its parent route.
  facts.routes.forEach((route: RouteFact, index: number): void => {
    const self: string = id('route', `${route.file}#${index}`);
    if (route.parent !== null) {
      const parentRoute: RouteFact | undefined = facts.routes[route.parent];
      if (parentRoute) link(id('route', `${parentRoute.file}#${route.parent}`), self, 'child');
    } else {
      link(id('module', route.file), self, 'child');
    }
  });

  // The cut lines: a lazy route loads another routes file.
  facts.routes.forEach((route: RouteFact, index: number): void => {
    const target: string | null = resolveLazy(route, routeFiles);
    if (!target) return;
    link(id('route', `${route.file}#${index}`), id('module', target), 'loads');
  });

  /* ── what hangs off the spine ── */
  for (const component of facts.components) {
    add({
      id: id('component', component.className),
      kind: 'component',
      label: component.className,
      detail: component.selector ?? '',
      weight: 0,
      folder: folderOf(component.file, folderRoot),
      file: shortPath(component.file, root),
    });
  }
  for (const service of facts.services) {
    add({
      id: id('service', service.className),
      kind: 'service',
      label: service.className,
      detail: service.providedIn ? `providedIn: ${service.providedIn}` : '',
      weight: 0,
      folder: folderOf(service.file, folderRoot),
      file: shortPath(service.file, root),
    });
  }

  /* A route renders a component; a guard is a service it depends on to be entered or left.
     Guards hit the same wall DI does: `AuthGuardIfLogedInService` and friends are rarely in `facts.services`,
     so every guard edge was dropped and a route with three guards inspected as having no connections at all.
     An unread guard is still a dependency — and a rather important one, since it decides whether the route can
     be reached — so it becomes an external node rather than nothing. */
  const knownServices: Set<string> = new Set<string>(facts.services.map((x: ServiceFact): string => x.className));
  facts.routes.forEach((route: RouteFact, index: number): void => {
    const self: string = id('route', `${route.file}#${index}`);
    if (route.component) link(self, id('component', route.component), 'renders');
    for (const guard of new Set(route.guards)) {
      if (!knownServices.has(guard)) {
        add({ id: id('external', guard), kind: 'external', label: guard, detail: 'guard, not read yet', weight: 0 });
      }
      link(self, knownServices.has(guard) ? id('service', guard) : id('external', guard), 'guards');
    }
  });

  /* ── dependency injection ──
     The first run produced ZERO inject edges out of 227, because `link` drops an edge whose endpoint has no
     node — and most injected classes are not in `facts.services` at all. They live behind the out-of-reach
     libraries this whole step exists to ask about (216 of them in one real app). Dropping them hid precisely
     what is worth seeing, so they become `external` nodes: named, weighted, and visibly not read yet. */
  const known: Set<string> = new Set<string>([...knownServices, ...facts.components.map((x: ComponentFact): string => x.className)]);
  for (const edge of facts.di) {
    if (!known.has(edge.to)) {
      add({ id: id('external', edge.to), kind: 'external', label: edge.to, detail: 'not read yet', weight: 0 });
    }
    // The SOURCE may be external too — once a library is opened its own classes start injecting things, and
    // those edges were being dropped because `link` only ever tried component and service ids for the source.
    if (!known.has(edge.from) && nodes.has(id('external', edge.from))) {
      link(id('external', edge.from), known.has(edge.to) ? id('service', edge.to) : id('external', edge.to), 'injects');
    }
    const to: string = known.has(edge.to) ? id('service', edge.to) : id('external', edge.to);
    link(id('component', edge.from), to, 'injects');
    link(id('service', edge.from), to, 'injects');
  }

  /* ── fold each lazy route into the module it alone loads ──
     `LAZY ROUTE error` pointing at `MODULE errors` is one thing drawn twice: the route IS the way into that
     module, and nothing else reaches it. Two cards and a line where one card says the same, repeated for every
     lazy boundary — 49 of them in one app.

     Only folded when the module has exactly ONE incoming `loads`. Three routes loading the same module
     (`documents`, `archived`, `active` all land on documents/index.ts) is not a duplicate; it is a shared
     module, and collapsing it would erase the fact that three paths lead to the same place. */
  const loadsInto: Map<string, string[]> = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== 'loads') continue;
    loadsInto.set(e.to, [...(loadsInto.get(e.to) ?? []), e.from]);
  }

  const folded: Map<string, string> = new Map<string, string>(); // module id -> route id that absorbs it
  for (const [moduleId, routeIds] of loadsInto) {
    if (routeIds.length !== 1) continue;
    const routeId: string = routeIds[0];
    const routeNode: GraphNode | undefined = nodes.get(routeId);
    const moduleNode: GraphNode | undefined = nodes.get(moduleId);
    if (!routeNode || !moduleNode) continue;
    folded.set(moduleId, routeId);
    // The card keeps the route's path — that is what a reader recognises from the URL — and gains the module's
    // own line, so nothing is lost by the fold.
    routeNode.detail = moduleNode.detail;
    routeNode.folded = true;
  }

  if (folded.size) {
    for (const moduleId of folded.keys()) nodes.delete(moduleId);
    const remap = (nodeId: string): string => folded.get(nodeId) ?? nodeId;
    const kept: Edge[] = [];
    const seenEdges: Set<string> = new Set<string>();
    for (const e of edges) {
      const from: string = remap(e.from);
      const to: string = remap(e.to);
      // The absorbed `loads` edge now points at itself — it has become the card.
      if (from === to) continue;
      if (!nodes.has(from) || !nodes.has(to)) continue;
      const key: string = `${from}>${to}>${e.kind}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      kept.push({ from, to, kind: e.kind });
    }
    edges.length = 0;
    edges.push(...kept);
  }

  /* ── components using components ──
     The shape of the app below the routes. Without it a component card was a leaf, however much markup it
     actually pulls in. */
  const bySelector: Map<string, string> = new Map<string, string>();
  for (const component of facts.components) {
    if (component.selector) bySelector.set(component.selector.toLowerCase(), component.className);
  }
  const byClassName: Set<string> = new Set<string>(facts.components.map((c: ComponentFact): string => c.className));

  for (const component of facts.components) {
    const from: string = id('component', component.className);
    const used: Set<string> = new Set<string>();
    for (const tag of tagsIn(templateOf(component))) {
      const owner: string | undefined = bySelector.get(tag);
      if (owner && owner !== component.className) used.add(owner);
    }
    // A standalone component names what it uses outright, which covers markup this cannot see.
    for (const imported of component.declaredImports) {
      if (byClassName.has(imported) && imported !== component.className) used.add(imported);
    }
    for (const target of used) link(from, id('component', target), 'uses');
  }

  /* ── NgModules ──
     Reported with a component sitting alone on the canvas: JsonViewerComponent, which its author knew was
     reachable because SaveModule imports JsonViewerModule. Checking it settled where the relationship lives —
     SaveDialogComponent's template never mentions json-viewer at all, so no amount of template reading would
     have found it. The connection is at the module level, and 37 NgModules with 35 sets of imports and 21 sets
     of declarations were being collected and then ignored.

     A module is what makes a component reachable in a non-standalone app, which is most Angular code. Without
     this the graph shows a component with no way in and no explanation for it. */
  for (const ngModule of facts.ngModules) {
    add({
      id: id('ngmodule', ngModule.className),
      kind: 'ngmodule',
      label: ngModule.className,
      detail: `${ngModule.declarations.length} declared · ${ngModule.imports.length} imported`,
      weight: 0,
      folder: folderOf(ngModule.file, folderRoot),
      file: shortPath(ngModule.file, root),
    });
  }
  for (const ngModule of facts.ngModules) {
    const from: string = id('ngmodule', ngModule.className);
    for (const declared of ngModule.declarations) link(from, id('component', declared), 'declares');
    for (const imported of ngModule.imports) link(from, id('ngmodule', imported), 'imports');
  }

  /* ── what a route actually opens ──
     A card reading `(default)` says nothing: the component is the thing that route shows, and the reader asked
     the obvious question — these empty defaults have their own components. It goes on the card.

     `sharedWith` counts the OTHER routes rendering the same component, because two routes reaching one screen
     with different parameters is a fact about the app worth seeing without clicking. */
  const rendersOf: Map<string, number> = new Map<string, number>();
  for (const route of facts.routes) {
    if (route.component) rendersOf.set(route.component, (rendersOf.get(route.component) ?? 0) + 1);
  }
  facts.routes.forEach((route: RouteFact, index: number): void => {
    if (!route.component) return;
    const node: GraphNode | undefined = nodes.get(id('route', `${route.file}#${index}`));
    if (!node) return;
    node.component = route.component;
    node.sharedWith = (rendersOf.get(route.component) ?? 1) - 1;
  });

  /* A route has no file of its own worth grouping by — every route in an application is declared in one of two
     or three routing files, so grouping by those would put the whole app in one pile. It belongs where its
     SCREEN lives: `/documents` sits with the documents folder because that is what a person means by it.
     Without this the folder key covers 170 of 227 nodes; with it, 183, and the route tree stops being a
     separate thing floating beside the groups. A module node follows the routes it declares, when they agree.
     The 44 left over are the npm classes and the routes with no component of their own — redirects and
     wildcards — which have no folder to belong to and should not be given one. */
  for (const node of nodes.values()) {
    if (node.kind !== 'route' || !node.component) continue;
    const screen: GraphNode | undefined = nodes.get(id('component', node.component));
    if (screen?.folder !== undefined) node.folder = screen.folder;
  }
  for (const file of routeFiles) {
    const node: GraphNode | undefined = nodes.get(id('module', file));
    if (!node) continue;
    const folders: string[] = [
      ...new Set(
        facts.routes
          .map((r: RouteFact, i: number): GraphNode | undefined => (r.file === file ? nodes.get(id('route', `${r.file}#${i}`)) : undefined))
          .map((n: GraphNode | undefined): string | undefined => n?.folder)
          .filter((f: string | undefined): f is string => f !== undefined),
      ),
    ];
    // Only when its routes agree: a routing file spanning five folders belongs to none of them.
    if (folders.length === 1) node.folder = folders[0];
  }

  /* ── say what an external actually IS ──
     Reported, and fair: a list reading "10 LayoutService" names a thing with no origin and no purpose — where
     is it from, who needs it, why does it matter. All three are already known: `outOfReach` traces most of
     these to a library and the DI edges say who injects them. Carrying that onto the node turns a number into
     a decision someone can actually make. */
  const reach: Reach[] = outOfReach(facts);
  for (const node of nodes.values()) {
    if (node.kind !== 'external') continue;
    const injectors: string[] = [...new Set(facts.di.filter((e: DiEdge): boolean => e.to === node.label).map((e: DiEdge): string => e.from))];
    if (injectors.length) node.usedBy = injectors;
    const from: Reach | undefined = reach.find((r: Reach): boolean => r.uses.includes(node.label));
    if (from) {
      node.library = from.name;
      if (from.path) node.libraryPath = from.path;
      node.detail = `from ${from.name}`;
    }
  }

  /* ── mark what nothing points at ──
     A card with no incoming edge was reported as "I don't know where this comes from, I looked in the code and
     couldn't find it" — and it was a real defect underneath (a barrel specifier that failed to resolve). Now
     that those resolve, the ones left are genuinely ways in, and the card says so rather than leaving the
     reader to wonder whether it is a bug. */
  const pointedAt: Set<string> = new Set<string>(
    edges.filter((e: Edge): boolean => e.kind === 'child' || e.kind === 'loads').map((e: Edge): string => e.to),
  );
  for (const node of nodes.values()) {
    if ((node.kind === 'module' || node.kind === 'route') && !pointedAt.has(node.id)) node.root = true;
  }

  /* ── a route and the screen it opens are one card ──

     Raised by the reader, and right: a route card already prints its component's name under the path, and then
     the component gets a card of its own in another colour. To the program they are different things; to
     someone looking at the picture they are one screen drawn twice, and reaching the screen's dependencies
     takes a second click that answers a question they thought they had already asked.

     Measured on a real application before doing this: no route renders more than one component (0 of 30), and
     no component is rendered by more than one route (0 of 72). But the second case DOES happen — `sharedWith`
     exists because two routes reaching one screen with different parameters was seen in a real codebase — so
     the merge only fires where it is exactly one to one. Where it is not, both cards stay and `sharedWith`
     says why.

     11 of the 30 route cards carry a component; the other 19 are lazy modules, redirects and routes files,
     which have no screen of their own and are untouched.
  */
  const renderedBy: Map<string, string[]> = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== 'renders') continue;
    renderedBy.set(e.to, [...(renderedBy.get(e.to) ?? []), e.from]);
  }
  /** Component ids folded into their route, so the edges can be rewritten onto it. */
  const mergedInto: Map<string, string> = new Map<string, string>();
  for (const [componentId, routeIds] of renderedBy) {
    if (routeIds.length !== 1) continue;
    const route: GraphNode | undefined = nodes.get(routeIds[0]);
    const component: GraphNode | undefined = nodes.get(componentId);
    if (!route || !component || route.kind !== 'route') continue;
    mergedInto.set(componentId, route.id);
    // The card is the screen now, so it carries where the screen LIVES.
    route.folder = component.folder;
    route.file = component.file;
    if (component.detail) route.detail = component.detail;
    nodes.delete(componentId);
  }

  if (mergedInto.size) {
    const rewritten: Edge[] = [];
    const seen: Set<string> = new Set<string>();
    for (const e of edges) {
      const from: string = mergedInto.get(e.from) ?? e.from;
      const to: string = mergedInto.get(e.to) ?? e.to;
      // The `renders` edge that joined the two is what the merge consumed; it has nothing left to point at.
      if (from === to) continue;
      if (!nodes.has(from) || !nodes.has(to)) continue;
      const key: string = `${from} ${to} ${e.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rewritten.push({ ...e, from, to });
    }
    edges.length = 0;
    edges.push(...rewritten);
  }


  /* ── weight: how many things point at this ── */
  for (const edge of edges) {
    const target: GraphNode | undefined = nodes.get(edge.to);
    if (target) target.weight += 1;
  }

  return { root, nodes: [...nodes.values()], edges };
}

/** Types re-exported so a consumer needs one import. */
export type { ComponentFact, ServiceFact };
