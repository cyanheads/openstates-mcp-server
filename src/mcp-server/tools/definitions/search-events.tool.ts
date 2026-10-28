/**
 * @fileoverview Search hearings, floor sessions, and committee meetings (experimental).
 * @module mcp-server/tools/definitions/search-events
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline, markdown, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const EventIncludeEnum = z.enum([
  'links',
  'sources',
  'media',
  'documents',
  'participants',
  'agenda',
]);

/** Open States `EventDocument` / `EventMedia` fields; the URLs sit in `links[]`, not on the record. */
const attachmentFields = (noun: string) => ({
  note: z
    .string()
    .describe(`${noun} description. Empty string when Open States recorded no description.`),
  date: z.string().describe(`${noun} date. Empty string when Open States recorded no date.`),
  classification: z
    .string()
    .describe(`${noun} classification. Empty string when Open States recorded none.`),
  links: z
    .array(
      z
        .object({
          url: z.string().describe(`${noun} URL.`),
          note: z
            .string()
            .optional()
            .describe('Link description. Absent when Open States recorded none.'),
        })
        .describe(`One URL for this ${noun.toLowerCase()} record.`),
    )
    .describe(`URLs for this ${noun.toLowerCase()} record — usually one, occasionally none.`),
});

const MediaRecord = z
  .object({
    ...attachmentFields('Media'),
    offset: z
      .number()
      .optional()
      .describe(
        'Start offset into the recording as Open States recorded it. Absent when not recorded.',
      ),
  })
  .describe('Media record.');

const DocumentRecord = z.object(attachmentFields('Document')).describe('Document record.');

/**
 * One media or document record as inline Markdown. Each URL is linked under its own note, else the
 * record's note, else the URL itself; the record's note leads only when no link already carries it
 * as a label; date, classification, and offset follow in parentheses when recorded. An entirely
 * empty record renders as `''`.
 */
function attachmentText(record: z.infer<typeof MediaRecord>): string {
  const e = escapeMarkdownInline;
  const linked = record.links
    .map((l) => markdownLink(l.note || record.note || l.url, l.url))
    .join(', ');
  const noteAsLabel = record.links.some((l) => !l.note);
  const lead = record.note && !noteAsLabel ? e(record.note) : '';
  const body = lead && linked ? `${lead}: ${linked}` : lead || linked;
  const meta = [
    record.date && e(record.date),
    record.classification && e(record.classification),
    record.offset !== undefined ? `offset ${record.offset}` : '',
  ].filter(Boolean);
  if (meta.length === 0) return body;
  return body ? `${body} (${meta.join(', ')})` : `(${meta.join(', ')})`;
}

/** Loose ISO 8601 — date-only or datetime, both accepted by the Open States API. */
const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
const isoDateMessage =
  'Must be an ISO 8601 date or datetime (e.g., "2025-01-01" or "2025-01-01T00:00:00Z").';

