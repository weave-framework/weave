/**
 * `<Button>` — a real native `<button>` with the Weave variants, a ripple, and a
 * focus-visible ring. Content is projected (`<Button>Save</Button>`), so it carries
 * any label/icon. Lean DOM: one `<button>`, no wrappers.
 *
 * Variants (REAL Weave): default = Primary (ink fill); `outline` (inverts on hover);
 * `marked` (2px accent underline); `ghost` (text only); `icon` (34px square — pass an
 * `<Icon>` and a `label` for the accessible name).
 *
 * Native-first: the real `<button>` gives keyboard, focus, and form-submit for free —
 * `type="submit"` participates in a form with zero extra wiring. `disabled` is the
 * native attribute (also suppresses the ripple). `class` is forwarded so layout stays
 * the consumer's job.
 *
 *   import Button from '@weave-framework/ui/button';
 *   <Button on:click={{ save }}>Save</Button>
 *   <Button variant={{ 'outline' }}>Cancel</Button>
 *   <Button variant={{ 'icon' }} label={{ 'Delete' }}><Icon name={{ 'trash-2' }} /></Button>
 */

import { ripple, type RippleOptions } from '../ripple/ripple.js';

export type ButtonVariant = 'primary' | 'outline' | 'marked' | 'ghost' | 'icon';

export interface ButtonProps {
  /** Weave variant. Default `'primary'` (no modifier class). */
  variant?: ButtonVariant;
  /** Native button type. Default `'button'` (so it never submits by accident). */
  type?: 'button' | 'submit' | 'reset';
  /** Native disabled state — greys the button and suppresses click/ripple. */
  disabled?: boolean;
  /** Accessible name. Required for an icon-only (`variant="icon"`) button. */
  label?: string;
  /** Click handler — forwarded to the native button so `<Button on:click={{…}}>` works. */
  onClick?: (event: MouseEvent) => void;
  /** Extra classes, forwarded onto the host `<button>`. */
  class?: string;
}

export const template: string =
  '<button class={{ classes() }} type={{ type() }} disabled={{ disabled() }}' +
  ' aria-label={{ label() }} on:click={{ onClick }} use:ripple={{ rippleOptions }}><slot></slot></button>';

export interface ButtonContext {
  classes: () => string;
  type: () => string;
  disabled: () => boolean;
  label: () => string | undefined;
  onClick: (event: MouseEvent) => void;
  rippleOptions: RippleOptions;
  ripple: typeof ripple;
}

export function setup(props: ButtonProps): ButtonContext {
  return {
    // `.weave-button` + variant modifier (Primary = none) + forwarded classes.
    classes: (): string => {
      const variant: ButtonVariant = props.variant ?? 'primary';
      const modifier: string = variant === 'primary' ? '' : ` weave-button--${variant}`;
      const extra: string = props.class ? ` ${props.class}` : '';
      return `weave-button${modifier}${extra}`;
    },
    type: (): string => props.type ?? 'button',
    disabled: (): boolean => !!props.disabled,
    label: (): string | undefined => props.label,
    // Forward the click to the consumer's handler (native `disabled` already blocks it).
    onClick: (event: MouseEvent): void => props.onClick?.(event),
    // Ripple reads `disabled` at pointerdown time, so a disabled button never ripples.
    rippleOptions: {
      get disabled(): boolean {
        return !!props.disabled;
      },
    },
    ripple,
  };
}
