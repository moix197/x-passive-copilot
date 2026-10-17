import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type HealthResponse } from '@xc/shared';

interface CliOptions {
  dev: boolean;
  port: number;
  home: string;
}

function parseArgs(argv: string[]): CliOptions {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    dev: argv.includes('--dev'),
    port: Number(value('--port') ?? 7457),
    home: value('--home') ?? join(homedir(), '.x-passive-copilot'),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/v1/health') {
    const body: HealthResponse = { status: 'ok' };
    return sendJson(res, 200, body);
  }
  sendJson(res, 404, { error: 'not found' });
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const config = loadConfig(opts.home);
  if (!config.ok) {
    console.error(config.error);
    process.exit(1);
  }
  createServer(handle).listen(opts.port, '127.0.0.1', () => {
    console.log(`server listening on 127.0.0.1:${opts.port}${opts.dev ? ' (dev)' : ''}`);
  });
}

main();
