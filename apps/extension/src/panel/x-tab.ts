/** True when `tabUrl` shows the post itself (also its photo/analytics sub-pages), whatever the handle's case. */
export function isPostTabUrl(tabUrl: string | undefined, statusId: string): boolean {
  if (!tabUrl) return false;
  const pattern = new RegExp(`^https://x\\.com/[A-Za-z0-9_]{1,15}/status/${statusId}(?:[/?#]|$)`);
  return pattern.test(tabUrl);
}

async function findPostTab(statusId: string): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: `https://x.com/*/status/${statusId}*` });
  return tabs.find((tab) => isPostTabUrl(tab.url, statusId));
}

/** Focuses a tab already showing the post, else opens it in a new tab. */
export async function focusOrOpenPostTab(statusId: string, url: string): Promise<void> {
  const existing = await findPostTab(statusId);
  if (existing?.id === undefined) {
    await chrome.tabs.create({ url, active: true });
    return;
  }
  await chrome.tabs.update(existing.id, { active: true });
  await chrome.windows.update(existing.windowId, { focused: true });
}
