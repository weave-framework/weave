/**
 * The stdio transport: newline-delimited JSON-RPC on stdin/stdout — the standard MCP stdio
 * framing (one JSON message per line). Reads requests, dispatches to the {@link McpServer},
 * writes responses. Requests are processed strictly in order (responses never interleave).
 * Node-only.
 */

import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { McpServer } from './server.js';
import type { JsonRpcRequest, JsonRpcResponse } from './jsonrpc.js';

const RPC_PARSE_ERROR: number = -32700;

export interface StdioOptions {
  input?: Readable;
  output?: Writable;
}

/**
 * Run `server` over a newline-delimited JSON-RPC stdio loop. Resolves when the input stream
 * closes. Lines are handled sequentially via a promise chain so responses stay in request order.
 */
export function runStdio(server: McpServer, opts: StdioOptions = {}): Promise<void> {
  const input: Readable = opts.input ?? process.stdin;
  const output: Writable = opts.output ?? process.stdout;
  const rl: Interface = createInterface({ input, crlfDelay: Infinity });

  let chain: Promise<void> = Promise.resolve();
  const write = (obj: unknown): void => void output.write(JSON.stringify(obj) + '\n');

  return new Promise<void>((resolve) => {
    rl.on('line', (line: string) => {
      const trimmed: string = line.trim();
      if (!trimmed) return;
      chain = chain.then(async () => {
        let req: JsonRpcRequest;
        try {
          req = JSON.parse(trimmed) as JsonRpcRequest;
        } catch {
          write({ jsonrpc: '2.0', id: null, error: { code: RPC_PARSE_ERROR, message: 'parse error' } });
          return;
        }
        const res: JsonRpcResponse | null = await server.handle(req);
        if (res) write(res);
      });
    });
    rl.on('close', () => {
      // drain the chain, then resolve
      void chain.then(resolve);
    });
  });
}
