/**
 * @fileoverview Fetch full detail for a specific state bill.
 * @module mcp-server/tools/definitions/get-bill
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
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

export const getBill = tool('openstates_get_bill', {
  title: 'Get Bill',
  description:
    'Fetch full detail for a specific state bill. Accepts either the three-part path (jurisdiction + session + bill_id) or a direct OCD bill ID (openstates_id from search results). Use include to request votes, actions, sponsorships, documents, and versions in one call rather than searching again. include=votes returns the full vote tally and per-legislator positions. include=actions returns the complete action history. Prefer openstates_id when available to avoid session identifier lookup.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    openstates_id: z
      .string()
      .optional()
      .describe(
        'OCD bill ID from openstates_search_bills results (e.g., "ocd-bill/..."). Preferred over the three-part path when available.',
      ),
    jurisdiction: z
      .string()
      .optional()
      .describe(
        'State name, abbreviation, or OCD-ID. Required when using path-based lookup with session + bill_id.',
      ),
    session: z
      .string()
      .optional()
      .describe('Session identifier. Required with jurisdiction + bill_id.'),
    bill_id: z
      .string()
      .optional()
      .describe(
        'Bill identifier as used by the legislature (e.g., "HB 1000", "SB 42"). Required with jurisdiction + session.',
      ),
    include: z
      .array(BillIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "sponsorships", "actions", "votes" are most commonly needed. "versions" and "documents" provide links to bill text and fiscal notes.',
      ),
  }),
  output: z.object({
    id: z.string().describe('OCD bill ID.'),
    identifier: z.string().describe('Bill identifier as used by the legislature.'),
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
        classification: z.string().describe('Chamber classification.'),
      })
      .describe('Originating chamber.'),
    classification: z.array(z.string()).describe('Bill classifications.'),
    subject: z.array(z.string()).describe('Subject tags.'),
    first_action_date: z.string().nullable().describe('Date of first recorded action.'),
    latest_action_date: z.string().nullable().describe('Date of most recent action.'),
    latest_action_description: z.string().nullable().describe('Most recent action description.'),
    latest_passage_date: z.string().nullable().describe('Date bill passed (when applicable).'),
    openstates_url: z.string().optional().describe('Open States URL for this bill.'),
    sponsorships: z
      .array(
        z
          .object({
            name: z.string().describe('Sponsor name.'),
            entity_type: z.string().describe('Entity type.'),
            primary: z.boolean().describe('Whether this is the primary sponsor.'),
            classification: z.string().describe('Sponsorship classification.'),
            person: z
              .object({
                id: z.string().describe('OCD person ID.'),
                name: z.string().describe('Person name.'),
              })
              .optional()
              .describe('Linked person record when available.'),
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
            order: z.number().describe('Sequence order.'),
            organization: z
              .object({
                name: z.string().describe('Organization name.'),
                classification: z.string().describe('Organization classification.'),
              })
              .describe('Chamber or committee.'),
          })
          .describe('Action record.'),
      )
      .optional()
      .describe('Full action history when include=actions is requested.'),
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
                    option: z.string().describe('Vote option (e.g., "yes", "no", "absent").'),
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
    abstracts: z
      .array(
        z
          .object({
            abstract: z.string().describe('Plain-language summary.'),
            note: z.string().describe('Source note.'),
          })
          .describe('Abstract record.'),
      )
      .optional()
      .describe('Bill abstracts when include=abstracts is requested.'),
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
  }),
  errors: [
    {
      reason: 'missing_lookup_params',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Neither openstates_id nor the complete jurisdiction+session+bill_id triple was provided.',
      recovery:
        'Provide either openstates_id (from openstates_search_bills results) or all three of: jurisdiction, session, and bill_id.',
    },
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'Bill does not exist at the given path or OCD ID.',
      recovery:
        'Verify the session identifier with openstates_get_jurisdiction and confirm the bill_id format matches the legislature convention (e.g., "HB 1000" not "HB1000").',
    },
  ],

  async handler(input, ctx) {
    const hasOcdId = !!input.openstates_id;
    const hasPathLookup = !!input.jurisdiction && !!input.session && !!input.bill_id;

    if (!hasOcdId && !hasPathLookup) {
      throw ctx.fail(
        'missing_lookup_params',
        'Provide openstates_id OR jurisdiction + session + bill_id.',
        {
          ...ctx.recoveryFor('missing_lookup_params'),
        },
      );
    }

    const svc = getOpenStatesApiService();
    const include = input.include && input.include.length > 0 ? input.include : undefined;

    const bill = await (hasOcdId
      ? svc.getBillById(input.openstates_id!, include, ctx)
      : svc.getBillByPath(input.jurisdiction!, input.session!, input.bill_id!, include, ctx)
    ).catch((err: unknown) => {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        const id = input.openstates_id ?? `${input.jurisdiction}/${input.session}/${input.bill_id}`;
        throw ctx.fail('not_found', `Bill not found: ${id}`, { ...ctx.recoveryFor('not_found') });
      }
      throw err;
    });

    ctx.log.info('Fetched bill', { id: bill.id, identifier: bill.identifier });
    return bill;
  },

  format: (result) => {
    const lines: string[] = [
      `# ${result.identifier} — ${result.title}`,
      `**ID:** ${result.id}`,
      `**Session:** ${result.session} | **Jurisdiction:** ${result.jurisdiction.name} (${result.jurisdiction.id})`,
      `**Chamber:** ${result.from_organization.name} (${result.from_organization.classification})`,
    ];
    if (result.classification.length > 0)
      lines.push(`**Classification:** ${result.classification.join(', ')}`);
    if (result.subject.length > 0) lines.push(`**Subjects:** ${result.subject.join(', ')}`);
    if (result.first_action_date) lines.push(`**First action:** ${result.first_action_date}`);
    if (result.latest_action_date) {
      lines.push(
        `**Latest action:** ${result.latest_action_date} — ${result.latest_action_description ?? 'N/A'}`,
      );
    }
    if (result.latest_passage_date) lines.push(`**Passed:** ${result.latest_passage_date}`);
    if (result.openstates_url) lines.push(`**URL:** ${result.openstates_url}`);

    if (result.abstracts?.length) {
      lines.push('');
      lines.push('## Summary');
      for (const abs of result.abstracts) {
        lines.push(`${abs.abstract} _(${abs.note})_`);
      }
    }

    if (result.sponsorships?.length) {
      lines.push('');
      lines.push('## Sponsors');
      for (const s of result.sponsorships) {
        const marker = s.primary ? '**Primary**' : 'Cosponsor';
        const person = s.person ? ` [person: ${s.person.name} (${s.person.id})]` : '';
        lines.push(`- ${marker}: ${s.name} (${s.classification}, ${s.entity_type})${person}`);
      }
    }

    if (result.actions?.length) {
      lines.push('');
      lines.push('## Action History');
      for (const a of result.actions) {
        const cls = a.classification.length > 0 ? ` [${a.classification.join(', ')}]` : '';
        lines.push(
          `- #${a.order} ${a.date}: ${a.description}${cls} — ${a.organization.name} (${a.organization.classification})`,
        );
      }
    }

    if (result.votes?.length) {
      lines.push('');
      lines.push('## Votes');
      for (const v of result.votes) {
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

    if (result.versions?.length) {
      lines.push('');
      lines.push('## Bill Text Versions');
      for (const v of result.versions) {
        lines.push(
          `- [${v.id}] ${v.note} (${v.date}): ${v.links.map((l) => `${l.url} [${l.media_type}]`).join(', ')}`,
        );
      }
    }

    if (result.documents?.length) {
      lines.push('');
      lines.push('## Documents');
      for (const d of result.documents) {
        lines.push(
          `- [${d.id}] ${d.note} (${d.date}): ${d.links.map((l) => `${l.url} [${l.media_type}]`).join(', ')}`,
        );
      }
    }

    if (result.related_bills?.length) {
      lines.push('');
      lines.push('## Related Bills');
      for (const r of result.related_bills) {
        lines.push(`- ${r.identifier} (${r.legislative_session}) — ${r.relation_type}`);
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
