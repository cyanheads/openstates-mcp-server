/**
 * @fileoverview Search hearings, floor sessions, and committee meetings (experimental).
 * @module mcp-server/tools/definitions/search-events
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const EventIncludeEnum = z.enum([
  'links',
  'sources',
  'media',
  'documents',
  'participants',
  'agenda',
]);

export const searchEvents = tool('openstates_search_events', {
  title: 'Search Events',
  description:
    'Search hearings, floor sessions, and committee meetings. Experimental — most states do not publish event data to Open States. Use after and before to scope to a date range. Set require_bills=true to filter to events with bills on the agenda, which is the most useful filter for tracking legislation through committee. Use include=agenda,participants for full meeting context. Empty results often indicate the state lacks event data rather than no events occurring.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    jurisdiction: z
      .string()
      .optional()
      .describe('State name, abbreviation, or OCD-ID. Strongly recommended.'),
    after: z
      .string()
      .optional()
      .describe(
        'ISO 8601 datetime — events starting after this time. Use to find upcoming hearings.',
      ),
    before: z.string().optional().describe('ISO 8601 datetime — events starting before this time.'),
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
        'Related data to inline. "agenda" includes the meeting agenda with bill references. "participants" includes the committee or chamber hosting the event.',
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
            end_date: z.string().describe('Event end datetime.'),
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
            participants: z
              .array(
                z
                  .object({
                    name: z.string().describe('Participant name.'),
                    entity_type: z
                      .string()
                      .describe('Entity type (e.g., "organization", "person").'),
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
    message: z
      .string()
      .optional()
      .describe('Recovery hint when results are empty. Absent when results are returned.'),
  }),

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    const result = await svc.searchEvents(
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
    );

    ctx.log.info('Searched events', {
      jurisdiction: input.jurisdiction,
      count: result.results.length,
      total: result.pagination.total_items,
    });

    if (result.results.length === 0) {
      return {
        results: [],
        pagination: result.pagination,
        message:
          'No events found. Event coverage is experimental — most states do not publish event data to Open States. If you expected results, the state may lack event data entirely.',
      };
    }

    return { results: result.results, pagination: result.pagination };
  },

  format: (result) => {
    const lines: string[] = [
      `**${result.pagination.total_items} events** (page ${result.pagination.page}/${result.pagination.max_page}, per page ${result.pagination.per_page}, showing ${result.results.length})`,
    ];
    if (result.message) {
      lines.push('');
      lines.push(`> ${result.message}`);
    }
    for (const event of result.results) {
      lines.push('');
      lines.push(`## ${event.name}`);
      lines.push(`**ID:** ${event.id}`);
      lines.push(`**Classification:** ${event.classification} | **Status:** ${event.status}`);
      lines.push(`**Start:** ${event.start_date} | **End:** ${event.end_date}`);
      lines.push(`**Jurisdiction:** ${event.jurisdiction.name} (${event.jurisdiction.id})`);
      if (event.description) lines.push(event.description);
      if (event.location) {
        const locStr = event.location.url
          ? `${event.location.name} — ${event.location.url}`
          : event.location.name;
        lines.push(`**Location:** ${locStr}`);
      }
      if (event.participants?.length) {
        lines.push(
          `**Participants:** ${event.participants.map((p) => `${p.name} (${p.role}, ${p.entity_type})`).join(', ')}`,
        );
      }
      if (event.agenda?.length) {
        lines.push('**Agenda:**');
        for (const item of event.agenda) {
          const cls = item.classification.length > 0 ? ` [${item.classification.join(', ')}]` : '';
          const subj = item.subjects.length > 0 ? ` | Subjects: ${item.subjects.join(', ')}` : '';
          lines.push(`- ${item.description}${cls}${subj}`);
          if (item.related_entities.length > 0) {
            lines.push(
              `  Related: ${item.related_entities.map((e) => `${e.name} (${e.entity_type})`).join(', ')}`,
            );
          }
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
