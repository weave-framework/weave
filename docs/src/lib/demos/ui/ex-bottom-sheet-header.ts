import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** A custom `header` node — it wins over the `title` string convenience. */
export function setup(): Setup {
  const open = (): void => {
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; gap:8px;';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:10px; height:10px; border-radius:50%; background:var(--accent, #4f46e5);';
    const label = document.createElement('strong');
    label.textContent = 'Live status';
    header.append(dot, label);

    openBottomSheet({
      // `header` node wins over the `title` below.
      header,
      title: 'ignored when header is set',
      content: 'The custom header node renders instead of the plain title string.',
    });
  };
  return { open };
}
