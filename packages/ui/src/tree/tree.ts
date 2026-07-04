/**
 * `<Tree>` — a hierarchical disclosure surface (WAI-ARIA tree pattern). Expandable
 * folders (▸/▾) over file leaves, indented by depth, authored as a Weave template so the
 * body is a keyed `@for` over the **visible flattened nodes** and arbitrary `Node` content
 * mounts via `@render`. Styled by the Weave design (hairline hover, compact rows,
 * accent-as-a-mark selection — accentSoft tint + 2px accent left border, like the List).
 *
 * Two data models, one FlatNode shape:
 *  - **nested** (default): `nodes` are roots; a `children` accessor (default `node.children`)
 *    is recursed and a node's descendants appear only while it is expanded;
 *  - **flat**: pass `getLevel` (0-based depth) and the tree flattens by scanning the
 *    DFS-ordered array, hiding descendants of collapsed nodes.
 *
 * Expansion + selection ride the CDK `SelectionModel`; keyboard is the CDK `listKeyManager`
 * (vertical, typeahead) over the visible list plus Right/Left for expand/collapse/parent.
 * `role=tree` / `role=treeitem` with `aria-level`/`-setsize`/`-posinset`/`-expanded`/
 * `-selected`; a single roving tab stop.
 *
 *   import Tree from '@weave-framework/ui/tree';
 *   <Tree nodes={{ roots }} selectable defaultExpanded={{ [roots[0]] }} />
 */
import { signal, onMount, type Signal } from '@weave-framework/runtime';
import { selectionModel, listKeyManager, dropList, activeDirection, type SelectionModel, type ListKeyManager, type DropEvent } from '../cdk/index.js';

/** A node's rendered content: a factory over the node + its 1-based level. */
export type TreeNodeContent<N> = (node: N, level: number) => Node | string;

export interface TreeProps<N = unknown> {
  /** Root nodes (nested model) or the full DFS-ordered array (flat model). */
  nodes: N[];

  /* ── nested model ── */
  /** Get a node's children (default `node.children`). */
  children?: (node: N) => N[] | undefined;

  /* ── flat model (providing this switches to flat mode) ── */
  /** A node's 0-based depth. Its presence selects the flat model. */
  getLevel?: (node: N) => number;
  /** Whether a node can expand. Default: nested → has children; flat → next node is deeper. */
  isExpandable?: (node: N) => boolean;

  /* ── content ── */
  /** Node label text accessor (default `node.label`). */
  label?: (node: N) => string;
  /** Full node-content override — a factory returning a node/string (wins over `label`). */
  node?: TreeNodeContent<N>;
  /** Stable node identity (default: object identity) — row keys + selection/expansion. */
  trackBy?: (node: N) => string | number;

  /* ── expansion (controlled `expanded` OR uncontrolled `defaultExpanded`) ── */
  /** Controlled expanded set — when provided, it is the source of truth (pair with `onExpandedChange`). */
  expanded?: N[];
  /** Uncontrolled initial expanded set (ignored when `expanded` is provided). */
  defaultExpanded?: N[];
  /** Called with the next expanded set after every expand/collapse. */
  onExpandedChange?: (expanded: N[]) => void;

  /* ── selection ── */
  /** Enable node selection (click / Enter / Space). */
  selectable?: boolean;
  /** Selection cardinality. Default `single`. */
  selectionMode?: 'single' | 'multiple';
  /** Bring your own selection model (else one is created). */
  selection?: SelectionModel<N>;
  /** Called with the selected nodes on change. */
  onSelectionChange?: (selected: N[]) => void;
  /** Identity comparator for selection + expansion (default `===`). */
  compareWith?: (a: N, b: N) => boolean;

  /* ── reorder (CDK dropList) ── */
  /** Show a per-node drag handle and let nodes be reordered by dragging it. */
  reorderable?: boolean;
  /** Called on a committed reorder — indices are over the **visible** node order
   *  (`visible()[i].node`); the consumer applies it to its model. */
  onReorder?: (event: DropEvent) => void;

