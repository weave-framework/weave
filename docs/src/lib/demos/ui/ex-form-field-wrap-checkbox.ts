import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Checkbox from '@weave-framework/ui/checkbox';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Checkbox;

interface Setup {
  agree: () => boolean;
  setAgree: (v: boolean) => void;
}

/** A Checkbox in the frame: the group `label` sits above, the checkbox's own label names the box. */
export function setup(): Setup {
  const agree = signal(false);
  return { agree, setAgree: (v) => agree.set(v) };
}
