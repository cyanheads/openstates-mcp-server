/**
 * @fileoverview Fetch full detail for a specific state bill.
 * @module mcp-server/tools/definitions/get-bill
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline as esc, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

/**
 * The UUID half of an OCD bill ID, 8-4-4-4-12 hex. Fully anchored and fixed-width, and tested
 * only against a segment already checked to be 36 characters, so its cost is bounded regardless
 * of input size.
 */
const BILL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The canonical form of a caller's `openstates_id`, or `undefined` when it cannot name a bill.
 *
 * The value resolves into a request path the way the service's URL builder resolves it — WHATWG
 * parsing strips tab/CR/LF, resolves dot segments, and splits off `?…` and `#…` — and the path is
 * percent-decoded once, as upstream decodes it before routing. Every form that reached a bill
 * before therefore still does. What remains must be one of the two bill-detail routes:
 * `ocd-bill/<uuid>` (case-insensitive, returned lowercase, since upstream's record lookup is
 * case-sensitive) or `<jurisdiction>/<session>/<bill_id>`, each with an optional trailing `/`.
 * Decoding can reintroduce `.`/`..` segments the URL parser never saw, so those are refused rather
 * than handed to the service to resolve.
 */
function canonicalBillId(openstatesId: string): string | undefined {
  const pathname = URL.parse(`https://openstates.invalid/bills/${openstatesId}`)?.pathname;
  if (pathname === undefined) return;
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return; // A malformed percent escape names no route.
  }
  if (!path.startsWith('/bills/')) return;
  const rest = path.slice('/bills/'.length);
  const segments = (rest.endsWith('/') ? rest.slice(0, -1) : rest).split('/');
  const [first = '', second = ''] = segments;
  const isOcdPrefix = first.toLowerCase() === 'ocd-bill';
  if (segments.length === 2 && isOcdPrefix && second.length === 36 && BILL_UUID.test(second)) {
    return `ocd-bill/${second.toLowerCase()}`;
  }
  if (
    segments.length === 3 &&
    !isOcdPrefix &&
    segments.every((s) => s !== '' && s !== '.' && s !== '..')
  ) {
    return segments.join('/');
  }
  return;
}

/**
 * One bill version or document line: the id in literal brackets, the note and date when present,
 * then each link labeled by its media type. The brackets are escaped because with no note or date
 * the line reads `[id]: <link>`, which CommonMark takes as a link reference definition and drops.
 */
