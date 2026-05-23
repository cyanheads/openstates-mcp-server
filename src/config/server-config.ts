/**
 * @fileoverview Server-specific configuration for openstates-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  apiKey: z.string().min(1).describe('Open States API key from open.pluralpolicy.com'),
  apiBaseUrl: z.string().default('https://v3.openstates.org').describe('Open States API base URL'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    apiKey: 'OPENSTATES_API_KEY',
    apiBaseUrl: 'OPENSTATES_API_BASE_URL',
  });
  return _config;
}
