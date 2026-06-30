#!/usr/bin/env node
/**
 * Published launcher: run the prebuilt CLI bundle. No runtime bundling, no cache
 * dir, no monorepo-layout assumptions — works wherever @weave-framework/cli is installed.
 */
import { main } from '../dist/cli.js';

await main(process.argv.slice(2));
