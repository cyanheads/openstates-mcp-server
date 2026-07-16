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

/** Loose ISO 8601 — date-only or datetime, both accepted by the Open States API. */
const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
const isoDateMessage =
  'Must be an ISO 8601 date or datetime (e.g., "2025-01-01" or "2025-01-01T00:00:00Z").';

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
      .regex(isoDateRegex, isoDateMessage)
      .optional()
      .describe(
        'ISO 8601 date — only return bills with an action after this date (e.g., "2025-01-01").',
      ),
    updated_since: z
      .string()
      .regex(isoDateRegex, isoDateMessage)
      .optional()
      .describe('ISO 8601 date — only return bills updated after this date (e.g., "2025-01-01").'),
    created_since: z
      .string()
      .regex(isoDateRegex, isoDateMessage)
      .optional()
      .describe(
        'ISO 8601 date — only return bills first entered in Open States after this date (e.g., "2025-01-01"). Use to find newly-introduced bills, as opposed to recently-updated or recently-acted-on.',
      ),
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
            other_titles: z
              .array(
                z
                  .object({
                    title: z.string().describe('Alternate bill title.'),
                    note: z.string().describe('Note describing the alternate title.'),
                  })
                  .describe('Alternate title record.'),
              )
              .optional()
              .describe('Alternate titles when include=other_titles is requested.'),
            other_identifiers: z
              .array(
                z
                  .object({
                    identifier: z.string().describe('Alternate bill identifier.'),
                    scheme: z.string().describe('Identifier scheme (the issuing system).'),
                  })
                  .describe('Alternate identifier record.'),
              )
              .optional()
              .describe('Alternate identifiers when include=other_identifiers is requested.'),
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
              .describe('Source documents when include=sources is requested.'),
            versions: z
              .array(
                z
                  .object({
                    id: z.string().describe('Version ID.'),
                    note: z.string().describe('Version note.'),
                    date: z.string().describe('Version date.'),
                    links: z
                      .array(
                        z
                          .object({
                            url: z.string().describe('Document URL.'),
                            media_type: z.string().describe('MIME type.'),
                          })
                          .describe('Document link.'),
                      )
                      .describe('Document links.'),
                  })
                  .describe('Bill text version record.'),
              )
              .optional()
              .describe('Bill text versions when include=versions is requested.'),
            documents: z
              .array(
                z
                  .object({
                    id: z.string().describe('Document ID.'),
                    note: z.string().describe('Document note.'),
                    date: z.string().describe('Document date.'),
                    links: z
                      .array(
                        z
                          .object({
                            url: z.string().describe('Document URL.'),
                            media_type: z.string().describe('MIME type.'),
                          })
                          .describe('Document link.'),
                      )
                      .describe('Document links.'),
                  })
                  .describe('Bill document record.'),
              )
              .optional()
              .describe('Bill documents (fiscal notes, etc.) when include=documents is requested.'),
            votes: z
              .array(
                z
                  .object({
                    id: z.string().describe('Vote event ID.'),
                    motion_text: z.string().describe('Motion text.'),
                    start_date: z.string().describe('Vote date.'),
                    result: z.string().describe('Vote result: "pass" or "fail".'),
                    identifier: z.string().describe('Vote identifier.'),
                    counts: z
                      .array(
                        z
                          .object({
                            option: z
                              .string()
                              .describe('Vote option (e.g., "yes", "no", "absent").'),
                            value: z.number().describe('Count of votes for this option.'),
                          })
                          .describe('Vote tally entry.'),
                      )
                      .describe('Vote tallies by option.'),
                    votes: z
                      .array(
                        z
                          .object({
                            option: z.string().describe('How this legislator voted.'),
                            voter_name: z.string().describe('Voter name.'),
                            voter: z
                              .object({
                                id: z.string().describe('OCD person ID.'),
                                name: z.string().describe('Person name.'),
                              })
                              .optional()
                              .describe('Linked person record when available.'),
                          })
                          .describe('Individual legislator vote.'),
                      )
                      .describe('Per-legislator vote positions.'),
                  })
                  .describe('Vote event record.'),
              )
              .optional()
              .describe('Vote events when include=votes is requested.'),
            related_bills: z
              .array(
                z
                  .object({
                    identifier: z.string().describe('Related bill identifier.'),
                    legislative_session: z.string().describe('Session of the related bill.'),
                    relation_type: z
                      .string()
                      .describe('Relationship type (e.g., "companion", "identical").'),
                  })
                  .describe('Related bill record.'),
              )
              .optional()
              .describe('Related bills when include=related_bills is requested.'),
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
  }),

  enrichment: {
    totalCount: z.number().describe('Total bills matching the query across all pages.'),
    page: z.number().describe('Current page returned.'),
    maxPage: z.number().describe('Total pages available.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty — echoes the filters applied and suggests how to broaden. Absent when results are returned.',
      ),
    appliedFilters: z
      .object({
        jurisdiction: z.string().optional().describe('Jurisdiction filter as received.'),
        q: z.string().optional().describe('Full-text query as received.'),
        session: z.string().optional().describe('Session filter as received.'),
        chamber: z.string().optional().describe('Chamber filter as received.'),
        classification: z.string().optional().describe('Classification filter as received.'),
        action_since: z.string().optional().describe('action_since date filter as received.'),
        updated_since: z.string().optional().describe('updated_since date filter as received.'),
        created_since: z.string().optional().describe('created_since date filter as received.'),
        sort: z.string().describe('Sort order applied.'),
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
      reason: 'missing_scope',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Neither jurisdiction nor q (full-text search) was provided.',
      recovery:
        'Provide a jurisdiction (state name or OCD-ID) or a full-text search term via q, or both.',
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
        created_since: input.created_since,
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

    ctx.enrich.total(result.pagination.total_items);
    ctx.enrich({
      page: result.pagination.page,
      maxPage: result.pagination.max_page,
      appliedFilters: {
        jurisdiction: input.jurisdiction,
        q: input.q,
        session: input.session,
        chamber: input.chamber,
        classification: input.classification,
        action_since: input.action_since,
        updated_since: input.updated_since,
        created_since: input.created_since,
        sort: input.sort,
        page: input.page,
        per_page: input.per_page,
      },
    });

    if (result.results.length === 0) {
      const filters: string[] = [];
      if (input.jurisdiction) filters.push(`jurisdiction="${input.jurisdiction}"`);
      if (input.q) filters.push(`q="${input.q}"`);
      if (input.session) filters.push(`session="${input.session}"`);
      if (input.chamber) filters.push(`chamber="${input.chamber}"`);
      const sessionHint = input.session
        ? ' If the session filter is the likely cause, use openstates_get_jurisdiction with include=legislative_sessions to list valid session identifiers for this jurisdiction.'
        : '';
      ctx.enrich.notice(
        `No bills matched ${filters.join(', ')}. Try broadening the query or removing filters.${sessionHint}`,
      );
    }

    return { results: result.results, pagination: result.pagination };
  },

  format: (result) => {
    const lines: string[] = [
      `**${result.pagination.total_items} bills** (page ${result.pagination.page}/${result.pagination.max_page}, per page ${result.pagination.per_page}, showing ${result.results.length})`,
    ];
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
      if (bill.other_titles?.length) {
        lines.push('');
        lines.push('**Other titles:**');
        for (const t of bill.other_titles) {
          lines.push(`- ${t.title}${t.note ? ` _(${t.note})_` : ''}`);
        }
      }
      if (bill.other_identifiers?.length) {
        lines.push('');
        lines.push('**Other identifiers:**');
        for (const oi of bill.other_identifiers) {
          lines.push(`- ${oi.identifier} (${oi.scheme})`);
        }
      }
      if (bill.votes?.length) {
        lines.push('');
        lines.push('**Votes:**');
        for (const v of bill.votes) {
          lines.push(`### ${v.motion_text} (${v.start_date})`);
          lines.push(`**Result:** ${v.result} | **ID:** ${v.id} | **Identifier:** ${v.identifier}`);
          const counts = v.counts.map((c) => `${c.option}: ${c.value}`).join(', ');
          lines.push(`**Tally:** ${counts}`);
          if (v.votes.length > 0) {
            lines.push('**Individual votes:**');
            for (const pv of v.votes) {
              const voterLink = pv.voter ? ` (ID: ${pv.voter.id}, name: ${pv.voter.name})` : '';
              lines.push(`- ${pv.voter_name}${voterLink}: ${pv.option}`);
            }
          }
        }
      }
      if (bill.versions?.length) {
        lines.push('');
        lines.push('**Bill Text Versions:**');
        for (const v of bill.versions) {
          lines.push(
            `- [${v.id}] ${v.note} (${v.date}): ${v.links.map((l) => `${l.url} [${l.media_type}]`).join(', ')}`,
          );
        }
      }
      if (bill.documents?.length) {
        lines.push('');
        lines.push('**Documents:**');
        for (const d of bill.documents) {
          lines.push(
            `- [${d.id}] ${d.note} (${d.date}): ${d.links.map((l) => `${l.url} [${l.media_type}]`).join(', ')}`,
          );
        }
      }
      if (bill.related_bills?.length) {
        lines.push('');
        lines.push('**Related Bills:**');
        for (const r of bill.related_bills) {
          lines.push(`- ${r.identifier} (${r.legislative_session}) — ${r.relation_type}`);
        }
      }
      if (bill.sources?.length) {
        lines.push('');
        lines.push('**Sources:**');
        for (const s of bill.sources) {
          lines.push(`- ${s.url}${s.note ? ` _(${s.note})_` : ''}`);
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
