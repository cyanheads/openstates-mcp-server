/**
 * @fileoverview Tests for the server config schema — env-var mapping, defaults, and validation
 * of the daily request budget and the per-attempt request timeout.
 * @module tests/config/server-config.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `getServerConfig` memoizes into a module-level singleton, so each case resets the module
 * registry and re-imports to read a fresh environment.
 */
async function loadConfig() {
  vi.resetModules();
  const { getServerConfig } = await import('@/config/server-config.js');
  return getServerConfig();
}

describe('getServerConfig — dailyRequestBudget', () => {
  beforeEach(() => {
    vi.stubEnv('OPENSTATES_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to the documented free-tier daily cap when the env var is unset', async () => {
    vi.stubEnv('OPENSTATES_DAILY_REQUEST_BUDGET', undefined);
    expect((await loadConfig()).dailyRequestBudget).toBe(250);
  });

  it('reads a higher budget from OPENSTATES_DAILY_REQUEST_BUDGET', async () => {
    vi.stubEnv('OPENSTATES_DAILY_REQUEST_BUDGET', '5000');
    expect((await loadConfig()).dailyRequestBudget).toBe(5000);
  });

  it('rejects a non-positive budget by naming the env var, not the schema path', async () => {
    vi.stubEnv('OPENSTATES_DAILY_REQUEST_BUDGET', '0');
    await expect(loadConfig()).rejects.toThrow('OPENSTATES_DAILY_REQUEST_BUDGET');
  });

  it('rejects a non-numeric budget rather than silently falling back to the default', async () => {
    vi.stubEnv('OPENSTATES_DAILY_REQUEST_BUDGET', 'unlimited');
    await expect(loadConfig()).rejects.toThrow('OPENSTATES_DAILY_REQUEST_BUDGET');
  });
});

describe('getServerConfig — requestTimeoutMs', () => {
  beforeEach(() => {
    vi.stubEnv('OPENSTATES_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to a ceiling under the upstream gateway window when the env var is unset', async () => {
    vi.stubEnv('OPENSTATES_REQUEST_TIMEOUT_MS', undefined);
    expect((await loadConfig()).requestTimeoutMs).toBe(45_000);
  });

  it('reads a longer deadline from OPENSTATES_REQUEST_TIMEOUT_MS', async () => {
    vi.stubEnv('OPENSTATES_REQUEST_TIMEOUT_MS', '90000');
    expect((await loadConfig()).requestTimeoutMs).toBe(90_000);
  });

  it('rejects a sub-second deadline that would fail every request', async () => {
    vi.stubEnv('OPENSTATES_REQUEST_TIMEOUT_MS', '250');
    await expect(loadConfig()).rejects.toThrow('OPENSTATES_REQUEST_TIMEOUT_MS');
  });

  it('rejects a non-numeric deadline rather than silently falling back to the default', async () => {
    vi.stubEnv('OPENSTATES_REQUEST_TIMEOUT_MS', 'forever');
    await expect(loadConfig()).rejects.toThrow('OPENSTATES_REQUEST_TIMEOUT_MS');
  });
});
