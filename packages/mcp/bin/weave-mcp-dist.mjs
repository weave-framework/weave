#!/usr/bin/env node
/**
 * PUBLISHED bin: a thin launcher over the prebuilt dist/index.js — starts the Weave MCP
 * server over stdio. Selected via package.json `publishConfig.bin`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'));

const { runStdioServer } = await import('../dist/index.js');
await runStdioServer({ version: pkg.version });
