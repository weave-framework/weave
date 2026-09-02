import type { Edge, Graph, GraphNode } from '../../../src/types.js';

/**
 * Place a dependency graph on a canvas.
 *
 * Written by hand because RULE #1 says zero runtime dependencies, and because a general-purpose layout would be
 * the wrong tool anyway: this graph is not an arbitrary mesh. Its spine is a route tree cut by lazy boundaries,
 * which is a hierarchy — and a hierarchy drawn as a hierarchy is readable, while the same data thrown at a
 * force simulation is a hairball.
 *
 * Only the structural edges are laid out (`child`, `loads`). Injection is 227 of the 425 edges in one real app;
 * drawing them all at once is what turns a diagram into decoration, so they are revealed for one node at a time.
 */

/** A node with a place on the canvas. */
export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  /** Radius, from `weight` — importance is size, so it needs no reading. */
  r: number;
  /** Tree depth, 0 at a root. */
  level: number;
}

/** An edge with both ends resolved to points. */
export interface PlacedEdge extends Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A laid-out graph plus the canvas it needs. */
export interface Layout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

/** Card size. Nodes are cards, not dots: a dot needs a label beside it, and labels beside dots collide with
 *  the very edges they sit among. Text inside a card cannot collide with anything. */
export const CARD_W: number = 168;
export const CARD_H: number = 58;
/** Height of the coloured header strip that carries the node's kind and identifier. */
export const CARD_HEAD: number = 20;

/** Horizontal distance between depth levels — a card's width plus room for the edges between columns. */
const LEVEL_GAP: number = 300;
/** Vertical distance between siblings. */
const ROW_GAP: number = 76;
/** Left/top padding. The first version used 40 and the top row sat against the frame with no air above it. */
const PAD: number = 64;

/** Room kept to the right of the last column, so a long label has somewhere to go instead of being clipped. */
const LABEL_ROOM: number = CARD_W + 80;

/** Smallest vertical gap between two nodes in the same column, so nothing hides behind anything. */
const MIN_SEPARATION: number = CARD_H + 14;

/** Where guards and other unread classes are parked: one column past everything else. */
const SIDE_GAP: number = 260;

/** Radius for a node: a gentle curve, so a weight of 35 is bigger than 1 without being thirty-five times bigger. */
function radius(weight: number): number {
  return 5 + Math.min(11, Math.sqrt(weight) * 2.4);
}

/**
 * Lay the graph out left to right, one column per depth.
 *
 * A route tree with lazy boundaries has real roots (route files nothing loads) and real depth, so a tidy
 * layered walk is enough — no simulation, no iteration, no randomness. The same input always draws the same
 * picture, which matters when someone is comparing two runs.
 */