export const searchEvents = tool('openstates_search_events', {
  title: 'Search Events',
  description:
    'Search hearings, floor sessions, and committee meetings. jurisdiction is required — the Open States events endpoint has no all-states search, so scope every call to a single state; use openstates_list_jurisdictions to pick one. Experimental — most states do not publish event data to Open States. Use after and before to scope to a date range. Set require_bills=true to filter to events with bills on the agenda, which is the most useful filter for tracking legislation through committee. Use include=agenda,participants for full meeting context. Empty results from an unfiltered search often indicate the state lacks event data rather than no events occurring.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    jurisdiction: z
      .string()
      .min(1)
      .describe(
        'State name, abbreviation, or OCD-ID. Required — the Open States events endpoint has no all-states search, so every call must be scoped to a single jurisdiction.',
      ),
    after: z
      .string()
      .regex(isoDateRegex, isoDateMessage)
      .optional()
      .describe(
        'ISO 8601 datetime — events starting after this time. Use to find upcoming hearings.',
      ),
    before: z
      .string()
      .regex(isoDateRegex, isoDateMessage)
      .optional()
      .describe('ISO 8601 datetime — events starting before this time.'),
    require_bills: z
      .boolean()
      .default(false)
      .describe(
        'When true, only return events with at least one bill on the agenda. Most useful for tracking legislation through committee.',
      ),
    include: z
      .array(EventIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "agenda" includes the meeting agenda with bill references. "participants" includes the committee or chamber hosting the event. "links" and "media" add related URLs and recordings, "documents" the attached files, and "sources" the provenance URLs behind the record.',
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
            id: z.string().describe('OCD event ID — use in openstates_get_event.'),
            name: z.string().describe('Event name.'),
            description: z.string().describe('Event description.'),
            classification: z
              .string()
              .describe('Event classification (e.g., "committee-meeting").'),
            start_date: z.string().describe('Event start datetime.'),
            end_date: z
              .string()
              .optional()
              .describe('Event end datetime. Absent when not recorded.'),
            status: z.string().describe('Event status.'),
            jurisdiction: z
              .object({
                id: z.string().describe('OCD jurisdiction ID.'),
                name: z.string().describe('Jurisdiction name.'),
              })
              .describe('Hosting jurisdiction.'),
            location: z
              .object({
                name: z.string().describe('Location name.'),
                url: z.string().optional().describe('Location URL when available.'),
              })
              .optional()
              .describe('Event location when available.'),
            links: z
              .array(
                z
                  .object({
                    url: z.string().describe('Link URL.'),
                    note: z
                      .string()
                      .describe(
                        'Link description. Empty string when Open States recorded no description.',
                      ),
                  })
                  .describe('External link record.'),
              )
              .optional()
              .describe('Event links when include=links is requested.'),
            sources: z
              .array(
                z
                  .object({
                    url: z.string().describe('Source URL.'),
                    note: z
                      .string()
                      .describe('Source note. Empty string when Open States recorded no note.'),
                  })
                  .describe('Source record.'),
              )
              .optional()
              .describe('Provenance sources when include=sources is requested.'),
            media: z
              .array(MediaRecord)
              .optional()
              .describe('Recordings and other media when include=media is requested.'),
            documents: z
              .array(DocumentRecord)
              .optional()
              .describe('Attached documents when include=documents is requested.'),
            participants: z
              .array(
                z
                  .object({
                    name: z.string().describe('Participant name.'),
                    entity_type: z
                      .string()
                      .describe('Entity type (e.g., "organization", "person").'),
                    role: z
                      .string()
                      .optional()
                      .describe('Participant role. Absent when upstream omits it.'),
                  })
                  .describe('Participant record.'),
              )
              .optional()
              .describe('Participants when include=participants is requested.'),
            agenda: z
              .array(
                z
                  .object({
                    description: z.string().describe('Agenda item description.'),
                    classification: z.array(z.string()).describe('Agenda item classification.'),
                    subjects: z.array(z.string()).describe('Subject tags for this agenda item.'),
                    related_entities: z
                      .array(
                        z
                          .object({
                            name: z.string().describe('Related entity name.'),
                            entity_type: z
                              .string()
                              .describe('Entity type (e.g., "bill", "person", "organization").'),
                          })
                          .describe('Related entity record.'),
                      )
                      .describe('Bills, people, or organizations referenced in this agenda item.'),
                  })
                  .describe('Agenda item record.'),
              )
              .optional()
              .describe('Agenda items when include=agenda is requested.'),
          })
          .describe('Event record.'),
      )
      .describe('Events matching the search criteria.'),
    pagination: z
      .object({
        page: z.number().describe('Current page.'),
        per_page: z.number().describe('Results per page.'),
        max_page: z.number().describe('Total pages.'),
        total_items: z.number().describe('Total matching events.'),
      })
      .describe('Pagination metadata.'),
  }),

  enrichment: {
    totalCount: z.number().describe('Total events matching the query across all pages.'),
    page: z.number().describe('Current page returned.'),
    maxPage: z.number().describe('Total pages available.'),
    coverageNote: z
      .string()
      .describe(
        'Event data is experimental — most states do not publish event data to Open States. Empty results may indicate the state lacks data, not that no events occurred.',
      ),
    notice: z
      .string()
      .optional()
      .describe('Recovery hint when results are empty. Absent when results are returned.'),
    appliedFilters: z
      .object({
        jurisdiction: z.string().optional().describe('Jurisdiction filter as received.'),
        after: z.string().optional().describe('after datetime filter as received.'),
        before: z.string().optional().describe('before datetime filter as received.'),
        require_bills: z.boolean().describe('require_bills flag as received.'),
        page: z.number().describe('Page number requested.'),
        per_page: z.number().describe('Results per page requested.'),
      })
      .describe(
        'Filters applied to this query as the server received them, for agent self-verification of zero or unexpected results.',
      ),
  },
  enrichmentTrailer: {
    // Caller-echoed values: JSON in a code span reads back exactly, with no escapes to copy along.
    appliedFilters: {
      render: (v) => `**appliedFilters:** ${markdown().inlineCode(JSON.stringify(v)).build()}`,
    },
    // Server-authored prose; the framework default would render this string as a code span.
    coverageNote: { render: (v) => `**coverageNote:** ${v}` },
  },
  errors: [
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout — the query is too broad.',
      recovery:
        'Narrow the search: bound it with after and before, set require_bills=true, and drop any include values you do not need.',
      // Raised by the service's `classifyUpstreamFailure`, which owns both timeout clocks — the
      // handler never sees the expiry it would need to throw on.
      thrownBy: 'service',
    },
    {
      reason: 'invalid_page',
      code: JsonRpcErrorCode.NotFound,
      when: 'Open States rejected the request as not found — page is past the last page for this query.',
      recovery:
        'Request a page within the max_page bound returned by a previous call; the error message names the valid range.',
    },
    {
      reason: 'rate_limited',
      code: JsonRpcErrorCode.RateLimited,
      when: "The shared Open States API key reached a request cap — Open States' per-minute or daily limit, or this server's own daily budget.",
      recovery: 'Wait the number of seconds in retryAfter, then retry the same call unchanged.',
      retryable: true,
      // Raised by the service, which reads the cap from the 429 body or its own daily-budget guard.
      thrownBy: 'service',
    },
  ],

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    const result = await svc
      .searchEvents(
        {
          jurisdiction: input.jurisdiction,
          after: input.after,
          before: input.before,
          require_bills: input.require_bills,
          include: input.include && input.include.length > 0 ? input.include : undefined,
          page: input.page,
          per_page: input.per_page,
        },
        ctx,
      )
      // The service has already folded the upstream `detail` into the message, so the reason is
      // all that is missing; the framework fills the declared recovery hint.
      .catch((err: unknown) => {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw ctx.fail('invalid_page', err.message);
        }
        throw err;
      });

    ctx.log.info('Searched events', {
      jurisdiction: input.jurisdiction,
      count: result.results.length,
      total: result.pagination.total_items,
    });

    ctx.enrich.total(result.pagination.total_items);
    ctx.enrich({
      page: result.pagination.page,
      maxPage: result.pagination.max_page,
      coverageNote:
        'Event data is experimental — most states do not publish event data to Open States. Empty results may indicate the state lacks data, not that no events occurred.',
      appliedFilters: {
        jurisdiction: input.jurisdiction,
        after: input.after,
        before: input.before,
        require_bills: input.require_bills,
        page: input.page,
        per_page: input.per_page,
      },
    });

    if (result.results.length === 0) {
      const filters = [
        ...(input.require_bills ? ['require_bills=true'] : []),
        ...(['after', 'before'] as const).flatMap((key) =>
          input[key] === undefined ? [] : [`${key}=${JSON.stringify(input[key])}`],
        ),
      ];
      const widen = [
        ...(input.require_bills ? ['without require_bills'] : []),
        ...(input.after !== undefined || input.before !== undefined
          ? ['with a wider after/before window']
          : []),
      ];
      // A narrowing filter can empty the page of a state that does publish events, so the
      // missing-data reading is offered only for an unfiltered search. A notice is authored
      // Markdown, so the caller's filter values inside it are encoded.
      ctx.enrich.notice(
        filters.length > 0
          ? `No events matched ${escapeMarkdownInline(filters.join(', '))}. The jurisdiction may still hold events outside these filters — repeat the search ${widen.join(' or ')} before concluding it lacks event data.`
          : 'No events found. Event coverage is experimental — most states do not publish event data to Open States. If you expected results, the state may lack event data entirely.',
      );
    }

    return { results: result.results, pagination: result.pagination };
  },

  format: (result) => {
    const lines: string[] = [
      `**${result.pagination.total_items} events** (page ${result.pagination.page}/${result.pagination.max_page}, per page ${result.pagination.per_page}, showing ${result.results.length})`,
    ];
    const e = escapeMarkdownInline;
    const linkLine = (label: string, items: { url: string; note: string }[] | undefined) => {
      if (items?.length) {
        lines.push(
          `**${label}:** ${items.map((i) => markdownLink(i.note || i.url, i.url)).join(', ')}`,
        );
      }
    };
    // Records are `; `-separated: one record's links are already `, `-joined.
    const attachmentLine = (label: string, records: z.infer<typeof MediaRecord>[] | undefined) => {
      const rendered = (records ?? []).map(attachmentText).filter(Boolean);
      if (rendered.length > 0) lines.push(`**${label}:** ${rendered.join('; ')}`);
    };
    for (const event of result.results) {
      lines.push('');
      lines.push(`## ${e(event.name)}`);
      lines.push(`**ID:** ${e(event.id)}`);
      lines.push(`**Classification:** ${e(event.classification)} | **Status:** ${e(event.status)}`);
      lines.push(
        event.end_date
          ? `**Start:** ${e(event.start_date)} | **End:** ${e(event.end_date)}`
          : `**Start:** ${e(event.start_date)}`,
      );
      lines.push(`**Jurisdiction:** ${e(event.jurisdiction.name)} (${e(event.jurisdiction.id)})`);
      if (event.description) lines.push(e(event.description));
      if (event.location) {
        const { name, url } = event.location;
        lines.push(`**Location:** ${url ? markdownLink(name || url, url) : e(name)}`);
      }
      if (event.participants?.length) {
        lines.push(
          `**Participants:** ${event.participants
            .map((p) =>
              p.role
                ? `${e(p.name)} (${e(p.role)}, ${e(p.entity_type)})`
                : `${e(p.name)} (${e(p.entity_type)})`,
            )
            .join(', ')}`,
        );
      }
      if (event.agenda?.length) {
        lines.push('**Agenda:**');
        for (const item of event.agenda) {
          const cls =
            item.classification.length > 0 ? ` [${item.classification.map(e).join(', ')}]` : '';
          const subj =
            item.subjects.length > 0 ? ` | Subjects: ${item.subjects.map(e).join(', ')}` : '';
          lines.push(`- ${e(item.description)}${cls}${subj}`);
          if (item.related_entities.length > 0) {
            lines.push(
              `  Related: ${item.related_entities.map((r) => `${e(r.name)} (${e(r.entity_type)})`).join(', ')}`,
            );
          }
        }
      }
      linkLine('Links', event.links);
      linkLine('Sources', event.sources);
      attachmentLine('Media', event.media);
      attachmentLine('Documents', event.documents);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
