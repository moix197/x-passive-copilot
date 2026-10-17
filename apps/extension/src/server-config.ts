import { DEFAULT_SERVER_URL } from '@xc/shared/types';

export interface ServerConfig {
  baseUrl: string;
  token: string | null;
}

export async function getServerConfig(): Promise<ServerConfig> {
  const [local, session] = await Promise.all([
    chrome.storage.local.get('serverUrl'),
    chrome.storage.session.get(['token', 'port']),
  ]);
  const fromPort = typeof session.port === 'number' ? `http://127.0.0.1:${session.port}` : DEFAULT_SERVER_URL;
  return {
    baseUrl: typeof local.serverUrl === 'string' ? local.serverUrl : fromPort,
    token: typeof session.token === 'string' ? session.token : null,
  };
}

export function authHeaders(config: ServerConfig): Record<string, string> {
  return config.token ? { authorization: `Bearer ${config.token}` } : {};
}
