/**
 * @fileoverview Guards the partial-mock contract every tool and resource test file depends on:
 * the service accessor is stubbed while the module's remaining exports stay real. A wholesale
 * `vi.mock` factory replaces the module outright, so any second export it names lands as
 * `undefined` and throws at call time with a `TypeError` that blames the symbol, not the mock.
 * @module tests/services/openstates-service.mock-contract.test
 */

import { describe, expect, it, vi } from 'vitest';
import {
  cacheKeyForUrl,
  getOpenStatesApiService,
} from '@/services/openstates/openstates-service.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
  getOpenStatesApiService: vi.fn(),
}));

describe('openstates-service partial mock', () => {
  it('stubs the accessor the definitions call', () => {
    expect(vi.isMockFunction(getOpenStatesApiService)).toBe(true);
  });

  it('leaves the other module exports reachable and real', async () => {
    expect(vi.isMockFunction(cacheKeyForUrl)).toBe(false);
    await expect(
      cacheKeyForUrl('https://v3.openstates.org/bills?jurisdiction=wa'),
    ).resolves.toMatch(/^openstates_cache_[0-9a-f]{64}$/);
  });
});
