/**
 * @fileoverview Fetch full committee detail by OCD organization ID (experimental).
 * @module mcp-server/tools/definitions/get-committee
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
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
        'Related data to inline. "memberships" includes the full roster with member roles.',
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
            person_id: z.string().describe('OCD person ID of the member.'),
            person_name: z.string().describe('Member name.'),
            role: z.string().describe('Member role (e.g., "chair", "member").'),
          })
          .describe('Committee membership record.'),
      )
      .optional()
      .describe('Membership roster when include=memberships is requested.'),
  }),
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'Committee ID does not exist in Open States.',
      recovery:
        'Use openstates_search_committees to discover valid committee IDs for a jurisdiction. Note that committee data is experimental and not all states have coverage.',
    },
  ],

  async handler(input, ctx) {
    const svc = getOpenStatesApiService();
    const committee = await svc.getCommittee(
      input.committee_id,
      input.include && input.include.length > 0 ? input.include : undefined,
      ctx,
    );
    ctx.log.info('Fetched committee', { id: committee.id, name: committee.name });
    return {
      id: committee.id,
      name: committee.name,
      classification: committee.classification,
      parent_id: committee.parent_id,
      ...(committee.memberships ? { memberships: committee.memberships } : {}),
    };
  },

  format: (result) => {
    const lines: string[] = [
      `# ${result.name}`,
      `**ID:** ${result.id}`,
      `**Classification:** ${result.classification}`,
    ];
    if (result.parent_id) lines.push(`**Parent ID:** ${result.parent_id}`);
    if (result.memberships?.length) {
      lines.push('');
      lines.push('## Members');
      for (const m of result.memberships) {
        lines.push(`- ${m.person_name} (${m.role}) — ID: ${m.person_id}`);
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
