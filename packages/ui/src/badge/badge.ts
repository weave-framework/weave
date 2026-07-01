/**
 * `<Badge>` — a small status mark. Three variants:
 *
 * - **count** (default) — an accent pill over the top corner of its slotted host
 *   (an icon, a button…): `<Badge content={{ 3 }}><Icon name={{ 'bell' }} /></Badge>`.
 *   The count is announced via `aria-label` on the host; the pill itself is
 *   `aria-hidden` (decorative). `max` caps the display (e.g. `99+`).
 * - **dot** (`variant="dot"`) — a bare 6px status dot over the corner, no text.
 * - **tag** (`variant="tag"`) — a standalone outline label; the slot IS the text
 *   (`<Badge variant={{ 'tag' }}>New</Badge>`), no host overlay.
 *
 * Pure display — lean DOM (a wrapper + one positioned mark for count/dot; just the
 * wrapper for tag). `position` places the mark in any corner (default top-end).
 */

export type BadgeVariant = 'count' | 'dot' | 'tag';
export type BadgePosition = 'top-end' | 'top-start' | 'bottom-end' | 'bottom-start';

export interface BadgeProps {
  /** Which mark to render. Default `'count'`. */
  variant?: BadgeVariant;
  /** The count/text shown in a `count` mark. */
  content?: string | number;
  /** Cap the displayed count (a number over `max` shows `max+`). */
  max?: number;
  /** Corner for the overlaid mark (count/dot). Default `'top-end'`. */
  position?: BadgePosition;
  /** Accessible name for the host (defaults to the count for `count` badges). */
  label?: string;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string =
  '<span class={{ badgeClass() }} aria-label={{ ariaLabel() }}>' +
  '<slot></slot>' +
  '@if (showMark()) {' +
  '<span class="weave-badge__mark" aria-hidden="true">{{ markText() }}</span>' +
  '}' +
  '</span>';

export interface BadgeContext {
  badgeClass: () => string;
  ariaLabel: () => string | undefined;
  showMark: () => boolean;
  markText: () => string;
}

export function setup(props: BadgeProps): BadgeContext {
  const variant = (): BadgeVariant => props.variant ?? 'count';
  const hasContent = (): boolean => props.content != null && props.content !== '';

  const markText = (): string => {
    if (variant() !== 'count') return '';
    const value: string | number | undefined = props.content;
    if (typeof value === 'number' && props.max != null && value > props.max) return `${props.max}+`;
    return String(value ?? '');
  };

  // count shows only when there's something to show; dot always; tag never (it IS the mark).
  const showMark = (): boolean => (variant() === 'dot' ? true : variant() === 'count' ? hasContent() : false);

  return {
    badgeClass: (): string => {
      const parts: string[] = ['weave-badge'];
      const v: BadgeVariant = variant();
      if (v !== 'count') parts.push(`weave-badge--${v}`);
      const position: BadgePosition = props.position ?? 'top-end';
      if (position.startsWith('bottom')) parts.push('weave-badge--bottom');
      if (position.endsWith('start')) parts.push('weave-badge--start');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    // Host label: explicit `label`, else the count (so the pill's number is announced).
    ariaLabel: (): string | undefined => {
      if (variant() === 'tag') return undefined;
      return props.label ?? (variant() === 'count' && hasContent() ? markText() : undefined);
    },
    showMark,
    markText,
  };
}
