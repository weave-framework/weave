import { signal } from '@weave-framework/runtime';
import Tabs from '@weave-framework/ui/tabs';

// Capitalized tags in the template resolve to this import.
void Tabs;

interface Setup {
  tabs: { label: string; content: string }[];
  idx: () => number;
  setIdx: (i: number) => void;
}

/** A tab strip bound to the active index. */
export function setup(): Setup {
  const idx = signal(0);
  const tabs = [
    { label: 'Overview', content: 'The overview panel — a summary of everything.' },
    { label: 'Activity', content: 'Recent activity shows up here.' },
    { label: 'Settings', content: 'Tweak your preferences on this tab.' },
  ];
  return { tabs, idx, setIdx: (i) => idx.set(i) };
}
