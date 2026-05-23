/**
 * @fileoverview Research framework for profiling a state legislator.
 * @module mcp-server/prompts/definitions/legislator-profile
 */

import { prompt, z } from '@cyanheads/mcp-ts-core';

export const legislatorProfile = prompt('openstates_legislator_profile', {
  description:
    'Research framework for profiling a legislator: sponsored bills, committee assignments, voting record, and contact details. Produces a structured profile for constituent research, advocacy, or journalistic purposes.',
  args: z.object({
    name: z.string().describe('Legislator name or partial name (e.g., "Smith", "Jane Smith").'),
    jurisdiction: z
      .string()
      .describe('State name, abbreviation, or OCD-ID (e.g., "Washington", "wa").'),
  }),
  generate: (args) => [
    {
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Research and profile the following state legislator:`,
          ``,
          `**Name:** ${args.name}`,
          `**Jurisdiction:** ${args.jurisdiction}`,
          ``,
          `Use the openstates tools to gather the following and produce a structured profile:`,
          ``,
          `1. **Identity & Role** — Use openstates_search_people (name + jurisdiction, include=offices,links)`,
          `   - Full name, party, chamber, district`,
          `   - Contact information (phone, office address, email)`,
          `   - Website and social media links`,
          ``,
          `2. **Sponsored Legislation** — Use openstates_search_bills (jurisdiction + sponsor=name)`,
          `   - Bills sponsored in the current session`,
          `   - Primary vs. co-sponsorships`,
          `   - Key subject areas and recurring themes`,
          ``,
          `3. **Committee Assignments** — Use openstates_search_committees (jurisdiction, include=memberships)`,
          `   - Look for their name in membership rosters`,
          `   - Note chair/ranking member positions when applicable`,
          `   - Note: committee data is experimental and may not be available for all states`,
          ``,
          `4. **Voting Record** — Use openstates_search_bills to find notable bills in their jurisdiction, then openstates_get_bill with include=votes`,
          `   - Voting patterns on major legislation`,
          `   - Party-line vs. cross-aisle votes`,
          ``,
          `5. **Profile Summary** — Synthesize into a brief profile covering:`,
          `   - Legislative priorities based on sponsored bills`,
          `   - Policy positions inferred from voting record`,
          `   - Key constituent services information`,
        ].join('\n'),
      },
    },
  ],
});