function textRecordLine(record: {
  id: string;
  note: string;
  date: string;
  links: { url: string; media_type: string }[];
}): string {
  const links = record.links.map((l) => markdownLink(l.media_type || l.url, l.url)).join(', ');
  const note = record.note ? ` ${esc(record.note)}` : '';
  const date = record.date ? ` (${esc(record.date)})` : '';
  return `- \\[${esc(record.id)}\\]${note}${date}: ${links}`;
}

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
        'OCD bill ID from openstates_search_bills results: "ocd-bill/" followed by a UUID (e.g., "ocd-bill/4f255ccf-42a6-46ad-bbc6-0b027ebb15f2"). Preferred over the three-part path when available.',
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
    updated_at: z
      .string()
      .optional()
      .describe(
        'Timestamp Open States last updated this record — the field openstates_search_bills sorts by under the default sort=updated_desc.',
      ),
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
                id: z
                  .string()
                  .describe(
                    'OCD person ID. Pass it to openstates_search_people as id for the full legislator record, or back to openstates_search_bills as the sponsor filter for their other bills.',
                  ),
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
            date: z
              .string()
              .describe('Action date. Empty string when Open States recorded no date.'),
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
            start_date: z
              .string()
              .describe('Vote date. Empty string when Open States recorded no date.'),
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
            note: z
              .string()
              .describe('Source note. Empty string when Open States recorded no note.'),
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
            note: z
              .string()
              .describe('Version note. Empty string when Open States recorded no note.'),
            date: z
              .string()
              .describe(
                'Version date. Empty string when Open States recorded no date, which is the usual case for bill versions.',
              ),
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
            note: z
              .string()
              .describe('Document note. Empty string when Open States recorded no note.'),
            date: z
              .string()
              .describe(
                'Document date. Empty string when Open States recorded no date, which is the usual case for bill documents.',
              ),
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
    other_titles: z
      .array(
        z
          .object({
            title: z.string().describe('Alternate bill title.'),
            note: z
              .string()
              .describe(
                'Note describing the alternate title. Empty string when Open States recorded no note.',
              ),
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
            scheme: z
              .string()
              .optional()
              .describe(
                'Identifier scheme (the issuing system). Absent for bills — Open States omits it on every bill record observed.',
              ),
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
            note: z
              .string()
              .describe('Source note. Empty string when Open States recorded no note.'),
          })
          .describe('Source record.'),
      )
      .optional()
      .describe('Source documents when include=sources is requested.'),
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
      reason: 'invalid_openstates_id',
      code: JsonRpcErrorCode.ValidationError,
      when: 'openstates_id is not an Open States bill ID — neither "ocd-bill/" followed by a UUID nor a jurisdiction/session/bill_id path.',
      recovery:
        'Copy the id field ("ocd-bill/" followed by a UUID) from an openstates_search_bills result and pass it unchanged, or look the bill up with jurisdiction, session, and bill_id instead.',
    },
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No bill exists at the given OCD bill ID or jurisdiction + session + bill_id path.',
      recovery:
        'Find the bill with openstates_search_bills and pass its id as openstates_id. For a jurisdiction + session + bill_id lookup, also confirm the session identifier with openstates_get_jurisdiction (include=legislative_sessions).',
    },
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout.',
      recovery:
        'Retry the lookup once; if it repeats, request fewer include values — votes, versions, and documents each enlarge the upstream response.',
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
    // Blank means omitted, so a whitespace-only id falls through to the path triple.
    const rawId = input.openstates_id?.trim();
    const openstatesId = rawId ? canonicalBillId(rawId) : undefined;
    if (rawId && openstatesId === undefined) {
      throw ctx.fail(
        'invalid_openstates_id',
        'The openstates_id value is not an Open States bill ID. Bill IDs are "ocd-bill/" followed by a UUID — copy one from an openstates_search_bills result.',
      );
    }

    const lookup = openstatesId
      ? ({ kind: 'id', openstatesId } as const)
      : input.jurisdiction && input.session && input.bill_id
        ? ({
            kind: 'path',
            jurisdiction: input.jurisdiction,
            session: input.session,
            billId: input.bill_id,
          } as const)
        : undefined;

    if (!lookup) {
      throw ctx.fail(
        'missing_lookup_params',
        'Provide openstates_id OR jurisdiction + session + bill_id.',
      );
    }

    const svc = getOpenStatesApiService();
    const include = input.include && input.include.length > 0 ? input.include : undefined;

    const bill = await (lookup.kind === 'id'
      ? svc.getBillById(lookup.openstatesId, include, ctx)
      : svc.getBillByPath(lookup.jurisdiction, lookup.session, lookup.billId, include, ctx)
    ).catch((err: unknown) => {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        const id =
          lookup.kind === 'id'
            ? lookup.openstatesId
            : `${lookup.jurisdiction}/${lookup.session}/${lookup.billId}`;
        throw ctx.fail('not_found', `Bill not found: ${id}`);
      }
      throw err;
    });

    ctx.log.info('Fetched bill', { id: bill.id, identifier: bill.identifier });
    return bill;
  },

  /**
   * Every upstream string goes through `esc` (`escapeMarkdownInline`) and every URL field through
   * `markdownLink`, labeled by the record's own note or media type when it has one, so a
   * CommonMark parse of `content[]` reads back the values `structuredContent` carries.
   */
  format: (result) => {
    const lines: string[] = [
      `# ${esc(result.identifier)} — ${esc(result.title)}`,
      `**ID:** ${esc(result.id)}`,
      `**Session:** ${esc(result.session)} | **Jurisdiction:** ${esc(result.jurisdiction.name)} (${esc(result.jurisdiction.id)})`,
      `**Chamber:** ${esc(result.from_organization.name)} (${esc(result.from_organization.classification)})`,
    ];
    if (result.classification.length > 0)
      lines.push(`**Classification:** ${result.classification.map(esc).join(', ')}`);
    if (result.subject.length > 0)
      lines.push(`**Subjects:** ${result.subject.map(esc).join(', ')}`);
    if (result.first_action_date) lines.push(`**First action:** ${esc(result.first_action_date)}`);
    if (result.latest_action_date) {
      const description =
        result.latest_action_description === null ? 'N/A' : esc(result.latest_action_description);
      lines.push(`**Latest action:** ${esc(result.latest_action_date)} — ${description}`);
    }
    if (result.latest_passage_date) lines.push(`**Passed:** ${esc(result.latest_passage_date)}`);
    if (result.updated_at) lines.push(`**Updated:** ${esc(result.updated_at)}`);
    if (result.openstates_url) {
      lines.push(`**URL:** ${markdownLink(result.openstates_url, result.openstates_url)}`);
    }

    if (result.abstracts?.length) {
      lines.push('');
      lines.push('## Summary');
      for (const abs of result.abstracts) {
        lines.push(`${esc(abs.abstract)}${abs.note ? ` _(${esc(abs.note)})_` : ''}`);
      }
    }

    if (result.sponsorships?.length) {
      lines.push('');
      lines.push('## Sponsors');
      for (const s of result.sponsorships) {
        const marker = s.primary ? '**Primary**' : 'Cosponsor';
        const person = s.person ? ` [person: ${esc(s.person.name)} (${esc(s.person.id)})]` : '';
        lines.push(
          `- ${marker}: ${esc(s.name)} (${esc(s.classification)}, ${esc(s.entity_type)})${person}`,
        );
      }
    }

    if (result.actions?.length) {
      lines.push('');
      lines.push('## Action History');
      for (const a of result.actions) {
        const cls = a.classification.length > 0 ? ` [${a.classification.map(esc).join(', ')}]` : '';
        lines.push(
          `- #${a.order}${a.date ? ` ${esc(a.date)}` : ''}: ${esc(a.description)}${cls} — ${esc(a.organization.name)} (${esc(a.organization.classification)})`,
        );
      }
    }

    if (result.votes?.length) {
      lines.push('');
      lines.push('## Votes');
      for (const v of result.votes) {
        lines.push(`### ${esc(v.motion_text)}${v.start_date ? ` (${esc(v.start_date)})` : ''}`);
        lines.push(
          `**Result:** ${esc(v.result)} | **ID:** ${esc(v.id)} | **Identifier:** ${esc(v.identifier)}`,
        );
        const counts = v.counts.map((c) => `${esc(c.option)}: ${c.value}`).join(', ');
        lines.push(`**Tally:** ${counts}`);
        if (v.votes.length > 0) {
          lines.push('**Individual votes:**');
          for (const pv of v.votes) {
            const voterLink = pv.voter
              ? ` (ID: ${esc(pv.voter.id)}, name: ${esc(pv.voter.name)})`
              : '';
            lines.push(`- ${esc(pv.voter_name)}${voterLink}: ${esc(pv.option)}`);
          }
        }
      }
    }

    if (result.versions?.length) {
      lines.push('');
      lines.push('## Bill Text Versions');
      for (const v of result.versions) lines.push(textRecordLine(v));
    }

    if (result.documents?.length) {
      lines.push('');
      lines.push('## Documents');
      for (const d of result.documents) lines.push(textRecordLine(d));
    }

    if (result.related_bills?.length) {
      lines.push('');
      lines.push('## Related Bills');
      for (const r of result.related_bills) {
        lines.push(
          `- ${esc(r.identifier)} (${esc(r.legislative_session)}) — ${esc(r.relation_type)}`,
        );
      }
    }

    if (result.other_titles?.length) {
      lines.push('');
      lines.push('## Other Titles');
      for (const t of result.other_titles) {
        lines.push(`- ${esc(t.title)}${t.note ? ` _(${esc(t.note)})_` : ''}`);
      }
    }

    if (result.other_identifiers?.length) {
      lines.push('');
      lines.push('## Other Identifiers');
      for (const oi of result.other_identifiers) {
        lines.push(`- ${esc(oi.identifier)}${oi.scheme ? ` (${esc(oi.scheme)})` : ''}`);
      }
    }

    if (result.sources?.length) {
      lines.push('');
      lines.push('## Sources');
      for (const s of result.sources) lines.push(`- ${markdownLink(s.note || s.url, s.url)}`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
