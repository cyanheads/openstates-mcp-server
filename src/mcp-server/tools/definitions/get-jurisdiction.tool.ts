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
        'Related data to inline. "legislative_sessions" returns all historical and current sessions with identifiers and date ranges. "organizations" lists the jurisdiction\'s legislative chambers and executive bodies. "latest_runs" shows last scraper run metadata.',
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
    organizations: z
      .array(
        z
          .object({
            id: z.string().optional().describe('OCD organization ID.'),
            name: z
              .string()
              .optional()
              .describe('Organization name (e.g., "Washington State Senate").'),
            classification: z
              .string()
              .optional()
              .describe('Organization type (e.g., "upper", "lower", "legislature").'),
          })
          .describe('Organization record.'),
      )
      .optional()
      .describe(
        'Legislative chambers and executive bodies when include=organizations is requested.',
      ),
    latest_runs: z
      .array(
        z
          .object({
            start_time: z.string().describe('ISO 8601 timestamp when the scraper run started.'),
            end_time: z
              .string()
              .optional()
              .describe('ISO 8601 timestamp when the run finished. Absent when unrecorded.'),
            success: z
              .boolean()
              .optional()
              .describe('Whether the run succeeded. Absent when not recorded.'),
          })
          .describe('Scraper run record.'),
      )
      .optional()
      .describe('Recent scraper runs when include=latest_runs is requested.'),
  }),
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'Jurisdiction ID does not exist in Open States.',
      recovery:
        'Use openstates_list_jurisdictions to discover valid jurisdiction IDs. States use the pattern: ocd-jurisdiction/country:us/state:{2-letter-abbr}/government.',
    },
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout.',
      recovery:
        'Retry the lookup once; if it repeats, request fewer include values — legislative_sessions and latest_runs each enlarge the upstream response.',
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
      ...(result.organizations ? { organizations: result.organizations } : {}),
      ...(result.latest_runs ? { latest_runs: result.latest_runs } : {}),
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
        /**
         * Classification and both date endpoints are required non-nullable strings that Open
         * States sends as `""` on sessions it never finished scraping. A missing endpoint means
         * unknown, not open-ended — every observed case is a long-concluded session — so nothing
         * here substitutes "present" for an absent date.
         */
        const cls = s.classification ? ` (${s.classification})` : '';
        const range =
          s.start_date && s.end_date
            ? ` ${s.start_date}–${s.end_date}`
            : s.start_date
              ? ` from ${s.start_date}`
              : s.end_date
                ? ` until ${s.end_date}`
                : '';
        lines.push(`- \`${s.identifier}\` — ${s.name}${cls}${range}`);
      }
    }
    if (result.organizations?.length) {
      lines.push('');
      lines.push('## Organizations');
      for (const o of result.organizations) {
        const cls = o.classification ? ` (${o.classification})` : '';
        const id = o.id ? ` — ${o.id}` : '';
        lines.push(`- ${o.name ?? '(unnamed)'}${cls}${id}`);
      }
    }
    if (result.latest_runs?.length) {
      lines.push('');
      lines.push('## Latest Runs');
      for (const r of result.latest_runs) {
        const end = r.end_time ? ` → ${r.end_time}` : '';
        lines.push(`- ${r.start_time}${end} (success: ${r.success ?? 'n/a'})`);
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
