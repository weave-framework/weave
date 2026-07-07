import { signal } from '@weave-framework/runtime';
import Checkbox from '@weave-framework/ui/checkbox';

// Capitalized tags in the template resolve to this import.
void Checkbox;

interface Setup {
  subscribe: () => boolean;
  setSubscribe: (v: boolean) => void;
}

/** `name` sets the native form-submission name; `class` forwards extra classes onto the `<label>` root. */
export function setup(): Setup {
  const subscribe = signal(true);
  return { subscribe, setSubscribe: (v) => subscribe.set(v) };
}
