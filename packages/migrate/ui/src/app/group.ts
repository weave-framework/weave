import type { Edge, Graph, GraphNode } from '../../../src/types.js';

/**
 * Collapse a graph into folder groups.
 *
 * 227 cards is not a drawing. The fix is not a cleverer arrangement of 227 things — it is showing fewer of
 * them, and the folder each node's source lives in is what decides which. Measured on a real application the
 * first level is five groups, and it separates the application from the shared component and service
 * libraries, which is the first question anyone asks of a codebase they are about to migrate.
 *
 * A collapsed group is an ordinary node, and the result is an ordinary graph — so the existing layout draws it
 * with no idea that anything was folded. Opening a group swaps its card for its members, in place.
 */

/** Nodes with no folder of their own, gathered by kind rather than left loose. */
const LOOSE: Record<string, { key: string; label: string }> = {
  external: { key: '·npm', label: 'From npm' },
};

/**
 * Kinds that are never folded away.
 *
 * The route tree is the spine — the shape a person recognises as their own application — and folding parts of
 * it breaks the thing the picture is for. Reported from a screenshot: selecting `users` showed a link to its
 * parent route and nothing else, because its one child (a `(default)` route with a component) had a folder and
 * so was swallowed into the application's group. The route was still there; its half of the tree was not.
 *
 * Routes and route files keep their folder — it is what a migration decision will hang off — but they are
 * always drawn. Only the things that hang off the spine are folded.
 */
const NEVER_FOLDED: ReadonlySet<string> = new Set<string>(['route', 'module']);

/** The group key a node belongs to: the first segment of its folder, or a bucket for the folderless. */
export function groupKeyOf(node: GraphNode): string | null {
  if (NEVER_FOLDED.has(node.kind)) return null;
  if (node.folder !== undefined && node.folder !== '') return node.folder.split('/')[0];
  return LOOSE[node.kind]?.key ?? null;
}

/** What a group card stands for, for the card face and the side panel. */
export interface GroupSummary {
  key: string;
  label: string;
  /** How many nodes it holds, by kind, most numerous first. */
  counts: Array<{ kind: string; n: number }>;
  total: number;
  /** Members, so a group can be listed without re-deriving it. */
  members: string[];
}

/** A collapsed graph, plus what each group card stands for. */
export interface Grouped {
  graph: Graph;
  groups: GroupSummary[];
  /** True when there is anything to collapse — a graph of one group is not worth folding. */
  worthGrouping: boolean;
}

const GROUP_PREFIX: string = 'group:';

/** True when this id is a collapsed group rather than a real node. */
export function isGroupId(id: string): boolean {
  return id.startsWith(GROUP_PREFIX);
}

/** The key behind a group id. */
export function groupKeyFromId(id: string): string {
  return id.slice(GROUP_PREFIX.length);
}

/**
 * Fold every group not in `opened` into a single card.
 *
 * Edges follow: an edge whose ends land in two different groups becomes an edge between those group cards,
 * and one landing inside a single group disappears — it is internal detail, visible when the group is opened.
 * Parallel edges are merged, keeping the strongest relationship, so two groups joined by forty injections draw
 * one line rather than forty.
 *
 * `revealed` names nodes that stay on the canvas whatever folder they belong to. It is how a selection shows
 * what it connects to: selecting a route whose component is folded away lit an edge to a folder card and
 * nothing else, which reads as "nothing happened". Lifting just the neighbours keeps the rest folded, so the
 * answer arrives without the whole folder arriving with it.
 */
export function collapse(graph: Graph, opened: ReadonlySet<string>, revealed: ReadonlySet<string> = new Set<string>()): Grouped {
  const keyOf: Map<string, string | null> = new Map<string, string | null>();
  for (const node of graph.nodes) keyOf.set(node.id, groupKeyOf(node));

  const members: Map<string, GraphNode[]> = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const key: string | null = keyOf.get(node.id) ?? null;
    if (key === null) continue;
    const list: GraphNode[] | undefined = members.get(key);
    if (list) list.push(node);
    else members.set(key, [node]);
  }

  const summaries: GroupSummary[] = [...members]
    .map(([key, list]: [string, GraphNode[]]): GroupSummary => {
      const byKind: Map<string, number> = new Map<string, number>();
      for (const n of list) byKind.set(n.kind, (byKind.get(n.kind) ?? 0) + 1);
      return {
        key,
        label: labelFor(key),
        counts: [...byKind].map(([kind, n]: [string, number]) => ({ kind, n })).sort((a, b) => b.n - a.n),
        total: list.length,
        members: list.map((n: GraphNode): string => n.id),
      };
    })
    .sort((a: GroupSummary, b: GroupSummary): number => b.total - a.total);

  /* Where each original node ends up: itself when its group is open or it has none, otherwise the group card. */
  const landsOn: Map<string, string> = new Map<string, string>();
  for (const node of graph.nodes) {
    const key: string | null = keyOf.get(node.id) ?? null;
    const stays: boolean = key === null || opened.has(key) || revealed.has(node.id);
    landsOn.set(node.id, stays ? node.id : `${GROUP_PREFIX}${key as string}`);
  }

  const nodes: GraphNode[] = [];
  for (const node of graph.nodes) {
    if (landsOn.get(node.id) === node.id) nodes.push(node);
  }
  for (const summary of summaries) {
    if (opened.has(summary.key)) continue;
    // What is still behind this card. Revealed members are drawn in their own right, so counting them here
    // would have the card claim to hold cards that are sitting next to it.
    const inside: string[] = summary.members.filter((id: string): boolean => landsOn.get(id) !== id);
    if (!inside.length) continue;
    nodes.push({
      id: `${GROUP_PREFIX}${summary.key}`,
      // A folder card is made by the viewer and stands for a folder, so its own name is already stable.
      key: `${GROUP_PREFIX}${summary.key}`,
      kind: 'group',
      label: summary.label,
      detail: summary.counts.map((c: { kind: string; n: number }): string => `${c.n} ${c.kind}`).join(' · '),
      // Size still reads as importance, and for a group that is how much is still inside it.
      weight: inside.length,
      folder: summary.key,
    });
  }

  /* Edges, rewritten onto whatever each end landed on. An edge inside one group is dropped: it is the group's
     own business until someone opens it. Where several edges join the same pair, one line is drawn — a
     structural relationship beats an injection, because it says more about how the two are connected. */
  const RANK: Record<string, number> = {
    loads: 6, child: 5, declares: 4, imports: 3, renders: 3, uses: 2, guards: 2, injects: 1,
  };
  const best: Map<string, Edge> = new Map<string, Edge>();
  for (const edge of graph.edges) {
    const from: string = landsOn.get(edge.from) ?? edge.from;
    const to: string = landsOn.get(edge.to) ?? edge.to;
    if (from === to) continue;
    const key: string = `${from}\u0000${to}`;
    const current: Edge | undefined = best.get(key);
    if (!current || (RANK[edge.kind] ?? 0) > (RANK[current.kind] ?? 0)) best.set(key, { from, to, kind: edge.kind });
  }

  return {
    graph: { nodes, edges: [...best.values()], root: graph.root },
    groups: summaries,
    worthGrouping: summaries.length > 1,
  };
}

/** A group's name on its card: the folder, or the fixed label for a bucket. */
function labelFor(key: string): string {
  for (const loose of Object.values(LOOSE)) if (loose.key === key) return loose.label;
  return key;
}
