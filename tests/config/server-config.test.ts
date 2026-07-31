/**
 * @fileoverview Tests for the server config schema — env-var mapping, defaults, and validation
 * of the daily request budget, the per-attempt request timeout, and the total request budget.
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

describe('getServerConfig — totalRequestBudgetMs', () => {
  beforeEach(() => {
    vi.stubEnv('OPENSTATES_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /**
   * Twice the default per-attempt deadline: an attempt that fails just short of its own deadline
   * still leaves a retry nearly a full deadline, while the ladder is capped well short of what
   * four full-deadline attempts plus backoff would cost.
   */
  it('defaults to 90s when the env var is unset', async () => {
    vi.stubEnv('OPENSTATES_TOTAL_REQUEST_BUDGET_MS', undefined);
    expect((await loadConfig()).totalRequestBudgetMs).toBe(90_000);
  });

  it('reads a tighter budget from OPENSTATES_TOTAL_REQUEST_BUDGET_MS', async () => {
    vi.stubEnv('OPENSTATES_REQUEST_TIMEOUT_MS', '20000');
    vi.stubEnv('OPENSTATES_TOTAL_REQUEST_BUDGET_MS', '30000');
    expect((await loadConfig()).totalRequestBudgetMs).toBe(30_000);
  });

  it('rejects a sub-second budget that would fail every request', async () => {
    vi.stubEnv('OPENSTATES_TOTAL_REQUEST_BUDGET_MS', '250');
    await expect(loadConfig()).rejects.toThrow('OPENSTATES_TOTAL_REQUEST_BUDGET_MS');
  });

  it('rejects a non-numeric budget rather than silently falling back to the default', async () => {
    vi.stubEnv('OPENSTATES_TOTAL_REQUEST_BUDGET_MS', 'forever');
    await expect(loadConfig()).rejects.toThrow('OPENSTATES_TOTAL_REQUEST_BUDGET_MS');
  });

  /**
   * A budget under the deadline would abort every attempt before its own deadline could apply,
   * and report it as the whole ladder running out of time — one knob silently overriding the one
   * next to it. Raising only the deadline is the way into it, so the pair is checked at startup.
   */
  it('rejects a budget below the per-attempt deadline', async () => {
    vi.stubEnv('OPENSTATES_REQUEST_TIMEOUT_MS', '120000');
    const err = await loadConfig().catch((e: unknown) => e);
    expect((err as Error).message).toContain('OPENSTATES_TOTAL_REQUEST_BUDGET_MS');
    expect((err as Error).message).toContain('OPENSTATES_REQUEST_TIMEOUT_MS');
  });

  it('accepts a budget equal to the per-attempt deadline', async () => {
    vi.stubEnv('OPENSTATES_REQUEST_TIMEOUT_MS', '45000');
    vi.stubEnv('OPENSTATES_TOTAL_REQUEST_BUDGET_MS', '45000');
    expect((await loadConfig()).totalRequestBudgetMs).toBe(45_000);
  });
});
