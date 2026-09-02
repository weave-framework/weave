/**
 * `@weave-framework/migrate` — assisted migration into Weave, as a local web service with a UI.
 *
 * The package is deliberately thin at the top: detection, the service and the UI are separate modules, and this
 * file only re-exports the ones a consumer is meant to reach. Nothing here imports `@weave-framework/*` — the
 * migration reads someone else's Angular code and writes text that imports Weave, which is not the same thing as
 * depending on it.
 */

export {
  MAX_DEPTH,
  angularJsonUnits,
  findUnits,
  inspect,
  readSignals,
  unitsAt,
  type DeclaredBy,
  type Signal,
  type Unit,
  type UnitType,
  type Workspace,
} from './detect.js';

export { serve, type MigrateServer, type ServeOptions } from './server.js';
export { browse, type Entry, type Listing } from './browse.js';
