/**
 * @fileoverview Search state legislative bills across all covered US jurisdictions.
 * @module mcp-server/tools/definitions/search-bills
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const BillIncludeEnum = z.enum([
  'sponsorships',
  'abstracts',
  'other_titles',
  'other_identifiers',
  'actions',
  'sources',
  'documents',
  'versions',
  'votes',
  'related_bills',
]);

const BillSortEnum = z.enum([
  'updated_asc',
  'updated_desc',
  'first_action_asc',
  'first_action_desc',
  'latest_action_asc',
  'latest_action_desc',
]);

export const searchBills = tool('openstates_search_bills', {
  title: 'Search Bills',
  description:
    'Search state legislative bills across all covered US jurisdictions. Supports full-text search, jurisdiction/session filtering, subject tags, sponsor lookups, and sort order. Either jurisdiction or q (full-text) is required — combining both narrows results. include=sponsorships,actions returns sponsor and action history inline. sort=latest_action_desc surfaces bills currently moving. openstates_get_jurisdiction with include=legislative_sessions returns valid session identifiers for session filtering.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    jurisdiction: z
      .string()
      .optional()
      .describe(
        'State name, two-letter abbreviation, or OCD-ID (e.g., "Washington", "wa", or "ocd-jurisdiction/country:us/state:wa/government"). Required unless q is provided.',
      ),
    q: z
      .string()
      .optional()
      .describe(
        'Full-text search across bill titles, abstracts, and text. Required unless jurisdiction is provided. Combining with jurisdiction is recommended for precision.',
      ),
    session: z
      .string()
      .optional()
      .describe(
        'Session identifier (e.g., "2025", "2025-2026", "2025rs"). Use openstates_get_jurisdiction with include=legislative_sessions to discover valid values. Omit to search across all sessions.',
      ),
    chamber: z
      .enum(['upper', 'lower'])
      .optional()
      .describe('Filter by originating chamber. "upper" = Senate, "lower" = House/Assembly.'),
    classification: z
      .string()
      .optional()
      .describe('Bill classification: "bill", "resolution", "constitutional amendment", etc.'),
    subject: z
      .array(z.string())
      .optional()
      .describe('Filter to bills tagged with one or more subject categories.'),
    sponsor: z.string().optional().describe('Filter by sponsor name or OCD person ID.'),
    sponsor_classification: z
      .string()
      .optional()
      .describe('Filter sponsor type: "primary", "cosponsor".'),
    sort: BillSortEnum.default('updated_desc').describe(
      'Sort order. Use "latest_action_desc" for bills currently moving through the legislature.',
    ),
    action_since: z
      .string()
      .optional()
      .describe('ISO 8601 date — only return bills with an action after this date.'),
    updated_since: z
      .string()
      .optional()
      .describe('ISO 8601 date — only return bills updated after this date.'),
    include: z
      .array(BillIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "sponsorships" and "actions" cover most research needs without a separate openstates_get_bill call. "votes" adds full vote tallies and per-legislator positions.',
      ),
    page: z.coerce.number().int().min(1).default(1).describe('Page number (1-indexed).'),
    per_page: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe('Results per page. Maximum 20. Default 10.'),
  }),
  output: z.object({
    results: z
      .array(
        z
          .object({
            id: z.string().describe('OCD bill ID — use as openstates_id in openstates_get_bill.'),
            identifier: z
              .string()
              .describe('Bill identifier as used by the legislature (e.g., "HB 1000").'),
            title: z.string().describe('Bill title.'),
            session: z.string().describe('Legislative session identifier.'),
            jurisdiction: z
              .object({
                id: z.string().describe('OCD jurisdiction ID.'),
                name: z.string().describe('Jurisdiction name.'),
              })
              .describe('Originating jurisdiction.'),
            from_organization: z
              .object({
                name: z.string().describe('Chamber name.'),
                classification: z
                  .string()
                  .describe('Chamber classification (e.g., "lower", "upper").'),
              })
              .describe('Originating chamber.'),
            classification: z.array(z.string()).describe('Bill classifications.'),
            subject: z.array(z.string()).describe('Subject tags assigned by Open States scrapers.'),
            first_action_date: z.string().nullable().describe('Date of first recorded action.'),
            latest_action_date: z.string().nullable().describe('Date of most recent action.'),
            latest_action_description: z
              .string()
              .nullable()
              .describe('Description of most recent action.'),
            latest_passage_date: z
              .string()
              .nullable()
              .describe('Date bill passed (when applicable).'),
            sponsorships: z
              .array(
                z
                  .object({
                    name: z.string().describe('Sponsor name.'),
                    entity_type: z.string().describe('Entity type: "person", "organization".'),
                    primary: z.boolean().describe('Whether this is the primary sponsor.'),
                    classification: z.string().describe('Sponsorship type.'),
                  })
                  .describe('Sponsorship record.'),
              )
              .optional()
              .describe('Sponsorships when include=sponsorships is requested.'),
            actions: z
              .array(
                z
                  .object({
                    description: z.string().describe('Action description.'),
                    date: z.string().describe('Action date.'),
                    classification: z.array(z.string()).describe('Action classifications.'),
                    order: z.number().describe('Action sequence order.'),
                    organization: z
                      .object({
                        name: z.string().describe('Organization name.'),
                        classification: z.string().describe('Organization classification.'),
                      })
                      .describe('Chamber or committee where action occurred.'),
                  })
                  .describe('Action record.'),
              )
              .optional()
              .describe('Action history when include=actions is requested.'),
            abstracts: z
              .array(
                z
                  .object({
                    abstract: z.string().describe('Plain-language bill summary.'),
                    note: z.string().describe('Source note.'),
                  })
                  .describe('Abstract record.'),
              )
              .optional()
              .describe('Bill abstracts when include=abstracts is requested.'),
          })
          .describe('Bill record.'),
      )
      .describe('Bills matching the search criteria.'),
    pagination: z
      .object({
        page: z.number().describe('Current page.'),
        per_page: z.number().describe('Results per page.'),
        max_page: z.number().describe('Total pages available.'),
        total_items: z.number().describe('Total matching bills.'),
      })
      .describe('Pagination metadata.'),
    message: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty — echoes the filters applied and suggests how to broaden. Absent when results are returned.',
      ),
  }),
  errors: [
    {
      reason: 'missing_scope',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Neither jurisdiction nor q (full-text search) was provided.',
      recovery:
        'Provide a jurisdiction (state name or OCD-ID) or a full-text search term via q, or both.',
    },
    {
      reason: 'invalid_session',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Session identifier was not recognized by the Open States API.',
      recovery:
        'Use openstates_get_jurisdiction with include=legislative_sessions to list valid session identifiers for this jurisdiction.',
    },
  ],

  async handler(input, ctx) {
    if (!input.jurisdiction && !input.q) {
      throw ctx.fail('missing_scope', 'Either jurisdiction or q is required.', {
        ...ctx.recoveryFor('missing_scope'),
      });
    }

    const svc = getOpenStatesApiService();
    const result = await svc.searchBills(
      {
        jurisdiction: input.jurisdiction,
        q: input.q,
        session: input.session,
        chamber: input.chamber,
        classification: input.classification,
        subject: input.subject && input.subject.length > 0 ? input.subject : undefined,
        sponsor: input.sponsor,
        sponsor_classification: input.sponsor_classification,
        sort: input.sort,
        action_since: input.action_since,
        updated_since: input.updated_since,
        include: input.include && input.include.length > 0 ? input.include : undefined,
        page: input.page,
        per_page: input.per_page,
      },
      ctx,
    );

    ctx.log.info('Searched bills', {
      jurisdiction: input.jurisdiction,
      q: input.q,
      count: result.results.length,
      total: result.pagination.total_items,
    });

    if (result.results.length === 0) {
      const filters: string[] = [];
      if (input.jurisdiction) filters.push(`jurisdiction="${input.jurisdiction}"`);
      if (input.q) filters.push(`q="${input.q}"`);
      if (input.session) filters.push(`session="${input.session}"`);
      if (input.chamber) filters.push(`chamber="${input.chamber}"`);
      return {
        results: [],
        pagination: result.pagination,
        message: `No bills matched ${filters.join(', ')}. Try broadening the query, checking the session identifier with openstates_get_jurisdiction, or removing filters.`,
      };
    }

    return { results: result.results, pagination: result.pagination };
  },

  format: (result) => {
    const lines: string[] = [
      `**${result.pagination.total_items} bills** (page ${result.pagination.page}/${result.pagination.max_page}, per page ${result.pagination.per_page}, showing ${result.results.length})`,
    ];
    if (result.message) {
      lines.push('');
      lines.push(`> ${result.message}`);
    }
    for (const bill of result.results) {
      lines.push('');
      lines.push(`## ${bill.identifier} — ${bill.title}`);
      lines.push(`**ID:** ${bill.id}`);
      lines.push(
        `**Session:** ${bill.session} | **Jurisdiction:** ${bill.jurisdiction.name} (${bill.jurisdiction.id})`,
      );
      lines.push(
        `**Chamber:** ${bill.from_organization.name} (${bill.from_organization.classification})`,
      );
      if (bill.classification.length > 0)
        lines.push(`**Classification:** ${bill.classification.join(', ')}`);
      if (bill.subject.length > 0) lines.push(`**Subjects:** ${bill.subject.join(', ')}`);
      if (bill.first_action_date) lines.push(`**First action:** ${bill.first_action_date}`);
      if (bill.latest_action_date) {
        lines.push(
          `**Latest action:** ${bill.latest_action_date} — ${bill.latest_action_description ?? 'N/A'}`,
        );
      }
      if (bill.latest_passage_date) lines.push(`**Passed:** ${bill.latest_passage_date}`);
      if (bill.sponsorships?.length) {
        lines.push('');
        lines.push('**Sponsors:**');
        for (const s of bill.sponsorships) {
          const primary = s.primary ? '**Primary**' : 'Cosponsor';
          lines.push(`- ${primary}: ${s.name} (${s.classification}, entity: ${s.entity_type})`);
        }
      }
      if (bill.abstracts?.length) {
        lines.push('');
        for (const abs of bill.abstracts) {
          lines.push(`*${abs.abstract}* _(${abs.note})_`);
        }
      }
      if (bill.actions?.length) {
        lines.push('');
        lines.push('**Actions:**');
        for (const a of bill.actions) {
          const cls = a.classification.length > 0 ? ` [${a.classification.join(', ')}]` : '';
          lines.push(
            `- #${a.order} ${a.date}: ${a.description}${cls} — ${a.organization.name} (${a.organization.classification})`,
          );
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
