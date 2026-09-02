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

/** A readable label for a route: its path, or a name for the two paths that have none. */
function routeLabel(route: RouteFact): string {
  if (route.path === '') return '/';
  if (route.path === '**') return '(not found)';
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
      label: shortPath(file, root),
      detail: `${facts.routes.filter((r: RouteFact): boolean => r.file === file).length} route(s)`,
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

  /* ── weight: how many things point at this ── */
  for (const edge of edges) {
    const target: GraphNode | undefined = nodes.get(edge.to);
    if (target) target.weight += 1;
  }

  return { root, nodes: [...nodes.values()], edges };
}

/** Types re-exported so a consumer needs one import. */
export type { ComponentFact, ServiceFact };