export function layout(graph: Graph): Layout {
  const structural: Edge[] = graph.edges.filter((e: Edge): boolean => e.kind === 'child' || e.kind === 'loads');
  const byId: Map<string, GraphNode> = new Map(graph.nodes.map((n: GraphNode): [string, GraphNode] => [n.id, n]));

  const children: Map<string, string[]> = new Map<string, string[]>();
  const hasParent: Set<string> = new Set<string>();
  for (const e of structural) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    const list: string[] = children.get(e.from) ?? [];
    list.push(e.to);
    children.set(e.from, list);
    hasParent.add(e.to);
  }

  // Roots: structural nodes nothing points at. A route file that no lazy route loads is an entry into the app.
  const roots: string[] = graph.nodes
    .filter((n: GraphNode): boolean => (n.kind === 'module' || n.kind === 'route') && !hasParent.has(n.id))
    .map((n: GraphNode): string => n.id);

  const placed: Map<string, PlacedNode> = new Map<string, PlacedNode>();
  let row: number = 0;

  /**
   * Walk depth-first, giving every leaf its own row and every parent the average of its children.
   *
   * Depth-first rather than breadth-first because it keeps a subtree together on screen: everything a lazy
   * module loads sits in one band, which is exactly the unit someone migrates.
   */
  const place = (nodeId: string, level: number, seen: Set<string>): number | null => {
    const node: GraphNode | undefined = byId.get(nodeId);
    if (!node) return null;
    // Already placed (a module several lazy routes load): report where it IS, so a parent averaging its
    // children uses a coordinate. The first version returned `row` here — the row COUNTER, not a position — so
    // a node whose children were all already placed inherited the number 10 as its y, and a dozen of them
    // stacked invisibly on one point near the top edge.
    if (seen.has(nodeId)) return placed.get(nodeId)?.y ?? null;
    seen.add(nodeId);

    const kids: string[] = children.get(nodeId) ?? [];
    let y: number;
    if (!kids.length) {
      y = PAD + row * ROW_GAP;
      row += 1;
    } else {
      const ys: number[] = [];
      for (const kid of kids) {
        const kidY: number | null = place(kid, level + 1, seen);
        if (kidY !== null) ys.push(kidY);
      }
      // Every child was unplaceable — take a row of its own rather than a meaningless average.
      y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : PAD + row * ROW_GAP;
      if (!ys.length) row += 1;
    }

    placed.set(nodeId, { ...node, x: PAD + level * LEVEL_GAP, y, r: radius(node.weight), level });
    return y;
  };

  const seen: Set<string> = new Set<string>();
  for (const rootId of roots) place(rootId, 0, seen);
  // Anything the structural walk never reached (an orphan route file) still deserves a place rather than
  // vanishing — silently dropping nodes is how a diagram starts lying.
  for (const node of graph.nodes) {
    if (placed.has(node.id) || (node.kind !== 'module' && node.kind !== 'route')) continue;
    placed.set(node.id, { ...node, x: PAD, y: PAD + row * ROW_GAP, r: radius(node.weight), level: 0 });
    row += 1;
  }

  /* ── separate anything that landed on the same spot ──
     A parent takes the average of its children's rows, so several routes loading the SAME module all inherit
     that module's y and stack invisibly: measured, six nodes on one point. Nudging them apart within their own
     column keeps the tree's shape while making every node visible, which is the whole job of a diagram. */
  const columns: Map<number, PlacedNode[]> = new Map<number, PlacedNode[]>();
  for (const node of placed.values()) {
    const list: PlacedNode[] = columns.get(node.x) ?? [];
    list.push(node);
    columns.set(node.x, list);
  }
  for (const column of columns.values()) {
    column.sort((a: PlacedNode, b: PlacedNode): number => a.y - b.y);
    let lastY: number = -Infinity;
    for (const node of column) {
      if (node.y - lastY < MIN_SEPARATION) node.y = lastY + MIN_SEPARATION;
      lastY = node.y;
    }
  }

  /* ── guards ──
     Routes are not the whole story: a guard decides whether a route can be entered at all, and in one real app
     the two heaviest things in the whole graph are guards (54 and 52 references). Drawing them only in the
     inspector meant the canvas showed a tree whose most important dependencies were invisible.
     They go in their own column past the deepest level — a handful of shared nodes that many routes point at,
     which is exactly what they are. */
  const rightmost: number = Math.max(...[...placed.values()].map((n: PlacedNode): number => n.x), PAD);
  const guardEdges: Edge[] = graph.edges.filter((e: Edge): boolean => e.kind === 'guards');
  const guardIds: string[] = [...new Set(guardEdges.map((e: Edge): string => e.to))];
  guardIds.forEach((gid: string, i: number): void => {
    const node: GraphNode | undefined = byId.get(gid);
    if (!node) return;
    placed.set(gid, {
      ...node,
      x: rightmost + SIDE_GAP,
      y: PAD + i * (CARD_H + 22),
      r: radius(node.weight),
      level: -1,
    });
  });

  const nodes: PlacedNode[] = [...placed.values()];
  const edges: PlacedEdge[] = [];
  for (const e of [...structural, ...guardEdges]) {
    const a: PlacedNode | undefined = placed.get(e.from);
    const b: PlacedNode | undefined = placed.get(e.to);
    if (a && b) edges.push({ ...e, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  const width: number = Math.max(...nodes.map((n: PlacedNode): number => n.x), 0) + LABEL_ROOM;
  const height: number = Math.max(...nodes.map((n: PlacedNode): number => n.y), 0) + CARD_H + PAD;
  return { nodes, edges, width, height };
}

/**
 * Every node on the path through `nodeId`: what leads to it, and everything it leads to.
 *
 * Selecting a card should light up its route, not just the card — that is the difference between "here is a
 * node" and "here is how this part of the app is reached". Walks both directions over the structural edges.
 */
export function pathThrough(graph: Graph, nodeId: string): Set<string> {
  const out: Set<string> = new Set<string>([nodeId]);
  if (!nodeId) return out;

  const forward: Map<string, string[]> = new Map<string, string[]>();
  const backward: Map<string, string[]> = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== 'child' && e.kind !== 'loads') continue;
    forward.set(e.from, [...(forward.get(e.from) ?? []), e.to]);
    backward.set(e.to, [...(backward.get(e.to) ?? []), e.from]);
  }

  const walk = (start: string, map: Map<string, string[]>): void => {
    const stack: string[] = [start];
    while (stack.length) {
      const current: string = stack.pop() as string;
      for (const next of map.get(current) ?? []) {
        if (out.has(next)) continue;
        out.add(next);
        stack.push(next);
      }
    }
  };
  walk(nodeId, forward);
  walk(nodeId, backward);

  // Guards hang off the selected node itself rather than off its path — they are why it can be entered.
  for (const e of graph.edges) {
    if (e.kind === 'guards' && e.from === nodeId) out.add(e.to);
  }
  return out;
}

/** The non-structural edges touching one node — what to reveal when it is selected. */
export function relatedEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter(
    (e: Edge): boolean => (e.kind === 'injects' || e.kind === 'renders' || e.kind === 'guards') && (e.from === nodeId || e.to === nodeId),
  );
}
