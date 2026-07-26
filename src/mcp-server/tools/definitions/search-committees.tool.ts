/**
 * @fileoverview Search committees for a jurisdiction (experimental — not all states have coverage).
 * @module mcp-server/tools/definitions/search-committees
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const CommitteeIncludeEnum = z.enum(['memberships', 'links', 'sources']);

export const searchCommittees = tool('openstates_search_committees', {
  title: 'Search Committees',
  description:
    'List committees for a jurisdiction. jurisdiction is required — a request spanning all 56 jurisdictions exceeds the upstream timeout, so scope every call to a single state; use openstates_list_jurisdictions to pick one. Experimental — Open States is actively working to restore committee support and not all states have data. Use chamber to scope to upper (senate) or lower (house) committees. Use classification=subcommittee to find subcommittees of a parent. Use include=memberships to get the full roster with member roles. The coverageNote field in the output will always note the experimental coverage limitations.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    jurisdiction: z
      .string()
      .optional()
      .describe(
        'State name, abbreviation, or OCD-ID. Required — an all-states request exceeds the upstream timeout, so omitting it is rejected before any request is issued.',
      ),
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
        'Related data to inline. "memberships" includes the full roster with member roles. "links" includes the committee homepage and reference links, and "sources" the provenance URLs behind the record.',
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
            links: z
              .array(
                z
                  .object({
                    url: z.string().describe('Link URL.'),
                    note: z.string().describe('Link description (e.g., "homepage").'),
                  })
                  .describe('External link record.'),
              )
              .optional()
              .describe('Committee homepage and reference links when include=links is requested.'),
            sources: z
              .array(
                z
                  .object({
                    url: z.string().describe('Source URL.'),
                    note: z.string().describe('Source note.'),
                  })
                  .describe('Source record.'),
              )
              .optional()
              .describe('Provenance sources when include=sources is requested.'),
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
    totalCount: z.number().describe('Total committees matching the query across all pages.'),
    page: z.number().describe('Current page returned.'),
    maxPage: z.number().describe('Total pages available.'),
    coverageNote: z
      .string()
      .describe(
        'Committee data is experimental — not all states have coverage in Open States. Empty results may indicate the state lacks data, not that no committees exist.',
      ),
    appliedFilters: z
      .object({
        jurisdiction: z.string().optional().describe('Jurisdiction filter as received.'),
        classification: z.string().optional().describe('Classification filter as received.'),
        chamber: z.string().optional().describe('Chamber filter as received.'),
        parent: z.string().optional().describe('Parent committee filter as received.'),
        page: z.number().describe('Page number requested.'),
        per_page: z.number().describe('Results per page requested.'),
      })
      .describe(
        'Filters applied to this query as the server received them, for agent self-verification of zero or unexpected results.',
      ),
  },
  enrichmentTrailer: {
    appliedFilters: {
      render: (v) => `Filters: ${JSON.stringify(v)}`,
    },
  },
  errors: [
    {
      reason: 'jurisdiction_required',
      code: JsonRpcErrorCode.ValidationError,
      when: 'jurisdiction was omitted — an all-states committee request exceeds the upstream timeout.',
      recovery:
        'Provide a jurisdiction (state name, abbreviation, or OCD-ID); openstates_list_jurisdictions lists every valid value.',
    },
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout — the query is too broad.',
      recovery:
        'Narrow the request: keep the jurisdiction, add chamber or classification, and drop any include values you do not need.',
    },
  ],

  async handler(input, ctx) {
    if (!input.jurisdiction) {
      throw ctx.fail(
        'jurisdiction_required',
        'jurisdiction is required for openstates_search_committees.',
        { ...ctx.recoveryFor('jurisdiction_required') },
      );
    }

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

    ctx.enrich.total(result.pagination.total_items);
    ctx.enrich({
      page: result.pagination.page,
      maxPage: result.pagination.max_page,
      coverageNote:
        'Committee data is experimental — Open States is working to restore support and not all states have coverage. Empty results may indicate the state lacks data, not that no committees exist.',
      appliedFilters: {
        jurisdiction: input.jurisdiction,
        classification: input.classification,
        chamber: input.chamber,
        parent: input.parent,
        page: input.page,
        per_page: input.per_page,
      },
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
      if (committee.links?.length) {
        lines.push(`**Links:** ${committee.links.map((l) => `${l.note}: ${l.url}`).join(', ')}`);
      }
      if (committee.sources?.length) {
        lines.push('**Sources:**');
        for (const s of committee.sources) {
          lines.push(`- ${s.url}${s.note ? ` _(${s.note})_` : ''}`);
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
