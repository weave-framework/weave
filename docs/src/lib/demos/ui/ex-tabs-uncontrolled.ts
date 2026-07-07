import Tabs from '@weave-framework/ui/tabs';

// Capitalized tags in the template resolve to this import.
void Tabs;

interface Setup {
  tabs: { label: string; content: string }[];
}

/** Uncontrolled strip: no value — defaultIndex seeds the initial tab, Tabs owns the rest. */
export function setup(): Setup {
  const tabs = [
    { label: 'Overview', content: 'A summary of everything.' },
    { label: 'Activity', content: 'Recent activity shows here.' },
    { label: 'Settings', content: 'Tweak your preferences.' },
  ];
  return { tabs };
}
