import Tabs, { type TabItem } from '@weave-framework/ui/tabs';

// Capitalized tags in the template resolve to this import.
void Tabs;

interface Setup {
  tabs: TabItem[];
}

/** `label` gives the tablist an accessible name (aria-label on the tablist). */
export function setup(): Setup {
  const tabs: TabItem[] = [
    { label: 'Overview', content: 'A summary of everything.' },
    { label: 'Activity', content: 'Recent activity shows here.' },
    { label: 'Settings', content: 'Tweak your preferences.' },
  ];
  return { tabs };
}
