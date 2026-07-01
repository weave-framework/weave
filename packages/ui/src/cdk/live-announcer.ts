/**
 * Live announcer — push messages to assistive technology via an `aria-live` region
 * (e.g. "3 results", "Copied", "Row selected"). One shared visually-hidden region per
 * politeness level, created lazily and appended to `<body>`. Zero-dep.
 *
 * Identical consecutive messages are re-announced by clearing the region first (SRs
 * ignore a no-op text set). `off` is a no-op.
 */

import { isBrowser } from './platform.js';

export type AriaLivePoliteness = 'off' | 'polite' | 'assertive';

const regions: Partial<Record<'polite' | 'assertive', HTMLElement>> = {};

function region(politeness: 'polite' | 'assertive'): HTMLElement {
  let el: HTMLElement | undefined = regions[politeness];
  if (el && el.isConnected) return el;
  el = document.createElement('div');
  el.className = 'weave-live-announcer';
  el.setAttribute('aria-live', politeness);
  el.setAttribute('aria-atomic', 'true');
  el.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
  // Visually hidden but present to the accessibility tree (the standard sr-only recipe).
  el.style.cssText =
    'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
  document.body.appendChild(el);
  regions[politeness] = el;
  return el;
}

/**
 * Announce `message` to screen readers. `polite` waits for a pause (default),
 * `assertive` interrupts. Returns immediately.
 */
export function announce(message: string, politeness: AriaLivePoliteness = 'polite'): void {
  if (!isBrowser || politeness === 'off') return;
  const el: HTMLElement = region(politeness);
  el.textContent = ''; // force a change so identical consecutive messages re-fire
  el.textContent = message;
}

/** Clear all live regions. */
export function clearAnnouncer(): void {
  for (const el of Object.values(regions)) if (el) el.textContent = '';
}

/** The live region element for a politeness level (creating it if needed). Mostly for tests. */
export function liveAnnouncerElement(politeness: 'polite' | 'assertive' = 'polite'): HTMLElement {
  return region(politeness);
}
