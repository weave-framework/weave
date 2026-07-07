import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** `content` can be a factory returning a rich DOM node — not just a plain string. */
export function setup(): Setup {
  const open = (): void => {
    openDialog({
      title: 'Release notes',
      // A factory `() => Node` is evaluated when the dialog opens.
      content: () => {
        const body = document.createElement('div');
        body.innerHTML =
          '<p>Version 2.0 is here:</p>' +
          '<ul style="margin:0; padding-left:1.2em;">' +
          '<li>Signal-native rendering</li>' +
          '<li>Zero dependencies</li>' +
          '<li>Full a11y modal semantics</li>' +
          '</ul>';
        return body;
      },
    });
  };
  return { open };
}
