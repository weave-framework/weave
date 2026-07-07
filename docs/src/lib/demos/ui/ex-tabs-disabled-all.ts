import Tabs, { type TabItem } from '@weave-framework/ui/tabs';

// Capitalized tags in the template resolve to this import.
void Tabs;

interface Setup {
  tabs: TabItem[];
}

/** `disabled` on the group turns off every tab at once. */
export function setup(): Setup {
  const tabs: TabItem[] = [
    { label: 'Overview', content: 'A summary of everything.' },
    { label: 'Activity', content: 'Recent activity shows here.' },
    { label: 'Settings', content: 'Tweak your preferences.' },
  ];
  return { tabs };
}