  /** Accessible name for the tree. */
  ariaLabel?: string;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

/** A visible node, flattened from the model against the current expansion state. */
interface FlatNode<N> {
  node: N;
  /** 0-based depth (drives indentation). */
  depth: number;
  /** 1-based level (`aria-level`). */
  level: number;
  key: unknown;
  expandable: boolean;
  posInSet: number;
  setSize: number;
  /** Index into the visible list — filled after flattening. */
  vindex: number;
}

export const template: string =
  '<div class={{ rootClass() }} role="tree" aria-label={{ ariaLabel() }} ref={{ host }} on:keydown={{ onKeydown }}>' +
  '@for (n of visible(); track n.key) {' +
  '<div class="weave-tree__node" role="treeitem"' +
  ' aria-level={{ n.level }} aria-setsize={{ n.setSize }} aria-posinset={{ n.posInSet }}' +
  ' aria-expanded={{ expandedAttr(n) }} aria-selected={{ selectedAttr(n) }}' +
  ' tabindex={{ tabindexFor(n) }} style={{ indentStyle(n) }}' +
  ' on:click={{ () => onActivate(n) }}>' +
  '@if (reorderable()) {<span class="weave-tree__drag-handle" aria-hidden="true">⠿</span>}' +
  '<span class={{ toggleClass(n) }} aria-hidden="true" on:click={{ (e) => onToggle(n, e) }}></span>' +
  '<span class="weave-tree__content">@render (contentNode(n))</span>' +
  '</div>' +
  '}' +
  '</div>';

export interface TreeContext<N> {
  host: Signal<HTMLElement | null>;
  rootClass: () => string;
  ariaLabel: () => string | undefined;
  reorderable: () => boolean;
  visible: () => FlatNode<N>[];
  expandedAttr: (n: FlatNode<N>) => 'true' | 'false' | undefined;
  selectedAttr: (n: FlatNode<N>) => 'true' | 'false' | undefined;
  tabindexFor: (n: FlatNode<N>) => number;
  indentStyle: (n: FlatNode<N>) => string;
  toggleClass: (n: FlatNode<N>) => string;
  contentNode: (n: FlatNode<N>) => Node;
  onActivate: (n: FlatNode<N>) => void;
  onToggle: (n: FlatNode<N>, event: Event) => void;
  onKeydown: (event: KeyboardEvent) => void;
}

/** Assign aria set-size / position-in-set over a flat, DFS-ordered array (all siblings,
 *  visible or not) by grouping each node under its nearest shallower ancestor. */
function flatSetPos<N>(data: N[], getLevel: (node: N) => number): { pos: number[]; size: number[] } {
  const n: number = data.length;
  const parentOf: number[] = new Array<number>(n).fill(-1);
  const lastAtLevel: number[] = [];
  for (let i: number = 0; i < n; i++) {
    const level: number = getLevel(data[i]);
    parentOf[i] = level <= 0 ? -1 : lastAtLevel[level - 1] ?? -1;
    lastAtLevel[level] = i;
    lastAtLevel.length = level + 1; // clear any deeper open levels
  }
  const groups: Map<number, number[]> = new Map<number, number[]>();
  for (let i: number = 0; i < n; i++) {
    const p: number = parentOf[i];
    const g: number[] = groups.get(p) ?? [];
    g.push(i);
    groups.set(p, g);
  }
  const pos: number[] = new Array<number>(n).fill(1);
  const size: number[] = new Array<number>(n).fill(1);
  for (const idxs of groups.values()) {
    idxs.forEach((di, k) => {
      pos[di] = k + 1;
      size[di] = idxs.length;
    });
  }
  return { pos, size };
}

export function setup<N = unknown>(props: TreeProps<N>): TreeContext<N> {
  const host: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);

  const flatMode: boolean = typeof props.getLevel === 'function';
  const keyOf = (node: N): unknown => (props.trackBy ? props.trackBy(node) : node);
  const labelOf = (node: N): string =>
    props.label ? props.label(node) : String((node as { label?: unknown })?.label ?? node);
  const childrenOf = (node: N): N[] | undefined =>
    props.children ? props.children(node) : (node as { children?: N[] }).children;
  const eqNode = (a: N, b: N): boolean => (props.compareWith ? props.compareWith(a, b) : a === b);

