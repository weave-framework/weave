import Expansion from '@weave-framework/ui/expansion';

// Capitalized tags in the template resolve to this import.
void Expansion;

interface Setup {
  panels: { id: string; header: string; body: () => Node }[];
}

/** A panel `body` can be a factory returning any DOM node — not just a string. */
export function setup(): Setup {
  const list = (): Node => {
    const ul = document.createElement('ul');
    ul.style.margin = '0';
    ul.style.paddingInlineStart = '18px';
    for (const item of ['Signals', 'Templates', 'Zero deps']) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.append(li);
    }
    return ul;
  };
  const panels = [
    { id: 'features', header: 'Features', body: list },
    { id: 'links', header: 'Links', body: (): Node => {
      const a = document.createElement('a');
      a.href = '/ui/expansion';
      a.textContent = 'Expansion reference →';
      return a;
    } },
  ];
  return { panels };
}
