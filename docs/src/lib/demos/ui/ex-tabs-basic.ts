import { signal } from '@weave-framework/runtime';
import Tabs from '@weave-framework/ui/tabs';

// Capitalized tags in the template resolve to this import.
void Tabs;

interface Setup {
  tabs: { label: string; content: string }[];
  idx: () => number;
  setIdx: (i: number) => void;
}

/** Controlled tab strip: value + onChange bind the active index to a signal. */
export function setup(): Setup {
  const idx = signal(0);
  const tabs = [
    { label: 'Overview', content: 'A summary of everything.' },
    { label: 'Activity', content: 'Recent activity shows here.' },
    { label: 'Settings', content: 'Tweak your preferences.' },
  ];
  return { tabs, idx, setIdx: (i) => idx.set(i) };
}
