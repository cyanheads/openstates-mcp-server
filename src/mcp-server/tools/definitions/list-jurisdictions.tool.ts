/**
 * @fileoverview List all jurisdictions covered by Open States.
 * @module mcp-server/tools/definitions/list-jurisdictions
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const JurisdictionIncludeEnum = z.enum(['organizations', 'legislative_sessions', 'latest_runs']);

export const listJurisdictions = tool('openstates_list_jurisdictions', {
  title: 'List Jurisdictions',
  description:
    'List all jurisdictions covered by Open States — all 50 states, DC, and 5 US territories (American Samoa, Guam, Northern Mariana Islands, Puerto Rico, and the US Virgin Islands): 56 in total, returned complete in a single default call. Returns coverage metadata: latest bill update time, latest people update time, and optionally all legislative sessions with their identifiers. Use this when you need to discover valid session identifiers for a state before calling openstates_search_bills with a session filter. The legislative_sessions include option returns all historical and current sessions — always check valid session identifiers here before using them in bill searches, since formats vary widely by state (e.g., "2025", "2025-2026", "2025rs", "2025s1").',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    classification: z
      .enum(['state', 'municipality', 'country'])
      .default('state')
      .describe(
        'Filter by jurisdiction type. Use "state" (default) for all 50 states, DC, and the 5 US territories.',
      ),
    include: z
      .array(JurisdictionIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "legislative_sessions" returns all session identifiers and date ranges — required when you need to discover valid session values for bill searches. "organizations" lists the jurisdiction\'s legislative chambers and executive bodies, and "latest_runs" the recent scraper run history.',
      ),
    page: z.coerce.number().int().min(1).default(1).describe('Page number (1-indexed).'),
    per_page: z.coerce
      .number()
      .int()
      .min(1)
      .max(52)
      .default(52)
      .describe(
        'Results per page (upstream maximum 52). The default call returns the complete state inventory (56) in one response by fetching and merging the pages server-side; set a smaller value only to page manually.',
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
                    start_time: z
                      .string()
                      .describe('ISO 8601 timestamp when the scraper run started.'),
                    end_time: z
                      .string()
                      .optional()
                      .describe(
                        'ISO 8601 timestamp when the run finished. Absent when unrecorded.',
                      ),
                    success: z
                      .boolean()
                      .optional()
                      .describe('Whether the run succeeded. Absent when not recorded.'),
                  })
                  .describe('Scraper run record.'),
              )
              .optional()
              .describe('Recent scraper runs when include=latest_runs is requested.'),
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

  enrichment: {
    totalCount: z.number().describe('Total jurisdictions matching the filter across all pages.'),
    page: z.number().describe('Current page returned.'),
    maxPage: z.number().describe('Total pages available.'),
  },
  errors: [
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout.',
      recovery:
        'Retry once; if it repeats, drop the include values and keep classification="state", which is the smallest inventory request.',
    },
    {
      reason: 'invalid_page',
      code: JsonRpcErrorCode.NotFound,
      when: 'Open States rejected the request as not found — page is past the last page for this classification.',
      recovery:
        'Request a page within the max_page bound returned by a previous call; the error message names the valid range.',
    },
  ],

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    const result = await svc
      .listJurisdictions(
        {
          classification: input.classification,
          include: input.include && input.include.length > 0 ? input.include : undefined,
          page: input.page,
          per_page: input.per_page,
        },
        ctx,
      )
      // The service has already folded the upstream `detail` into the message, so the reason and
      // recovery hint are all that is missing.
      .catch((err: unknown) => {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw ctx.fail('invalid_page', err.message, { ...ctx.recoveryFor('invalid_page') });
        }
        throw err;
      });
    ctx.log.info('Listed jurisdictions', {
      classification: input.classification,
      count: result.results.length,
      total: result.pagination.total_items,
    });
    ctx.enrich.total(result.pagination.total_items);
    ctx.enrich({
      page: result.pagination.page,
      maxPage: result.pagination.max_page,
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
      if (jur.organizations?.length) {
        lines.push('');
        lines.push('**Organizations:**');
        for (const o of jur.organizations) {
          const cls = o.classification ? ` (${o.classification})` : '';
          const id = o.id ? ` — ${o.id}` : '';
          lines.push(`- ${o.name ?? '(unnamed)'}${cls}${id}`);
        }
      }
      if (jur.latest_runs?.length) {
        lines.push('');
        lines.push('**Latest runs:**');
        for (const r of jur.latest_runs) {
          const end = r.end_time ? ` → ${r.end_time}` : '';
          lines.push(`- ${r.start_time}${end} (success: ${r.success ?? 'n/a'})`);
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
