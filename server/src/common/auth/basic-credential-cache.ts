import { createHash } from 'crypto';

import { Injectable } from '@nestjs/common';

export interface BasicCredentialCacheEntry {
  accountId: number;
  userId: number;
}

interface CachedCredential extends BasicCredentialCacheEntry {
  realm: string;
  expiresAt: number;
}

export const BASIC_CREDENTIAL_CACHE_TTL_MS = 5 * 60 * 1000;
export const BASIC_CREDENTIAL_CACHE_MAX_ENTRIES = 1_000;

function credentialKey(realm: string, username: string, password: string): string {
  return createHash('sha256').update(`${realm}:${username}:${password}`).digest('hex');
}

@Injectable()
export class BasicCredentialCache {
  private readonly entries = new Map<string, CachedCredential>();

  get(realm: string, username: string, password: string): BasicCredentialCacheEntry | null {
    const key = credentialKey(realm, username, password);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { accountId: entry.accountId, userId: entry.userId };
  }

  set(realm: string, username: string, password: string, entry: BasicCredentialCacheEntry): void {
    const key = credentialKey(realm, username, password);
    this.entries.delete(key);
    this.entries.set(key, { ...entry, realm, expiresAt: Date.now() + BASIC_CREDENTIAL_CACHE_TTL_MS });
    while (this.entries.size > BASIC_CREDENTIAL_CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  invalidateAccount(realm: string, accountId: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.realm === realm && entry.accountId === accountId) this.entries.delete(key);
    }
  }
}
