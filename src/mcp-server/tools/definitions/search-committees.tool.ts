/**
 * @fileoverview Search committees for a jurisdiction (experimental — not all states have coverage).
 * @module mcp-server/tools/definitions/search-committees
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const CommitteeIncludeEnum = z.enum(['memberships', 'links', 'sources']);

export const searchCommittees = tool('openstates_search_committees', {
  title: 'Search Committees',
  description:
    'List committees for a jurisdiction. Experimental — Open States is actively working to restore committee support and not all states have data. Use chamber to scope to upper (senate) or lower (house) committees. Use classification=subcommittee to find subcommittees of a parent. Use include=memberships to get the full roster with member roles. The coverage_note field in the output will always note the experimental coverage limitations.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    jurisdiction: z
      .string()
      .optional()
      .describe('State name, abbreviation, or OCD-ID. Omitting searches across all states.'),
    classification: z
      .enum(['committee', 'subcommittee'])
      .optional()
      .describe('Filter to parent committees or subcommittees only. Omit for all.'),
    chamber: z
      .enum(['upper', 'lower'])
      .optional()
      .describe('Filter by chamber. "upper" = Senate, "lower" = House/Assembly.'),
    parent: z
      .string()
      .optional()
      .describe('OCD organization ID of a parent committee to retrieve its subcommittees.'),
    include: z
      .array(CommitteeIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "memberships" includes the full roster with member roles.',
      ),
    page: z.coerce.number().int().min(1).default(1).describe('Page number (1-indexed).'),
    per_page: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe('Results per page. Maximum 20.'),
  }),
  output: z.object({
    results: z
      .array(
        z
          .object({
            id: z
              .string()
              .describe('OCD organization ID — use as committee_id in openstates_get_committee.'),
            name: z.string().describe('Committee name.'),
            classification: z
              .string()
              .describe('Committee classification: "committee" or "subcommittee".'),
            parent_id: z
              .string()
              .nullable()
              .describe('OCD ID of parent committee, or null for top-level committees.'),
            memberships: z
              .array(
                z
                  .object({
                    person_id: z.string().describe('OCD person ID of the member.'),
                    person_name: z.string().describe('Member name.'),
                    role: z.string().describe('Member role (e.g., "chair", "member").'),
                  })
                  .describe('Committee membership record.'),
              )
              .optional()
              .describe('Membership roster when include=memberships is requested.'),
          })
          .describe('Committee record.'),
      )
      .describe('Committees matching the search criteria.'),
    pagination: z
      .object({
        page: z.number().describe('Current page.'),
        per_page: z.number().describe('Results per page.'),
        max_page: z.number().describe('Total pages.'),
        total_items: z.number().describe('Total matching committees.'),
      })
      .describe('Pagination metadata.'),
  }),

  enrichment: {
    totalItems: z.number().describe('Total committees matching the query across all pages.'),
    page: z.number().describe('Current page returned.'),
    maxPage: z.number().describe('Total pages available.'),
    coverageNote: z
      .string()
      .describe(
        'Committee data is experimental — not all states have coverage in Open States. Empty results may indicate the state lacks data, not that no committees exist.',
      ),
  },

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    const result = await svc.searchCommittees(
      {
        jurisdiction: input.jurisdiction,
        classification: input.classification,
        chamber: input.chamber,
        parent: input.parent,
        include: input.include && input.include.length > 0 ? input.include : undefined,
        page: input.page,
        per_page: input.per_page,
      },
      ctx,
    );

    ctx.log.info('Searched committees', {
      jurisdiction: input.jurisdiction,
      count: result.results.length,
      total: result.pagination.total_items,
    });

    ctx.enrich({
      totalItems: result.pagination.total_items,
      page: result.pagination.page,
      maxPage: result.pagination.max_page,
      coverageNote:
        'Committee data is experimental — Open States is working to restore support and not all states have coverage. Empty results may indicate the state lacks data, not that no committees exist.',
    });

    return { results: result.results, pagination: result.pagination };
  },

  format: (result) => {
    const lines: string[] = [
      `**${result.pagination.total_items} committees** (page ${result.pagination.page}/${result.pagination.max_page}, per page ${result.pagination.per_page}, showing ${result.results.length})`,
    ];
    for (const committee of result.results) {
      lines.push('');
      lines.push(`## ${committee.name}`);
      lines.push(`**ID:** ${committee.id}`);
      lines.push(`**Classification:** ${committee.classification}`);
      if (committee.parent_id) lines.push(`**Parent ID:** ${committee.parent_id}`);
      if (committee.memberships?.length) {
        lines.push('**Members:**');
        for (const m of committee.memberships) {
          lines.push(`- ${m.person_name} (${m.role}) — ID: ${m.person_id}`);
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
