import {
  LinkStatusSchema,
  NATIVE_HOST_NAME,
  NativeHostMessageSchema,
  type LinkStatus,
} from '@xc/shared/types';

let port: chrome.runtime.Port | null = null;
let hostError: string | null = null;

async function setStatus(status: LinkStatus): Promise<void> {
  await chrome.storage.session.set({ linkStatus: LinkStatusSchema.parse(status) });
}

async function clearConnection(status: LinkStatus): Promise<void> {
  await chrome.storage.session.remove(['token', 'port']);
  await setStatus(status);
}

async function onHostMessage(message: unknown): Promise<void> {
  const parsed = NativeHostMessageSchema.safeParse(message);
  if (!parsed.success) return;
  if (parsed.data.type === 'error') {
    hostError = parsed.data.message;
    return clearConnection({ state: 'error', message: hostError });
  }
  await chrome.storage.session.set({ token: parsed.data.token, port: parsed.data.port });
  await setStatus({ state: 'online', message: null });
}

function onDisconnect(closed: chrome.runtime.Port): void {
  if (port !== closed) return;
  port = null;
  const reason = chrome.runtime.lastError?.message ?? null;
  const reported = hostError;
  hostError = null;
  void getDesiredOnline().then((wanted) => clearConnection(disconnectStatus(wanted, reported, reason)));
}

// The host's own error explains the exit; the setup hint only fits a silent disconnect.
function disconnectStatus(wanted: boolean, reported: string | null, reason: string | null): LinkStatus {
  if (!wanted) return { state: 'offline', message: null };
  if (reported) return { state: 'error', message: reported };
  if (reason) return { state: 'error', message: `${reason.slice(0, 200)} (did you run pnpm setup:host?)` };
  return { state: 'offline', message: null };
}

export async function getDesiredOnline(): Promise<boolean> {
  const stored = await chrome.storage.local.get('desiredOnline');
  return stored.desiredOnline === true;
}

async function connect(): Promise<void> {
  if (port) return;
  await clearConnection({ state: 'connecting', message: null });
  hostError = null;
  const opened = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  port = opened;
  opened.onMessage.addListener((m) => void onHostMessage(m));
  opened.onDisconnect.addListener(() => onDisconnect(opened));
}

function disconnect(): void {
  port?.disconnect();
  port = null;
}

export async function setDesiredOnline(online: boolean): Promise<void> {
  await chrome.storage.local.set({ desiredOnline: online });
  if (online) return connect();
  disconnect();
  await clearConnection({ state: 'offline', message: null });
}

export async function restoreNativeLink(): Promise<void> {
  if (await getDesiredOnline()) await connect();
  else await setStatus({ state: 'offline', message: null });
}
