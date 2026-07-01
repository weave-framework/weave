/**
 * `<ProgressSpinner>` — an indeterminate spinning ring (Weave: a `field` ring with an
 * accent top arc, rotating `.8s linear infinite`). Two sizes: default 26px, `--small`
 * 18px. Pure CSS + a size prop — `role=progressbar` with no `aria-valuenow` (the work
 * is of unknown length).
 *
 *   import ProgressSpinner from '@weave-framework/ui/progress-spinner';
 *   <ProgressSpinner label={{ 'Loading' }} />
 *   <ProgressSpinner small />
 */

export interface ProgressSpinnerProps {
  /** The compact 18px ring instead of the default 26px. */
  small?: boolean;
  /** Accessible name for the spinner. */
  label?: string;
  /** Extra classes, forwarded onto the ring. */
  class?: string;
}

export const template: string =
  '<div class={{ spinnerClass() }} role="progressbar" aria-label={{ label() }}></div>';

export interface ProgressSpinnerContext {
  spinnerClass: () => string;
  label: () => string | undefined;
}

export function setup(props: ProgressSpinnerProps): ProgressSpinnerContext {
  return {
    spinnerClass: (): string => {
      const parts: string[] = ['weave-progress-spinner'];
      if (props.small) parts.push('weave-progress-spinner--small');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    label: (): string | undefined => props.label,
  };
}
