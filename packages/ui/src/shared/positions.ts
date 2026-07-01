/**
 * Shared connected-position vocabulary for anchored panels (Menu, Select, Autocomplete).
 * A position is a named preset (RTL-aware `-start`/`-end`) or an explicit anchor pair.
 */
import type { ConnectedPosition, PositionName } from '../cdk/index.js';

/**
 * Where a panel sits relative to its object. Either a named preset or an explicit
 * origin↔overlay anchor pair for full 3×3 control. Presets map to the mental model:
 *   below:  `bottom-start` (left) · `bottom` (centre) · `bottom-end` (right)
 *   above:  `top-start`    (left) · `top`    (centre) · `top-end`    (right)
 *   side:   `left` / `right` (+ `-start`/`-end` for top/bottom-aligned)
 */
export type MenuPosition = PositionName | ConnectedPosition;

const OPPOSITE: Record<PositionName, PositionName> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
  'top-start': 'bottom-start',
  'bottom-start': 'top-start',
  'top-end': 'bottom-end',
  'bottom-end': 'top-end',
  'left-start': 'right-start',
  'right-start': 'left-start',
  'left-end': 'right-end',
  'right-end': 'left-end',
};

/**
 * Build the flip-fallback list from a requested position. A preset gets its opposite
 * appended (so it flips on overflow); an explicit pair is used as-is (shift-clamps to fit);
 * nothing requested falls back to the component default (+ its opposite).
 */
export function buildPositions(position: MenuPosition | undefined, fallback: PositionName): MenuPosition[] {
  if (position == null) return [fallback, OPPOSITE[fallback]];
  if (typeof position === 'string') return [position, OPPOSITE[position]];
  return [position];
}
