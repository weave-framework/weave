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

import { dirname, resolve, sep } from 'node:path';
import type { ComponentFact, MigrationFacts, RouteFact, ServiceFact } from './analyze.js';
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

/**
 * Which routes file a lazy specifier leads to.
 *
 * The specifier is relative to the route's own file (`./app-modules/home/index`), and the target may be that
 * exact module, a file beneath it, or the folder holding it — all three spellings appear in one real codebase,
 * so all three are matched rather than assuming the tidy one.
 */
function resolveLazy(route: RouteFact, files: string[]): string | null {
  if (!route.lazyTarget) return null;
  const base: string = resolve(dirname(route.file), route.lazyTarget);
  return (
    files.find((f: string): boolean => f === `${base}.ts`) ??
    files.find((f: string): boolean => dirname(f) === base) ??
    files.find((f: string): boolean => f.startsWith(base + sep)) ??
    null
  );
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
    });
  }
  for (const service of facts.services) {
    add({
      id: id('service', service.className),
      kind: 'service',
      label: service.className,
      detail: service.providedIn ? `providedIn: ${service.providedIn}` : '',
      weight: 0,
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

  /* ── weight: how many things point at this ── */
  for (const edge of edges) {
    const target: GraphNode | undefined = nodes.get(edge.to);
    if (target) target.weight += 1;
  }

  return { root, nodes: [...nodes.values()], edges };
}

/** Types re-exported so a consumer needs one import. */
export type { ComponentFact, ServiceFact };
