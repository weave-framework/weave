import Tabs, { type TabItem } from '@weave-framework/ui/tabs';

// Capitalized tags in the template resolve to this import.
void Tabs;

interface Setup {
  tabs: TabItem[];
}

/**
 * `content` is arbitrary: a plain string, a live DOM `Node`, or a factory `() => Node`
 * built fresh when the panel mounts.
 */
export function setup(): Setup {
  const node = document.createElement('em');
  node.textContent = 'A pre-built DOM node.';

  const tabs: TabItem[] = [
    { label: 'String', content: 'Plain text content.' },
    { label: 'Node', content: node },
    {
      label: 'Factory',
      content: (): Node => {
        const el = document.createElement('button');
        el.type = 'button';
        el.textContent = 'Built by a factory';
        return el;
      },
    },
  ];
  return { tabs };
}
