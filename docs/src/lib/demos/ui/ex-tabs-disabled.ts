import Tabs, { type TabItem } from '@weave-framework/ui/tabs';

// Capitalized tags in the template resolve to this import.
void Tabs;

interface Setup {
  tabs: TabItem[];
}

/** `disabled` on a single item makes that tab unselectable and skipped in keyboard nav. */
export function setup(): Setup {
  const tabs: TabItem[] = [
    { label: 'Overview', content: 'A summary of everything.' },
    { label: 'Billing', content: 'Not available on your plan.', disabled: true },
    { label: 'Settings', content: 'Tweak your preferences.' },
  ];
  return { tabs };
}
