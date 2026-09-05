import { BASIC_CREDENTIAL_CACHE_MAX_ENTRIES, BASIC_CREDENTIAL_CACHE_TTL_MS, BasicCredentialCache } from './basic-credential-cache';

const REALM = 'bookorbit OPDS';

describe('BasicCredentialCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the stored ids only for the exact realm, username, and password', () => {
    const cache = new BasicCredentialCache();
    cache.set(REALM, 'reader', 'secret', { accountId: 10, userId: 1 });

    expect(cache.get(REALM, 'reader', 'secret')).toEqual({ accountId: 10, userId: 1 });
    expect(cache.get(REALM, 'reader', 'Secret')).toBeNull();
    expect(cache.get(REALM, 'other', 'secret')).toBeNull();
    expect(cache.get('bookorbit Komga', 'reader', 'secret')).toBeNull();
  });

  it('forgets a credential once its time to live has passed', () => {
    const cache = new BasicCredentialCache();
    cache.set(REALM, 'reader', 'secret', { accountId: 10, userId: 1 });

    vi.advanceTimersByTime(BASIC_CREDENTIAL_CACHE_TTL_MS - 1);
    expect(cache.get(REALM, 'reader', 'secret')).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(cache.get(REALM, 'reader', 'secret')).toBeNull();
  });

  it('does not extend the time to live when a credential is read', () => {
    const cache = new BasicCredentialCache();
    cache.set(REALM, 'reader', 'secret', { accountId: 10, userId: 1 });

    vi.advanceTimersByTime(BASIC_CREDENTIAL_CACHE_TTL_MS - 1);
    cache.get(REALM, 'reader', 'secret');
    vi.advanceTimersByTime(1);

    expect(cache.get(REALM, 'reader', 'secret')).toBeNull();
  });

  it('evicts the least recently used credential when full', () => {
    const cache = new BasicCredentialCache();
    for (let index = 0; index < BASIC_CREDENTIAL_CACHE_MAX_ENTRIES; index++) {
      cache.set(REALM, `user-${index}`, 'secret', { accountId: index, userId: index });
    }

    expect(cache.get(REALM, 'user-0', 'secret')).not.toBeNull();
    cache.set(REALM, 'newcomer', 'secret', { accountId: 9_999, userId: 9_999 });

    expect(cache.get(REALM, 'user-0', 'secret')).not.toBeNull();
    expect(cache.get(REALM, 'user-1', 'secret')).toBeNull();
    expect(cache.get(REALM, 'newcomer', 'secret')).not.toBeNull();
  });

  it('drops every credential of an invalidated account within its realm', () => {
    const cache = new BasicCredentialCache();
    cache.set(REALM, 'reader', 'secret', { accountId: 10, userId: 1 });
    cache.set(REALM, 'reader', 'secret-with-colon:', { accountId: 10, userId: 1 });
    cache.set(REALM, 'sibling', 'secret', { accountId: 11, userId: 1 });
    cache.set('bookorbit Komga', 'reader', 'secret', { accountId: 10, userId: 1 });

    cache.invalidateAccount(REALM, 10);

    expect(cache.get(REALM, 'reader', 'secret')).toBeNull();
    expect(cache.get(REALM, 'reader', 'secret-with-colon:')).toBeNull();
    expect(cache.get(REALM, 'sibling', 'secret')).toEqual({ accountId: 11, userId: 1 });
    expect(cache.get('bookorbit Komga', 'reader', 'secret')).toEqual({ accountId: 10, userId: 1 });
  });

  it('replaces the stored ids when the same credential is set again', () => {
    const cache = new BasicCredentialCache();
    cache.set(REALM, 'reader', 'secret', { accountId: 10, userId: 1 });
    cache.set(REALM, 'reader', 'secret', { accountId: 12, userId: 3 });

    expect(cache.get(REALM, 'reader', 'secret')).toEqual({ accountId: 12, userId: 3 });
  });
});
