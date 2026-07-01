/**
 * `<Card>` — a surface panel (Keyline: 1px border, radius 4px, no shadow). Pure layout:
 * a vertical stack you compose from the part classes, which are the class contract:
 *
 *   <Card>
 *     <img class="weave-card__media" src="…" alt="…" />
 *     <h3 class="weave-card__title">Title</h3>
 *     <p class="weave-card__body">Body text.</p>
 *     <p class="weave-card__meta">Secondary meta.</p>
 *     <div class="weave-card__actions">
 *       <Button variant={{ 'marked' }}>Open</Button>
 *       <Button variant={{ 'ghost' }}>Dismiss</Button>
 *     </div>
 *   </Card>
 *
 * No behavior beyond forwarding `class`. `interactive` adds a hover tint — to make the
 * card actually clickable + accessible, wrap its content (or the card) in a link/button.
 */

export interface CardProps {
  /** Add a hover tint (for cards that act as a link/button). */
  interactive?: boolean;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string = '<div class={{ cardClass() }}><slot></slot></div>';

export interface CardContext {
  cardClass: () => string;
}

export function setup(props: CardProps): CardContext {
  return {
    cardClass: (): string => {
      const parts: string[] = ['weave-card'];
      if (props.interactive) parts.push('weave-card--interactive');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
  };
}
