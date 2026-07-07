import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** Tall content: the sheet never exceeds the viewport — the content region scrolls. */
export function setup(): Setup {
  const open = (): void => {
    const body = document.createElement('div');
    body.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
    for (let i = 1; i <= 30; i++) {
      const row = document.createElement('p');
      row.style.margin = '0';
      row.textContent = `Line ${i} — the panel is capped at the viewport height, so this list scrolls inside the content region.`;
      body.append(row);
    }
    openBottomSheet({
      title: 'Terms',
      content: body,
    });
  };
  return { open };
}
