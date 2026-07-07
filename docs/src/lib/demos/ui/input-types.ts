import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to this import.
void Input;

interface Setup {
  email: () => string;
  setEmail: (v: string) => void;
  age: () => string;
  setAge: (v: string) => void;
  tel: () => string;
  setTel: (v: string) => void;
}

/** `type` is forwarded to the native input — email/number/tel get the right keyboard + validation. */
export function setup(): Setup {
  const email = signal('');
  const age = signal('');
  const tel = signal('');
  return {
    email, setEmail: (v) => email.set(v),
    age, setAge: (v) => age.set(v),
    tel, setTel: (v) => tel.set(v),
  };
}