  /* ── expansion (controlled `expanded` OR uncontrolled `defaultExpanded`, Tabs convention) ── */
  const expandedModel: SelectionModel<N> = selectionModel<N>({
    multiple: true,
    initial: props.defaultExpanded,
    compareWith: props.compareWith,
  });
  const expandedControlled = (): boolean => props.expanded !== undefined;
  const currentExpanded = (): N[] => (expandedControlled() ? (props.expanded as N[]) : expandedModel.selected());
  const isExpandedNode = (node: N): boolean => currentExpanded().some((e) => eqNode(e, node));
  // Commit the next expanded set — mutate the internal model only when uncontrolled; always emit.
  const setExpanded = (next: N[]): void => {
    if (!expandedControlled()) expandedModel.setSelection(...next);
    props.onExpandedChange?.(next);
  };

  const selection: SelectionModel<N> =
    props.selection ??
    selectionModel<N>({
      multiple: props.selectionMode === 'multiple',
      compareWith: props.compareWith,
      onChange: () => props.onSelectionChange?.(selection.selected()),
    });

  /* ── flatten the model → the visible node list ── */
  const flattenNested = (nodes: N[], depth: number): FlatNode<N>[] => {
    const out: FlatNode<N>[] = [];
    nodes.forEach((node, i) => {
      const kids: N[] = childrenOf(node) ?? [];
      const expandable: boolean = props.isExpandable ? props.isExpandable(node) : kids.length > 0;
      out.push({ node, depth, level: depth + 1, key: keyOf(node), expandable, posInSet: i + 1, setSize: nodes.length, vindex: 0 });
      if (expandable && isExpandedNode(node)) out.push(...flattenNested(kids, depth + 1));
    });
    return out;
  };

  const flattenFlat = (): FlatNode<N>[] => {
    const data: N[] = props.nodes ?? [];
    const getLevel: (node: N) => number = props.getLevel as (node: N) => number;
    const { pos, size } = flatSetPos<N>(data, getLevel);
    const out: FlatNode<N>[] = [];
    let hideFrom: number = Infinity;
    data.forEach((node, i) => {
      const level: number = getLevel(node);
      if (level >= hideFrom) return; // under a collapsed ancestor → hidden
      const nextLevel: number = i + 1 < data.length ? getLevel(data[i + 1]) : -1;
      const expandable: boolean = props.isExpandable ? props.isExpandable(node) : nextLevel > level;
      out.push({ node, depth: level, level: level + 1, key: keyOf(node), expandable, posInSet: pos[i], setSize: size[i], vindex: 0 });
      hideFrom = expandable && !isExpandedNode(node) ? level + 1 : Infinity;
    });
    return out;
  };

  const visible = (): FlatNode<N>[] => {
    const list: FlatNode<N>[] = flatMode ? flattenFlat() : flattenNested(props.nodes ?? [], 0);
    list.forEach((fn, i) => {
      fn.vindex = i;
    });
    return list;
  };

  /* ── keyboard: vertical roving + typeahead, Right/Left drive the hierarchy ── */
  const manager: ListKeyManager<FlatNode<N>> = listKeyManager<FlatNode<N>>(visible, {
    orientation: 'vertical',
    wrap: false,
    typeahead: true,
    getLabel: (n) => labelOf(n.node),
  });

  // The single tabbable node: the one the keyboard moved to, else the selected one, else 0.
  const rovingIndex = (): number => {
    const active: number = manager.activeIndex();
    if (active >= 0) return active;
    if (props.selectable) {
      const sel: N | undefined = selection.selected()[0];
      if (sel !== undefined) {
        const idx: number = visible().findIndex((v) => eqNode(v.node, sel));
        if (idx >= 0) return idx;
      }
    }
    return 0;
  };

  const focusItem = (index: number): void => {
    host()?.querySelectorAll<HTMLElement>('.weave-tree__node')[index]?.focus();
  };
  const moveTo = (index: number): void => {
    manager.setActiveItem(index);
    focusItem(index);
  };
  const parentIndex = (i: number, vis: FlatNode<N>[]): number => {
    const level: number = vis[i].level;
    for (let j: number = i - 1; j >= 0; j--) if (vis[j].level < level) return j;
    return -1;
  };

