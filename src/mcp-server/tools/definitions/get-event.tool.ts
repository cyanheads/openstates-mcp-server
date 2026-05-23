/**
 * @fileoverview Fetch full event detail by OCD event ID (experimental).
 * @module mcp-server/tools/definitions/get-event
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';
import type { Event } from '@/services/openstates/types.js';

const EventIncludeEnum = z.enum([
  'links',
  'sources',
  'media',
  'documents',
  'participants',
  'agenda',
]);

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
      .describe('Related data to inline. "agenda" and "participants" are most useful.'),
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
            note: z.string().describe('Link description.'),
          })
          .describe('External link record.'),
      )
      .optional()
      .describe('Event links when include=links is requested.'),
    media: z
      .array(
        z
          .object({
            url: z.string().describe('Media URL.'),
            note: z.string().describe('Media description.'),
          })
          .describe('Media link record.'),
      )
      .optional()
      .describe('Media links when include=media is requested.'),
    documents: z
      .array(
        z
          .object({
            url: z.string().describe('Document URL.'),
            note: z.string().describe('Document description.'),
          })
          .describe('Document link record.'),
      )
      .optional()
      .describe('Document links when include=documents is requested.'),
    participants: z
      .array(
        z
          .object({
            name: z.string().describe('Participant name.'),
            entity_type: z.string().describe('Entity type.'),
            role: z.string().describe('Participant role.'),
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
  ],

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    let event: Event;
    try {
      event = await svc.getEvent(
        input.event_id,
        input.include && input.include.length > 0 ? input.include : undefined,
        ctx,
      );
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('not_found', `Event not found: ${input.event_id}`, {
          ...ctx.recoveryFor('not_found'),
        });
      }
      throw err;
    }
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
      ...(event.participants
        ? {
            participants: event.participants.map((p) => ({
              name: p.name,
              entity_type: p.entity_type,
              role: p.role,
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
    const lines: string[] = [
      `# ${result.name}`,
      `**ID:** ${result.id}`,
      `**Classification:** ${result.classification} | **Status:** ${result.status}`,
      result.end_date
        ? `**Start:** ${result.start_date} | **End:** ${result.end_date}`
        : `**Start:** ${result.start_date}`,
      `**Jurisdiction:** ${result.jurisdiction.name} (${result.jurisdiction.id})`,
    ];
    if (result.description) lines.push(result.description);
    if (result.location) {
      const locStr = result.location.url
        ? `${result.location.name} — ${result.location.url}`
        : result.location.name;
      lines.push(`**Location:** ${locStr}`);
    }
    if (result.participants?.length) {
      lines.push('');
      lines.push('## Participants');
      for (const p of result.participants) {
        lines.push(`- ${p.name} (${p.role}) — ${p.entity_type}`);
      }
    }
    if (result.agenda?.length) {
      lines.push('');
      lines.push('## Agenda');
      for (const item of result.agenda) {
        lines.push(`- ${item.description}`);
        if (item.classification.length > 0)
          lines.push(`  Classification: ${item.classification.join(', ')}`);
        if (item.subjects.length > 0) lines.push(`  Subjects: ${item.subjects.join(', ')}`);
        if (item.related_entities.length > 0) {
          lines.push(
            `  Related: ${item.related_entities.map((e) => `${e.name} (${e.entity_type})`).join(', ')}`,
          );
        }
      }
    }
    if (result.links?.length) {
      lines.push('');
      lines.push('## Links');
      for (const l of result.links) lines.push(`- ${l.note}: ${l.url}`);
    }
    if (result.media?.length) {
      lines.push('');
      lines.push('## Media');
      for (const m of result.media) lines.push(`- ${m.note}: ${m.url}`);
    }
    if (result.documents?.length) {
      lines.push('');
      lines.push('## Documents');
      for (const d of result.documents) lines.push(`- ${d.note}: ${d.url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
