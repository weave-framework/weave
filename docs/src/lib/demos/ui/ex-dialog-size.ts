import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  openWide: () => void;
  openTall: () => void;
}

/** `width` / `height` set the preferred size — number → px, string passes through. */
export function setup(): Setup {
  const openWide = (): void => {
    openDialog({
      title: 'Wide (860px)',
      content: 'A numeric width is emitted as px. It stays clamped to the viewport on small screens.',
      width: 860,
    });
  };

  const openTall = (): void => {
    // Long body so the fixed height + scrolling content region is visible.
    const body = document.createElement('div');
    body.innerHTML = Array.from({ length: 30 }, (_, i) => `<p>Scrollable line ${i + 1}</p>`).join('');

    openDialog({
      title: 'Tall (60vh)',
      content: body,
      height: '60vh',
    });
  };

  return { openWide, openTall };
}
