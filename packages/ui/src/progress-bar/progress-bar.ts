/**
 * `<ProgressBar>` — a thin horizontal progress indicator (Weave: 4px `field` track,
 * accent fill). Two modes:
 *
 * - **Determinate (default)** — an accent fill grows to `value`% (0–100, clamped).
 *   `role=progressbar` with `aria-valuemin/max/now`.
 * - **Indeterminate (`indeterminate`)** — a sliding accent segment for work of unknown
 *   length; `aria-valuenow` is omitted (only min/max remain), per WAI-ARIA.
 *
 *   import ProgressBar from '@weave-framework/ui/progress-bar';
 *   <ProgressBar value={{ pct() }} />
 *   <ProgressBar indeterminate label={{ 'Loading' }} />
 */

export interface ProgressBarProps {
  /** Completion 0–100 (clamped). Ignored when `indeterminate`. Default 0. */
  value?: number;
  /** Unknown-length work: a sliding segment, no `aria-valuenow`. */
  indeterminate?: boolean;
  /** Accessible name for the bar. */
  label?: string;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string =
  '<div class={{ barClass() }} role="progressbar" aria-valuemin="0" aria-valuemax="100"' +
  ' aria-valuenow={{ valueNow() }} aria-label={{ label() }}>' +
  '<div class="weave-progress-bar__fill" style={{ fillStyle() }}></div>' +
  '</div>';

export interface ProgressBarContext {
  barClass: () => string;
  valueNow: () => number | undefined;
  fillStyle: () => string | undefined;
  label: () => string | undefined;
}

/** Clamp to 0–100; non-finite → 0. */
function clampPct(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function setup(props: ProgressBarProps): ProgressBarContext {
  const indeterminate = (): boolean => !!props.indeterminate;
  return {
    barClass: (): string => {
      const parts: string[] = ['weave-progress-bar'];
      if (indeterminate()) parts.push('weave-progress-bar--indeterminate');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    // Omit aria-valuenow while indeterminate (WAI-ARIA: value is unknown).
    valueNow: (): number | undefined => (indeterminate() ? undefined : clampPct(props.value)),
    // Determinate drives the fill width inline; indeterminate lets the keyframes drive it.
    fillStyle: (): string | undefined => (indeterminate() ? undefined : `width: ${clampPct(props.value)}%`),
    label: (): string | undefined => props.label,
  };
}
