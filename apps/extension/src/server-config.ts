import { DEFAULT_SERVER_URL } from '@xc/shared/types';

export interface ServerConfig {
  baseUrl: string;
  token: string | null;
}

export async function getServerConfig(): Promise<ServerConfig> {
  const stored = await chrome.storage.local.get(['serverUrl', 'token']);
  return {
    baseUrl: typeof stored.serverUrl === 'string' ? stored.serverUrl : DEFAULT_SERVER_URL,
    token: typeof stored.token === 'string' ? stored.token : null,
  };
}

export function authHeaders(config: ServerConfig): Record<string, string> {
  return config.token ? { authorization: `Bearer ${config.token}` } : {};
}
