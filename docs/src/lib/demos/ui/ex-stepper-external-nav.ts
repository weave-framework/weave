import { signal } from '@weave-framework/runtime';
import Stepper from '@weave-framework/ui/stepper';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to these imports.
void Stepper;
void Button;

interface Setup {
  steps: { label: string; content: string }[];
  idx: () => number;
  setIdx: (i: number) => void;
  atStart: () => boolean;
  atEnd: () => boolean;
  back: () => void;
  next: () => void;
}

/**
 * `showNav={{ false }}` hides the built-in buttons so your own Buttons drive
 * the current index — the header still reflects it and stays clickable.
 */
export function setup(): Setup {
  const idx = signal(0);
  const steps = [
    { label: 'Cart', content: 'Review the items in your cart.' },
    { label: 'Shipping', content: 'Enter a delivery address.' },
    { label: 'Payment', content: 'Choose how to pay.' },
  ];
  const last = steps.length - 1;
  return {
    steps,
    idx,
    setIdx: (i) => idx.set(i),
    atStart: () => idx() === 0,
    atEnd: () => idx() === last,
    back: () => idx.set(Math.max(0, idx() - 1)),
    next: () => idx.set(Math.min(last, idx() + 1)),
  };
}
