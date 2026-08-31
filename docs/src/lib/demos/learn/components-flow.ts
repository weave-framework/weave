import { signal } from '@weave-framework/runtime';
import Counter from './components-flow-child';

// The child tag in the template resolves to this import.
void Counter;

/**
 * Props down, events up — the whole contract, in the smallest thing that shows both directions at once.
 *
 * The parent owns `step` and `total`. It passes `step` DOWN as a prop and hands the child a function to
 * call. Change the step with the parent's buttons and the child's label updates without the child being
 * re-created: a prop is a live getter into the parent, not a value copied at creation.
 */
export function setup() {
  const step = signal(1);
  const total = signal(0);
  const log = signal<string[]>([]);

  const setStep = (n: number): void => {
    step.set(n);
  };
  const onAdd = (amount: number): void => {
    total.set((t) => t + amount);
    log.set((l) => [...l.slice(-3), `child sent ${amount}`]);
  };
}
