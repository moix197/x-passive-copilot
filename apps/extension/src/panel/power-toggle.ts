import { LinkControlMessageSchema, LinkStatusSchema, type LinkStatus } from '@xc/shared/types';

const LABELS: Record<LinkStatus['state'], string> = {
  offline: 'Offline - not capturing',
  connecting: 'Connecting...',
  online: 'Online',
  error: 'Error',
};

export function statusText(status: LinkStatus): string {
  return status.message ? `${LABELS[status.state]}: ${status.message}` : LABELS[status.state];
}

async function readStatus(): Promise<LinkStatus> {
  const stored = await chrome.storage.session.get('linkStatus');
  const parsed = LinkStatusSchema.safeParse(stored.linkStatus);
  return parsed.success ? parsed.data : { state: 'offline', message: null };
}

export function mountPowerToggle(
  toggle: HTMLInputElement,
  label: HTMLElement,
  onStatus: (status: LinkStatus) => void,
): void {
  const apply = (status: LinkStatus) => {
    toggle.checked = status.state === 'online' || status.state === 'connecting';
    label.textContent = statusText(status);
    label.dataset.state = status.state;
    onStatus(status);
  };
  toggle.addEventListener('change', () => {
    const message = LinkControlMessageSchema.parse({ type: 'set-online', online: toggle.checked });
    void chrome.runtime.sendMessage(message);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.linkStatus) void readStatus().then(apply);
  });
  void readStatus().then(apply);
}
