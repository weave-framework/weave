/**
 * `@weave-framework/ui/cdk` — the headless behavior layer under the styled Weave UI
 * components (the equivalent of Angular's CDK). Every primitive here is headless
 * (behavior + state, zero styling), signal-native, and zero third-party deps —
 * in-house positioning, overlay stacking, scroll strategies, focus management,
 * a11y key-managers, and observer→signal wrappers.
 *
 * U1 (foundations) ships Platform + Bidi; this barrel grows as each primitive lands.
 */

export * from './platform.js';
export * from './bidi.js';
export * from './portal.js';
export * from './overlay.js';
export * from './positioning.js';
export * from './scroll.js';
export * from './interactivity.js';
export * from './focus-trap.js';
export * from './focus-monitor.js';
export * from './live-announcer.js';
export * from './key-manager.js';
export * from './observers.js';
export * from './breakpoints.js';
export * from './clipboard.js';
export * from './selection-model.js';
export * from './data-source.js';
export * from './virtual-scroll.js';
export * from './drag-drop.js';
export * from './date-adapter.js';
