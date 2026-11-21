/**
 * @fileoverview Open States roll calls shared by the two bill tools.
 * @module mcp-server/tools/bill-votes
 */
import { z } from '@cyanheads/mcp-ts-core';
import { escapeMarkdownInline as esc } from '@cyanheads/mcp-ts-core/utils';

/** A bill's vote events, present when the caller requests votes. */
export const billVotes = z
  .array(
    z
      .object({
        id: z.string().describe('Vote event ID.'),
        motion_text: z.string().describe('Motion text.'),
        motion_classification: z
          .array(z.string())
          .nullish()
          .describe('Motion classifications recorded on this vote, in source order.'),
        organization: z
          .object({
            id: z.string().nullish().describe('OCD organization ID of the voting body.'),
            name: z.string().nullish().describe('Name of the voting body.'),
            classification: z
              .string()
              .nullish()
              .describe('Classification of the voting body, such as upper, lower, or committee.'),
          })
          .nullish()
          .describe('Organization that held this vote when recorded.'),
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
  .describe('Vote events when include=votes is requested.');

/** Renders one roll call with its voting body, motion, tally and positions. */
export function formatVote(v: NonNullable<z.infer<typeof billVotes>>[number]): string[] {
  const lines = [`### ${esc(v.motion_text)}${v.start_date ? ` (${esc(v.start_date)})` : ''}`];
  if (v.organization !== undefined) {
    const fields = Object.entries(v.organization ?? {}).map(
      ([key, value]) => `${key}: ${value ? esc(value) : JSON.stringify(value)}`,
    );
    lines.push(`**Voting organization:** ${fields.join(' · ') || JSON.stringify(v.organization)}`);
  }
  if (v.motion_classification !== undefined) {
    const classes = v.motion_classification?.length
      ? v.motion_classification.map((value) => (value ? esc(value) : '""')).join(', ')
      : JSON.stringify(v.motion_classification);
    lines.push(`**Motion classification:** ${classes}`);
  }
  lines.push(
    `**Result:** ${esc(v.result)} | **ID:** ${esc(v.id)} | **Identifier:** ${esc(v.identifier)}`,
  );
  const counts = v.counts.map((c) => `${esc(c.option)}: ${c.value}`).join(', ');
  lines.push(`**Tally:** ${counts}`);
  if (v.votes.length > 0) {
    lines.push('**Individual votes:**');
    for (const pv of v.votes) {
      const voterLink = pv.voter ? ` (ID: ${esc(pv.voter.id)}, name: ${esc(pv.voter.name)})` : '';
      lines.push(`- ${esc(pv.voter_name)}${voterLink}: ${esc(pv.option)}`);
    }
  }
  return lines;
}
