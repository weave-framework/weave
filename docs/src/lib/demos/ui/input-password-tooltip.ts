import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to this import.
void Input;

interface Setup {
  a: () => string;
  setA: (v: string) => void;
  b: () => string;
  setB: (v: string) => void;
  c: () => string;
  setC: (v: string) => void;
  shown: () => boolean;
  onToggle: (revealed: boolean) => void;
}

/**
 * `revealTooltip` picks the hint on the eye: `'native'` (browser title), `'weave'` (the
 * styled Tooltip, hover + focus), or `'none'`. `onRevealToggle` fires with the new state
 * on every flip — here it drives the live readout under the third field.
 */
export function setup(): Setup {
  const a = signal('hunter2');
  const b = signal('hunter2');
  const c = signal('hunter2');
  const shown = signal(false);
  return {
    a, setA: (v) => a.set(v),
    b, setB: (v) => b.set(v),
    c, setC: (v) => c.set(v),
    shown,
    onToggle: (revealed) => shown.set(revealed),
  };
}
