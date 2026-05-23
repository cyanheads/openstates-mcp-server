/**
 * @fileoverview List all jurisdictions covered by Open States.
 * @module mcp-server/tools/definitions/list-jurisdictions
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const JurisdictionIncludeEnum = z.enum(['organizations', 'legislative_sessions', 'latest_runs']);

export const listJurisdictions = tool('openstates_list_jurisdictions', {
  title: 'List Jurisdictions',
  description:
    'List all jurisdictions covered by Open States — all 50 states, DC, and Puerto Rico. Returns coverage metadata: latest bill update time, latest people update time, and optionally all legislative sessions with their identifiers. Use this when you need to discover valid session identifiers for a state before calling openstates_search_bills with a session filter. The legislative_sessions include option returns all historical and current sessions — always check valid session identifiers here before using them in bill searches, since formats vary widely by state (e.g., "2025", "2025-2026", "2025rs", "2025s1").',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    classification: z
      .enum(['state', 'municipality', 'country'])
      .default('state')
      .describe(
        'Filter by jurisdiction type. Use "state" (default) for all 50 states, DC, and Puerto Rico.',
      ),
    include: z
      .array(JurisdictionIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "legislative_sessions" returns all session identifiers and date ranges — required when you need to discover valid session values for bill searches.',
      ),
    page: z.coerce.number().int().min(1).default(1).describe('Page number (1-indexed).'),
    per_page: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(52)
      .describe(
        'Results per page. Default 52 to cover all states, DC, and Puerto Rico in one request.',
      ),
  }),
  output: z.object({
    results: z
      .array(
        z
          .object({
            id: z
              .string()
              .describe('OCD jurisdiction ID — use as jurisdiction filter in other tools.'),
            name: z.string().describe('Jurisdiction name (e.g., "Washington").'),
            classification: z.string().describe('Jurisdiction type: "state", "municipality", etc.'),
            url: z.string().describe('Official legislature URL.'),
            latest_bill_update: z
              .string()
              .describe('ISO 8601 timestamp of most recent bill data update.'),
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
                    classification: z.string().describe('Session type: "primary", "special", etc.'),
                    start_date: z.string().describe('Session start date.'),
                    end_date: z.string().describe('Session end date.'),
                  })
                  .describe('Legislative session record.'),
              )
              .optional()
              .describe('Legislative sessions when include=legislative_sessions is requested.'),
          })
          .describe('Jurisdiction record.'),
      )
      .describe('Jurisdictions matching the filter.'),
    pagination: z
      .object({
        page: z.number().describe('Current page number.'),
        per_page: z.number().describe('Results per page.'),
        max_page: z.number().describe('Total number of pages.'),
        total_items: z.number().describe('Total matching jurisdictions.'),
      })
      .describe('Pagination metadata.'),
  }),

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    const result = await svc.listJurisdictions(
      {
        classification: input.classification,
        include: input.include && input.include.length > 0 ? input.include : undefined,
        page: input.page,
        per_page: input.per_page,
      },
      ctx,
    );
    ctx.log.info('Listed jurisdictions', {
      classification: input.classification,
      count: result.results.length,
      total: result.pagination.total_items,
    });
    return result;
  },

  format: (result) => {
    const lines: string[] = [
      `**${result.pagination.total_items} jurisdictions** (page ${result.pagination.page}/${result.pagination.max_page}, per page ${result.pagination.per_page})`,
    ];
    for (const jur of result.results) {
      lines.push('');
      lines.push(`## ${jur.name}`);
      lines.push(`**ID:** ${jur.id}`);
      lines.push(`**Classification:** ${jur.classification}`);
      lines.push(`**URL:** ${jur.url}`);
      lines.push(`**Latest bill update:** ${jur.latest_bill_update}`);
      lines.push(`**Latest people update:** ${jur.latest_people_update}`);
      if (jur.legislative_sessions?.length) {
        lines.push('');
        lines.push('**Legislative sessions:**');
        for (const s of jur.legislative_sessions) {
          lines.push(
            `- \`${s.identifier}\` — ${s.name} (${s.classification}) ${s.start_date}–${s.end_date}`,
          );
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
