import { onMount } from '@weave/runtime';
import { navigate } from '@weave/router';

/** `/reference` → redirect to the section's first page. */
export const template = '<p class="redirecting">Redirecting…</p>';

export function setup(): Record<string, never> {
  onMount(() => navigate('/reference/runtime'));
  return {};
}
