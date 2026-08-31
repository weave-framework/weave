/**
 * The child. It knows two things: a `step` handed down, and a function to call when the button is
 * pressed. It holds no reference to the parent and no shared state — the function IS the channel.
 *
 * `presses` is its own private state, and it survives every change to `step`, which is the visible proof
 * that changing a prop does not re-create the child.
 */
import { signal } from '@weave-framework/runtime';

interface CounterProps {
  step: number;
  onAdd: (amount: number) => void;
}

export function setup(props: CounterProps) {
  const presses = signal(0);

  const step = (): number => props.step;
  const send = (): void => {
    presses.set((p) => p + 1);
    props.onAdd(props.step);
  };
}
