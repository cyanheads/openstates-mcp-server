/**
 * @fileoverview Server-specific configuration for openstates-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

/**
 * Documented Open States v3 free-tier ceiling (~10 req/min, 250 req/day). The daily figure is the
 * binding constraint on the hosted deployment, where every caller shares one key, so it is the
 * default budget; a self-hosted install on a higher tier raises it via the env var.
 */
const FREE_TIER_DAILY_BUDGET = 250;

/**
 * Per-attempt upstream deadline. Sized to keep the decision to give up on this side of the wire:
 * Open States answers a scoped query anywhere from under a second to ~57s, and its gateway gives
 * up at ~60s, so a ceiling below that still bounds the wait while clearing the slow-but-successful
 * range. The deadline is non-retryable, so a doomed request costs one wait rather than four.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

/**
 * Floor for the configured deadline. Every observed upstream response takes longer than a second,
 * so a sub-second ceiling would reject every request; rejecting the value at startup beats
 * discovering it one failed call at a time.
 */
const MIN_REQUEST_TIMEOUT_MS = 1_000;

const ServerConfigSchema = z.object({
  apiKey: z.string().min(1).describe('Open States API key from open.pluralpolicy.com'),
  apiBaseUrl: z.string().default('https://v3.openstates.org').describe('Open States API base URL'),
  dailyRequestBudget: z.coerce
    .number()
    .int()
    .min(1)
    .default(FREE_TIER_DAILY_BUDGET)
    .describe('Maximum upstream Open States requests per rolling 24 hours'),
  requestTimeoutMs: z.coerce
    .number()
    .int()
    .min(MIN_REQUEST_TIMEOUT_MS)
    .default(DEFAULT_REQUEST_TIMEOUT_MS)
    .describe('Per-attempt upstream request deadline in milliseconds'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    apiKey: 'OPENSTATES_API_KEY',
    apiBaseUrl: 'OPENSTATES_API_BASE_URL',
    dailyRequestBudget: 'OPENSTATES_DAILY_REQUEST_BUDGET',
    requestTimeoutMs: 'OPENSTATES_REQUEST_TIMEOUT_MS',
  });
  return _config;
}
