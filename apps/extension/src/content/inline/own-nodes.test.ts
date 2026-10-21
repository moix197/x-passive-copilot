// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findHost, HOST_TAG, isOwnInsertion, removeStaleHosts } from './own-nodes';

const record = (added: Node[], removed: Node[] = []) =>
  ({ addedNodes: added, removedNodes: removed }) as unknown as MutationRecord;

describe('isOwnInsertion', () => {
  it('is true only when every added node is our host and nothing was removed', () => {
    const host = document.createElement(HOST_TAG);
    const other = document.createElement('div');
    expect(isOwnInsertion(record([host]))).toBe(true);
    expect(isOwnInsertion(record([host, other]))).toBe(false);
    expect(isOwnInsertion(record([]))).toBe(false);
    expect(isOwnInsertion(record([], [host]))).toBe(false);
    expect(isOwnInsertion(record([host], [other]))).toBe(false);
  });
});

describe('findHost and removeStaleHosts', () => {
  it('finds only a live host (with a shadow root) and drops copies left by a cloned article', () => {
    const article = document.createElement('article');
    const live = document.createElement(HOST_TAG);
    live.attachShadow({ mode: 'open' });
    const clone = document.createElement(HOST_TAG);
    article.append(clone);
    expect(findHost(article)).toBeNull();
    article.append(live);
    expect(findHost(article)).toBe(live);
    removeStaleHosts(article, live);
    expect(Array.from(article.children)).toEqual([live]);
  });
});
