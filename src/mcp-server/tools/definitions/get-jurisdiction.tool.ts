/**
 * @fileoverview Fetch full metadata for a specific Open States jurisdiction.
 * @module mcp-server/tools/definitions/get-jurisdiction
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const JurisdictionIncludeEnum = z.enum(['organizations', 'legislative_sessions', 'latest_runs']);

export const getJurisdiction = tool('openstates_get_jurisdiction', {
  title: 'Get Jurisdiction',
  description:
    'Fetch full metadata for a specific jurisdiction including all legislative sessions, their identifiers, and coverage dates. Use when you need to know the exact session identifier for a state before filtering bill searches — session formats vary widely (e.g., "2025", "2025rs", "2025s1"). Jurisdiction IDs follow OCD format: ocd-jurisdiction/country:us/state:{abbr}/government (e.g., ocd-jurisdiction/country:us/state:wa/government). State names (e.g., "Washington") and two-letter abbreviations (e.g., "wa") are also accepted.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    jurisdiction_id: z
      .string()
      .min(1)
      .describe(
        'OCD jurisdiction ID, state name (e.g., "Washington"), or two-letter abbreviation (e.g., "wa").',
      ),
    include: z
      .array(JurisdictionIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "legislative_sessions" returns all historical and current sessions with identifiers and date ranges. "latest_runs" shows last scraper run metadata.',
      ),
  }),
  output: z.object({
    id: z.string().describe('OCD jurisdiction ID.'),
    name: z.string().describe('Jurisdiction name.'),
    classification: z.string().describe('Jurisdiction type.'),
    url: z.string().describe('Official legislature URL.'),
    latest_bill_update: z.string().describe('ISO 8601 timestamp of most recent bill data update.'),
    latest_people_update: z
      .string()
      .describe('ISO 8601 timestamp of most recent people data update.'),
    legislative_sessions: z
      .array(
        z
          .object({
            identifier: z
              .string()
              .describe('Session identifier — use as session= in bill searches.'),
            name: z.string().describe('Human-readable session name.'),
            classification: z
              .string()
              .describe('Session classification: "primary", "special", etc.'),
            start_date: z.string().describe('Session start date.'),
            end_date: z.string().describe('Session end date.'),
          })
          .describe('Legislative session record.'),
      )
      .optional()
      .describe('All legislative sessions when include=legislative_sessions is requested.'),
  }),
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'Jurisdiction ID does not exist in Open States.',
      recovery:
        'Use openstates_list_jurisdictions to discover valid jurisdiction IDs. States use the pattern: ocd-jurisdiction/country:us/state:{2-letter-abbr}/government.',
    },
  ],

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    const result = await svc
      .getJurisdiction(
        input.jurisdiction_id,
        input.include && input.include.length > 0 ? input.include : undefined,
        ctx,
      )
      .catch((err: unknown) => {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw ctx.fail('not_found', `Jurisdiction not found: ${input.jurisdiction_id}`, {
            ...ctx.recoveryFor('not_found'),
          });
        }
        throw err;
      });
    ctx.log.info('Fetched jurisdiction', { id: result.id, name: result.name });
    return {
      id: result.id,
      name: result.name,
      classification: result.classification,
      url: result.url,
      latest_bill_update: result.latest_bill_update,
      latest_people_update: result.latest_people_update,
      ...(result.legislative_sessions ? { legislative_sessions: result.legislative_sessions } : {}),
    };
  },

  format: (result) => {
    const lines: string[] = [
      `# ${result.name}`,
      `**ID:** ${result.id}`,
      `**Classification:** ${result.classification}`,
      `**URL:** ${result.url}`,
      `**Latest bill update:** ${result.latest_bill_update}`,
      `**Latest people update:** ${result.latest_people_update}`,
    ];
    if (result.legislative_sessions?.length) {
      lines.push('');
      lines.push('## Legislative Sessions');
      for (const s of result.legislative_sessions) {
        lines.push(
          `- \`${s.identifier}\` — ${s.name} (${s.classification}) ${s.start_date}–${s.end_date}`,
        );
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
