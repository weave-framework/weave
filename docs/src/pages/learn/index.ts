import { onMount } from '@weave/runtime';
import { navigate } from '@weave/router';

/** `/learn` → redirect to the section's first page. Lets the top-bar "Learn"
 *  link target the section root while still landing on real content. */
export const template = '<p class="redirecting">Redirecting…</p>';

export function setup(): Record<string, never> {
  onMount(() => navigate('/learn/introduction'));
  return {};
}
