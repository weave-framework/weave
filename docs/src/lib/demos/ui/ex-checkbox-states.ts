import { signal } from '@weave-framework/runtime';
import Checkbox from '@weave-framework/ui/checkbox';

// Capitalized tags in the template resolve to this import.
void Checkbox;

interface Setup {
  offOn: () => boolean;
  onOn: () => boolean;
  req: () => boolean;
  setReq: (v: boolean) => void;
}

/** The native states: `disabled` (off and on) and `required`. */
export function setup(): Setup {
  const offOn = signal(false);
  const onOn = signal(true);
  const req = signal(false);
  return {
    offOn,
    onOn,
    req,
    setReq: (v) => req.set(v),
  };
}
