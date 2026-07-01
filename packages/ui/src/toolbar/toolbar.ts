/**
 * `<Toolbar>` — a horizontal app bar (Keyline: 52px, surface bg, 1px bottom rule, no
 * shadow). Pure layout — a flex row you compose from the part classes:
 *
 *   <Toolbar sticky>
 *     <div class="weave-toolbar__start">
 *       <Button variant={{ 'icon' }} label={{ 'Menu' }}><Icon name={{ 'menu' }} /></Button>
 *       <strong>Weave UI</strong>
 *     </div>
 *     <span class="weave-toolbar__spacer"></span>
 *     <div class="weave-toolbar__end">
 *       <ButtonToggle options={{ modes }} value={{ mode() }} onChange={{ setMode }} />
 *     </div>
 *   </Toolbar>
 *
 * No behavior beyond forwarding `class`. `variant="ink"` inverts to an ink bar;
 * `sticky` pins it to the top. Set a semantic role (`banner`/`toolbar`) on it yourself
 * if the context calls for one — the component stays an unopinionated layout container.
 */

export type ToolbarVariant = 'ink';

export interface ToolbarProps {
  /** Invert to an ink bar. Default = surface. */
  variant?: ToolbarVariant;
  /** Pin to the top (`position: sticky`). */
  sticky?: boolean;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string = '<div class={{ toolbarClass() }}><slot></slot></div>';

export interface ToolbarContext {
  toolbarClass: () => string;
}

export function setup(props: ToolbarProps): ToolbarContext {
  return {
    toolbarClass: (): string => {
      const parts: string[] = ['weave-toolbar'];
      if (props.variant) parts.push(`weave-toolbar--${props.variant}`);
      if (props.sticky) parts.push('weave-toolbar--sticky');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
  };
}
