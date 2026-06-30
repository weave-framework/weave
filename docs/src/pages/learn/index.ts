import { onMount } from '@weave-framework/runtime';
import { navigate } from '@weave-framework/router';

/** `/learn` → redirect to the section's first page. Lets the top-bar "Learn"
 *  link target the section root while still landing on real content. */
export const template = '<p class="redirecting">Redirecting…</p>';

export function setup(): Record<string, never> {
  onMount(() => navigate('/learn/introduction'));
  return {};
}
