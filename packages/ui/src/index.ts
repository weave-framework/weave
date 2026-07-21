/**
 * @weave-framework/ui — Weave UI component library (Weave design system).
 *
 * The SCSS token engine + styles live under `src/styles` and per-component `.scss`
 * (consumed via `@use '@weave-framework/ui'`). JS component behaviors are exported
 * from their subpaths (e.g. `@weave-framework/ui/ripple`) as they land.
 *
 * U0 (foundations) ships the token engine + Divider/Icon/Ripple. This barrel will
 * re-export the JS component behaviors as U2+ adds them.
 *
 * App-wide picker defaults live here rather than on a component subpath: they are provided **once**
 * at the app root, by an app that then imports the pickers from their own subpaths (FW-19).
 */
export {
  provideDateTimeDefaults,
  type DateTimeDefaults,
  type DatepickerLabelDefaults,
  type TimepickerDefaults,
  type Defaulted,
} from './date-time-defaults.js';
