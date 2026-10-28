/**
 * @fileoverview Fetch full event detail by OCD event ID (experimental).
 * @module mcp-server/tools/definitions/get-event
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline, markdownLink } from '@cyanheads/mcp-ts-core/utils';
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

export const getEvent = tool('openstates_get_event', {
  title: 'Get Event',
  description:
    'Fetch full event detail by OCD event ID. Returns agenda, participants, media links, and associated documents when requested via include. Experimental — event coverage is limited in Open States. Obtain the event_id from openstates_search_events.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    event_id: z.string().min(1).describe('OCD event ID (from openstates_search_events results).'),
    include: z
      .array(EventIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "agenda" and "participants" are most useful; "links", "media", and "documents" add related URLs, recordings, and files, and "sources" the provenance URLs behind the record.',
      ),
  }),
  output: z.object({
    id: z.string().describe('OCD event ID.'),
    name: z.string().describe('Event name.'),
    description: z.string().describe('Event description.'),
    classification: z.string().describe('Event classification.'),
    start_date: z.string().describe('Event start datetime.'),
    end_date: z.string().optional().describe('Event end datetime. Absent when not recorded.'),
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
              .describe('Link description. Empty string when Open States recorded no description.'),
          })
          .describe('External link record.'),
      )
      .optional()
      .describe('Event links when include=links is requested.'),
    media: z
      .array(MediaRecord)
      .optional()
      .describe('Recordings and other media when include=media is requested.'),
    documents: z
      .array(DocumentRecord)
      .optional()
      .describe('Attached documents when include=documents is requested.'),
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
    participants: z
      .array(
        z
          .object({
            name: z.string().describe('Participant name.'),
            entity_type: z.string().describe('Entity type.'),
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
            classification: z.array(z.string()).describe('Agenda item classifications.'),
            subjects: z.array(z.string()).describe('Subject tags.'),
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
              .describe('Bills, people, or organizations referenced.'),
          })
          .describe('Agenda item record.'),
      )
      .optional()
      .describe('Agenda items when include=agenda is requested.'),
  }),
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'Event ID does not exist in Open States.',
      recovery:
        'Use openstates_search_events with a jurisdiction and date range to discover valid event IDs. Note that event data is experimental and coverage varies widely by state.',
    },
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout.',
      recovery:
        'Retry the lookup once; if it repeats, request fewer include values — agenda and participants each enlarge the upstream response.',
      // Raised by the service's `classifyUpstreamFailure`, which owns both timeout clocks — the
      // handler never sees the expiry it would need to throw on.
      thrownBy: 'service',
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
    const event = await svc
      .getEvent(
        input.event_id,
        input.include && input.include.length > 0 ? input.include : undefined,
        ctx,
      )
      .catch((err: unknown) => {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw ctx.fail('not_found', `Event not found: ${input.event_id}`);
        }
        throw err;
      });
    ctx.log.info('Fetched event', { id: event.id, name: event.name });
    return {
      id: event.id,
      name: event.name,
      description: event.description,
      classification: event.classification,
      start_date: event.start_date,
      end_date: event.end_date,
      status: event.status,
      jurisdiction: event.jurisdiction,
      ...(event.location
        ? {
            location: {
              name: event.location.name,
              ...(event.location.url ? { url: event.location.url } : {}),
            },
          }
        : {}),
      ...(event.links ? { links: event.links } : {}),
      ...(event.media ? { media: event.media } : {}),
      ...(event.documents ? { documents: event.documents } : {}),
      ...(event.sources ? { sources: event.sources } : {}),
      ...(event.participants
        ? {
            participants: event.participants.map((p) => ({
              name: p.name,
              entity_type: p.entity_type,
              ...(p.role !== undefined ? { role: p.role } : {}),
            })),
          }
        : {}),
      ...(event.agenda
        ? {
            agenda: event.agenda.map((item) => ({
              description: item.description,
              classification: item.classification,
              subjects: item.subjects,
              related_entities: item.related_entities.map((e) => ({
                name: e.name,
                entity_type: e.entity_type,
              })),
            })),
          }
        : {}),
    };
  },

  format: (result) => {
    const e = escapeMarkdownInline;
    const lines: string[] = [
      `# ${e(result.name)}`,
      `**ID:** ${e(result.id)}`,
      `**Classification:** ${e(result.classification)} | **Status:** ${e(result.status)}`,
      result.end_date
        ? `**Start:** ${e(result.start_date)} | **End:** ${e(result.end_date)}`
        : `**Start:** ${e(result.start_date)}`,
      `**Jurisdiction:** ${e(result.jurisdiction.name)} (${e(result.jurisdiction.id)})`,
    ];
    if (result.description) lines.push(e(result.description));
    if (result.location) {
      const { name, url } = result.location;
      lines.push(`**Location:** ${url ? markdownLink(name || url, url) : e(name)}`);
    }
    if (result.participants?.length) {
      lines.push('');
      lines.push('## Participants');
      for (const p of result.participants) {
        lines.push(
          p.role
            ? `- ${e(p.name)} (${e(p.role)}) — ${e(p.entity_type)}`
            : `- ${e(p.name)} — ${e(p.entity_type)}`,
        );
      }
    }
    if (result.agenda?.length) {
      lines.push('');
      lines.push('## Agenda');
      for (const item of result.agenda) {
        lines.push(`- ${e(item.description)}`);
        if (item.classification.length > 0)
          lines.push(`  Classification: ${item.classification.map(e).join(', ')}`);
        if (item.subjects.length > 0) lines.push(`  Subjects: ${item.subjects.map(e).join(', ')}`);
        if (item.related_entities.length > 0) {
          lines.push(
            `  Related: ${item.related_entities.map((r) => `${e(r.name)} (${e(r.entity_type)})`).join(', ')}`,
          );
        }
      }
    }
    const list = (heading: string, items: string[]) => {
      const rendered = items.filter(Boolean);
      if (rendered.length === 0) return;
      lines.push('');
      lines.push(`## ${heading}`);
      for (const item of rendered) lines.push(`- ${item}`);
    };
    const linkItems = (items: { url: string; note: string }[] | undefined) =>
      (items ?? []).map((i) => markdownLink(i.note || i.url, i.url));
    list('Links', linkItems(result.links));
    list('Media', (result.media ?? []).map(attachmentText));
    list('Documents', (result.documents ?? []).map(attachmentText));
    list('Sources', linkItems(result.sources));
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
