import { handledFor, handledNote, type Handled } from '../../../src/handled.js';
import type { Graph, GraphNode } from '../../../src/types.js';
import { dependencyClosure } from './layout.js';

/**
 * What a selection actually costs, worked out before a single file is written.
 *
 * Step two collects marks. Marks alone answer none of the three questions a person has at the moment they
 * are about to commit to them, and all three were previously answerable only by reading the generated code
 * afterwards:
 *
 *   what comes with it   — a mark on one screen drags in the things it needs. Measured on one real
 *                          application, marking the `login` route reaches 30 nodes, 17 of them ours and
 *                          none of them chosen by hand. They will be written.
 *   what cannot come     — the injected classes with no source behind them. The whole application has 27;
 *                          the median route touches 12, and 18 of its 28 routes fewer than half. The list
 *                          roughly halves, which is less than it first looked and still the difference
 *                          between a statistic and a to-do list.
 *   what it touches      — the source files behind all of it.
 *
 * All of it is derived from the graph already on screen. Nothing here asks the service anything, so the
 * screen answers instantly and cannot disagree with the picture the marks were made on.
 */

/** One injected class the selection needs and the migration cannot produce. */
export interface Outsider {
  node: GraphNode;
  /** How much of the work the converter does by itself. Mostly `none`, and saying so is the point. */
  handled: Handled;
  /** The converter's own note, when it has one. Empty otherwise. */
  note: string;
}

/** The consequences of everything marked so far. */
export interface Consequence {
  /** Marked by hand. What the reader believes they chose. */
  chosen: GraphNode[];
  /** Ours, reached from a mark, never marked. What they did not choose and will get anyway. */
  carried: GraphNode[];
  /** Reached and not ours. Ordered by how many of the SELECTED classes inject each — not by global weight. */
  outside: Outsider[];
  /** Source files behind `chosen` and `carried`, relative to the analysed unit, in order. */
  files: string[];
}

/** Nothing marked. A distinct value so a caller never has to special-case the empty screen. */
export function noConsequence(): Consequence {
  return { chosen: [], carried: [], outside: [], files: [] };
}

/**
 * Work out what the marks imply.
 *
 * Marks are stored by `key`, which survives a different checkout; the graph is walked by `id`, which does
 * not. Translating between the two is the one thing here that has broken before — a version marking by id
 * filled the file with entries nothing could read back — so it happens once, in the open, at the top.
 */
export function consequence(graph: Graph | null, decisions: Record<string, 'migrate'>): Consequence {
  if (!graph) return noConsequence();

  const marked: GraphNode[] = graph.nodes.filter((n: GraphNode): boolean => decisions[n.key] === 'migrate');
  if (!marked.length) return noConsequence();

  const markedIds: Set<string> = new Set<string>(marked.map((n: GraphNode): string => n.id));

  /* Forward closure from every mark, unioned. Two marks that share a dependency must not report it twice,
     and one mark inside another's closure must not make that closure "carried" — hence a set, not a list. */
  const reached: Set<string> = new Set<string>();
  for (const node of marked) for (const id of dependencyClosure(graph, node.id)) reached.add(id);

  const byId: Map<string, GraphNode> = new Map<string, GraphNode>(graph.nodes.map((n: GraphNode): [string, GraphNode] => [n.id, n]));

  const carried: GraphNode[] = [];
  const outsideNodes: GraphNode[] = [];
  for (const id of reached) {
    const node: GraphNode | undefined = byId.get(id);
    if (!node) continue;
    if (node.kind === 'external') {
      outsideNodes.push(node);
      continue;
    }
    // A group card is the viewer's own invention, standing for nodes that are themselves in `reached`.
    // Counting it would report a number larger than the thing it describes.
    if (node.kind === 'group') continue;
    if (!markedIds.has(id)) carried.push(node);
  }

  /* Ordered by how much of THIS selection rides on each, not by the weight it carries across the whole
     application. `TranslateService` leading a list of 27 says nothing about a selection that never touches
     it, and the old panel led with it every time. */
  const injectedBy = (label: string): number =>
    graph.edges.filter((e): boolean => e.kind === 'injects' && e.to === labelId(graph, label) && reached.has(e.from)).length;

  const outside: Outsider[] = outsideNodes
    .map((node: GraphNode): Outsider => ({ node, handled: handledFor(node.label, node.library), note: handledNote(node.label) }))
    .sort((a: Outsider, b: Outsider): number => {
      const byUse: number = injectedBy(b.node.label) - injectedBy(a.node.label);
      return byUse !== 0 ? byUse : a.node.label.localeCompare(b.node.label);
    });

  const files: string[] = [...new Set([...marked, ...carried].map((n: GraphNode): string | undefined => n.file).filter((f): f is string => !!f))].sort();

  return { chosen: [...marked].sort(byLabel), carried: carried.sort(byLabel), outside, files };
}

/** The id of the node carrying a label, so an `injects` edge can be counted against it. */
function labelId(graph: Graph, label: string): string {
  return graph.nodes.find((n: GraphNode): boolean => n.label === label)?.id ?? '';
}

/** Alphabetical, so two runs of the same selection read the same way. */
function byLabel(a: GraphNode, b: GraphNode): number {
  return a.label.localeCompare(b.label);
}

/** How many of the outside classes still need a person to decide something — the number the step exists for. */
export function undecided(list: Outsider[]): number {
  return list.filter((o: Outsider): boolean => o.handled !== 'automatic').length;
}
