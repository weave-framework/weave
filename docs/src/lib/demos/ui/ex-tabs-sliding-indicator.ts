import { signal } from '@weave-framework/runtime';
import Tabs from '@weave-framework/ui/tabs';

// Capitalized tags in the template resolve to this import.
void Tabs;

interface Setup {
  tabs: { label: string; content: string }[];
  idx: () => number;
  setIdx: (i: number) => void;
}

/**
 * `slidingIndicator` opts into a single `.weave-tabs__indicator` element the framework slides +
 * resizes (`transform: translateX` + `width`) to the active tab's box on every selection (and on
 * resize). The default look is a bottom accent underline; app CSS re-skins `.weave-tabs__indicator`
 * to a pill (fill, radius, full height). Off by default — Weave has no sliding marker unless asked.
 */
export function setup(): Setup {
  const idx = signal(0);
  const tabs = [
    { label: 'Overview', content: 'A summary of everything.' },
    { label: 'Activity', content: 'Recent activity shows here.' },
    { label: 'Settings', content: 'Tweak your preferences.' },
  ];
  return { tabs, idx, setIdx: (i) => idx.set(i) };
}
