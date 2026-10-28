/**
 * @fileoverview Fetch full committee detail by OCD organization ID (experimental).
 * @module mcp-server/tools/definitions/get-committee
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { getOpenStatesApiService } from '@/services/openstates/openstates-service.js';

const CommitteeIncludeEnum = z.enum(['memberships', 'links', 'sources']);

export const getCommittee = tool('openstates_get_committee', {
  title: 'Get Committee',
  description:
    'Fetch committee detail by OCD organization ID. Returns name, classification, and membership roster when include=memberships is requested. Experimental — not all states have committee data in Open States. Obtain the committee_id from openstates_search_committees.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    committee_id: z
      .string()
      .min(1)
      .describe('OCD organization ID (from openstates_search_committees results).'),
    include: z
      .array(CommitteeIncludeEnum)
      .optional()
      .describe(
        'Related data to inline. "memberships" includes the full roster with member roles. "links" includes the committee homepage and reference links, and "sources" the provenance URLs behind the record.',
      ),
  }),
  output: z.object({
    id: z.string().describe('OCD organization ID.'),
    name: z.string().describe('Committee name.'),
    classification: z.string().describe('Committee classification: "committee" or "subcommittee".'),
    parent_id: z
      .string()
      .nullable()
      .describe('OCD ID of parent committee, or null for top-level committees.'),
    memberships: z
      .array(
        z
          .object({
            person_id: z
              .string()
              .describe(
                'OCD person ID of the member — pass it to openstates_search_people as id for the full record. Empty string when the membership carries no linked person.',
              ),
            person_name: z
              .string()
              .describe('Member name. Empty string when Open States recorded none.'),
            role: z
              .string()
              .describe(
                'Member role (e.g., "chair", "member"). Empty string when Open States recorded none.',
              ),
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
            note: z
              .string()
              .describe(
                'Link description (e.g., "homepage"). Empty string when Open States recorded no description.',
              ),
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
            note: z
              .string()
              .describe('Source note. Empty string when Open States recorded no note.'),
          })
          .describe('Source record.'),
      )
      .optional()
      .describe('Provenance sources when include=sources is requested.'),
  }),
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'Committee ID does not exist in Open States.',
      recovery:
        'Use openstates_search_committees to discover valid committee IDs for a jurisdiction. Note that committee data is experimental and not all states have coverage.',
    },
    {
      reason: 'upstream_timeout',
      code: JsonRpcErrorCode.Timeout,
      when: 'Open States did not answer within the per-request timeout.',
      recovery:
        'Retry the lookup once; if it repeats, request fewer include values — memberships is the one that enlarges the upstream response.',
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
    const committee = await svc
      .getCommittee(
        input.committee_id,
        input.include && input.include.length > 0 ? input.include : undefined,
        ctx,
      )
      .catch((err: unknown) => {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw ctx.fail('not_found', `Committee not found: ${input.committee_id}`);
        }
        throw err;
      });
    ctx.log.info('Fetched committee', { id: committee.id, name: committee.name });
    return {
      id: committee.id,
      name: committee.name,
      classification: committee.classification,
      parent_id: committee.parent_id,
      ...(committee.memberships ? { memberships: committee.memberships } : {}),
      ...(committee.links ? { links: committee.links } : {}),
      ...(committee.sources ? { sources: committee.sources } : {}),
    };
  },

  format: (result) => {
    const e = escapeMarkdownInline;
    const lines: string[] = [
      `# ${e(result.name)}`,
      `**ID:** ${e(result.id)}`,
      `**Classification:** ${e(result.classification)}`,
    ];
    if (result.parent_id) lines.push(`**Parent ID:** ${e(result.parent_id)}`);
    if (result.memberships?.length) {
      lines.push('');
      lines.push('## Members');
      for (const m of result.memberships) {
        const role = m.role ? ` (${e(m.role)})` : '';
        const id = m.person_id ? ` — ID: ${e(m.person_id)}` : '';
        lines.push(`- ${e(m.person_name)}${role}${id}`);
      }
    }
    if (result.links?.length) {
      lines.push('');
      lines.push('## Links');
      for (const l of result.links) lines.push(`- ${markdownLink(l.note || l.url, l.url)}`);
    }
    if (result.sources?.length) {
      lines.push('');
      lines.push('## Sources');
      for (const s of result.sources) lines.push(`- ${markdownLink(s.note || s.url, s.url)}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
