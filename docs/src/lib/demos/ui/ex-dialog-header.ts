import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** A custom `header` DOM node (wins over the `title` string convenience). */
export function setup(): Setup {
  const open = (): void => {
    // A rich header: an emoji badge next to a heading.
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; gap:10px; font-weight:600;';
    header.innerHTML = '<span aria-hidden="true">🎉</span><span>You\'re on the list!</span>';

    openDialog({
      header,
      content: 'A `header` node lets you put icons, badges, or layout in the title bar — not just text.',
    });
  };
  return { open };
}
