/**
 * `<GridList>` — a responsive grid of square tiles (the Weave gallery: `repeat(auto-fill,
 * minmax(96px, 1fr))`, 1px hairline gaps, one tile optionally accent-filled). Pure layout
 * — a CSS grid you compose from the part classes; the tiles are your content:
 *
 *   <GridList>
 *     <div class="weave-grid-list__tile">A</div>
 *     <div class="weave-grid-list__tile weave-grid-list__tile--accent">B</div>
 *     <div class="weave-grid-list__tile">C</div>
 *   </GridList>
 *
 * No behavior beyond forwarding `class`. Reflows with no JS (the grid auto-fills columns
 * to the container width). Set a semantic role (`list`, `grid`) on it yourself if the
 * context calls for one — the component stays an unopinionated layout container.
 */

export interface GridListProps {
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string = '<div class={{ gridListClass() }}><slot></slot></div>';

export interface GridListContext {
  gridListClass: () => string;
}

export function setup(props: GridListProps): GridListContext {
  return {
    gridListClass: (): string => (props.class ? `weave-grid-list ${props.class}` : 'weave-grid-list'),
  };
}
