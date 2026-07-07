import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** `content` as a factory `() => Node` — built lazily when the sheet opens. */
export function setup(): Setup {
  const open = (): void => {
    openBottomSheet({
      title: 'Choose an action',
      // A factory returning a DOM node — evaluated at open time.
      content: (): Node => {
        const list = document.createElement('div');
        list.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
        for (const name of ['Copy link', 'Send email', 'Export file']) {
          const item = document.createElement('button');
          item.type = 'button';
          item.textContent = name;
          item.className = 'weave-button weave-button--outline';
          item.style.justifyContent = 'flex-start';
          list.append(item);
        }
        return list;
      },
    });
  };
  return { open };
}