  const toggleExpand = (n: FlatNode<N>): void => {
    const cur: N[] = currentExpanded();
    setExpanded(isExpandedNode(n.node) ? cur.filter((e) => !eqNode(e, n.node)) : [...cur, n.node]);
  };
  const expand = (n: FlatNode<N>): void => {
    if (isExpandedNode(n.node)) return;
    setExpanded([...currentExpanded(), n.node]);
  };
  const collapse = (n: FlatNode<N>): void => {
    if (!isExpandedNode(n.node)) return;
    setExpanded(currentExpanded().filter((e) => !eqNode(e, n.node)));
  };

  const onActivate = (n: FlatNode<N>): void => {
    manager.setActiveItem(n.vindex);
    if (props.selectable) {
      if (props.selectionMode === 'multiple') selection.toggle(n.node);
      else selection.select(n.node);
    } else if (n.expandable) {
      toggleExpand(n);
    }
  };

  const onToggle = (n: FlatNode<N>, event: Event): void => {
    event.stopPropagation(); // the chevron expands without selecting
    manager.setActiveItem(n.vindex);
    if (n.expandable) toggleExpand(n);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    const vis: FlatNode<N>[] = visible();
    if (vis.length === 0) return;
    if (manager.activeIndex() < 0) manager.setActiveItem(rovingIndex());
    const i: number = manager.activeIndex();
    const n: FlatNode<N> | undefined = vis[i];

    // In RTL the horizontal arrows flip: ArrowLeft expands / steps in, ArrowRight collapses / steps out.
    const rtl: boolean = activeDirection() === 'rtl';
    const intoKey: string = rtl ? 'ArrowLeft' : 'ArrowRight';
    const outKey: string = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === intoKey) {
      if (n?.expandable && !isExpandedNode(n.node)) {
        expand(n);
        event.preventDefault();
        return;
      }
      if (n?.expandable && isExpandedNode(n.node)) {
        const child: FlatNode<N> | undefined = vis[i + 1];
        if (child && child.level > n.level) moveTo(i + 1);
        event.preventDefault();
      }
      return;
    }
    if (event.key === outKey) {
      if (n?.expandable && isExpandedNode(n.node)) {
        collapse(n);
        event.preventDefault();
        return;
      }
      const p: number = parentIndex(i, vis);
      if (p >= 0) {
        moveTo(p);
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (n) onActivate(n);
      event.preventDefault();
      return;
    }
    if (manager.onKeydown(event)) {
      event.preventDefault();
      focusItem(manager.activeIndex());
    }
  };

  // Reorder via the CDK dropList — only the drag handle starts a drag (node clicks still
  // select/expand); keyboard is off (the tree owns Arrows/Space). Drops emit onReorder with
  // indices over the visible order; the consumer applies it to its model.
  onMount(() => {
    if (!props.reorderable) return;
    const el: HTMLElement | null = host();
    if (!el) return;
    dropList(el, {
      itemSelector: '.weave-tree__node',
      handle: '.weave-tree__drag-handle',
      orientation: 'vertical',
      keyboard: false,
      onDrop: (event: DropEvent) => props.onReorder?.(event),
    });
  });

  return {
    host,
    rootClass: (): string => {
      const parts: string[] = ['weave-tree'];
      if (props.reorderable) parts.push('weave-tree--reorderable');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    ariaLabel: (): string | undefined => props.ariaLabel,
    reorderable: (): boolean => !!props.reorderable,
    visible,
    expandedAttr: (n: FlatNode<N>): 'true' | 'false' | undefined =>
      n.expandable ? (isExpandedNode(n.node) ? 'true' : 'false') : undefined,
    selectedAttr: (n: FlatNode<N>): 'true' | 'false' | undefined =>
      props.selectable ? (selection.isSelected(n.node) ? 'true' : 'false') : undefined,
    tabindexFor: (n: FlatNode<N>): number => (n.vindex === rovingIndex() ? 0 : -1),
    indentStyle: (n: FlatNode<N>): string => `--weave-tree-depth:${n.depth}`,
    toggleClass: (n: FlatNode<N>): string =>
      n.expandable ? 'weave-tree__toggle' : 'weave-tree__toggle weave-tree__toggle--leaf',
    contentNode: (n: FlatNode<N>): Node => {
      const content: Node | string = props.node ? props.node(n.node, n.level) : labelOf(n.node);
      return typeof content === 'string' ? document.createTextNode(content) : content;
    },
    onActivate,
    onToggle,
    onKeydown,
  };
}
