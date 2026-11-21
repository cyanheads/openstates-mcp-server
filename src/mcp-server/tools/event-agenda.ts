/**
 * @fileoverview Shared agenda projection and related-entity rendering for the event tools.
 * @module mcp-server/tools/event-agenda
 */

import { z } from '@cyanheads/mcp-ts-core';
import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';
import type { AgendaItem } from '@/services/openstates/types.js';

const RelatedEntitySchema = z
  .object({
    name: z.string().describe('Related entity name as recorded on the agenda.'),
    entity_type: z
      .string()
      .describe('Entity type (e.g., "bill", "person", "organization", "vote").'),
    bill: z
      .object({
        id: z.string().describe('OCD bill ID. Pass to openstates_get_bill as openstates_id.'),
        identifier: z.string().optional().describe('Bill identifier assigned by the legislature.'),
        session: z.string().optional().describe('Legislative session of the linked bill.'),
      })
      .optional()
      .describe('Linked bill when Open States supplies an ID.'),
    organization: z
      .object({
        id: z
          .string()
          .describe(
            'OCD organization ID. For a committee, pass to openstates_get_committee as committee_id.',
          ),
        classification: z
          .string()
          .optional()
          .describe('Organization classification when recorded, e.g., "committee" or "upper".'),
      })
      .optional()
      .describe('Linked organization when Open States supplies an ID.'),
    person: z
      .object({
        id: z.string().describe('OCD person ID. Pass in the openstates_search_people id array.'),
      })
      .optional()
      .describe('Linked person when Open States supplies an ID.'),
    vote: z
      .object({
        id: z.string().describe('OCD vote event ID.'),
      })
      .optional()
      .describe('Linked vote event when Open States supplies an ID.'),
  })
  .describe('Related record, with a name and type even when Open States has no link.');

/** Output shared by event search and detail. */
export const eventAgendaSchema = z
  .array(
    z
      .object({
        description: z.string().describe('Agenda item description.'),
        classification: z.array(z.string()).describe('Agenda item classifications.'),
        subjects: z.array(z.string()).describe('Subject tags.'),
        related_entities: z.array(RelatedEntitySchema).describe('Records referenced by this item.'),
      })
      .describe('Agenda item record.'),
  )
  .optional()
  .describe('Agenda items when include=agenda is requested.');

type RelatedEntity = z.infer<typeof RelatedEntitySchema>;

/** Keep name-only references and project compact links whose target has a recorded ID. */
export function projectEventAgenda(
  agenda: AgendaItem[],
): NonNullable<z.infer<typeof eventAgendaSchema>> {
  return agenda.map((item) => ({
    description: item.description,
    classification: item.classification,
    subjects: item.subjects,
    related_entities: item.related_entities.map(
      ({ name, entity_type, bill, organization, person, vote }) => ({
        name,
        entity_type,
        ...(bill?.id
          ? {
              bill: {
                id: bill.id,
                ...(bill.identifier != null ? { identifier: bill.identifier } : {}),
                ...(bill.session != null ? { session: bill.session } : {}),
              },
            }
          : {}),
        ...(organization?.id
          ? {
              organization: {
                id: organization.id,
                ...(organization.classification != null
                  ? { classification: organization.classification }
                  : {}),
              },
            }
          : {}),
        ...(person?.id ? { person: { id: person.id } } : {}),
        ...(vote?.id ? { vote: { id: vote.id } } : {}),
      }),
    ),
  }));
}

/** Render IDs and metadata alongside the agenda reference, with upstream text escaped literally. */
export function formatAgendaRelatedEntity(entity: RelatedEntity): string {
  const e = escapeMarkdownInline;
  const { name, entity_type, bill, organization, person, vote } = entity;
  const text = [`${e(name)} (${e(entity_type)})`];
  if (bill) {
    text.push(`Bill ID: ${e(bill.id)}`);
    if (bill.identifier !== undefined) text.push(`Bill identifier: ${e(bill.identifier)}`);
    if (bill.session !== undefined) text.push(`Session: ${e(bill.session)}`);
  }
  if (organization) {
    text.push(`Organization ID: ${e(organization.id)}`);
    if (organization.classification !== undefined) {
      text.push(`Organization classification: ${e(organization.classification)}`);
    }
  }
  if (person) text.push(`Person ID: ${e(person.id)}`);
  if (vote) text.push(`Vote ID: ${e(vote.id)}`);
  return text.join(' | ');
}
