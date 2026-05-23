/**
 * @fileoverview Structured framework for analyzing a state bill.
 * @module mcp-server/prompts/definitions/bill-research
 */

import { prompt, z } from '@cyanheads/mcp-ts-core';

export const billResearch = prompt('openstates_bill_research', {
  description:
    'Structured framework for analyzing a state bill: summary, sponsors, committee referrals, action timeline, vote record, and related legislation. Produces a comprehensive research brief.',
  args: z.object({
    jurisdiction: z
      .string()
      .describe('State name, abbreviation, or OCD-ID (e.g., "Washington", "wa").'),
    session: z
      .string()
      .describe(
        'Session identifier (e.g., "2025", "2025rs"). Use openstates_get_jurisdiction to confirm.',
      ),
    bill_id: z
      .string()
      .describe('Bill identifier as used by the legislature (e.g., "HB 1000", "SB 42").'),
  }),
  generate: (args) => [
    {
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Research the following state bill and produce a comprehensive analysis brief:`,
          ``,
          `**Jurisdiction:** ${args.jurisdiction}`,
          `**Session:** ${args.session}`,
          `**Bill ID:** ${args.bill_id}`,
          ``,
          `Use the openstates tools to gather the following information and structure your response:`,
          ``,
          `1. **Bill Overview** — Fetch full bill detail with include=sponsorships,actions,votes,abstracts,versions`,
          `   - Title and official identifier`,
          `   - Plain-language summary (from abstracts if available, otherwise synthesize from title and actions)`,
          `   - Bill classification and subject tags`,
          ``,
          `2. **Sponsors** — Primary and co-sponsors with party affiliation`,
          `   - Use openstates_search_people to look up sponsor profiles if needed`,
          ``,
          `3. **Legislative History** — Chronological action timeline`,
          `   - Introduction date and originating chamber`,
          `   - Committee referrals`,
          `   - Hearings and amendments`,
          `   - Chamber passage dates`,
          `   - Current status`,
          ``,
          `4. **Vote Record** — If votes are available:`,
          `   - Motion, result, and tally (yes/no/absent counts)`,
          `   - Notable yea/nay positions`,
          ``,
          `5. **Related Legislation** — Companion bills, identical bills, or related measures`,
          ``,
          `6. **Bill Text** — Links to the latest enrolled or introduced version`,
          ``,
          `7. **Assessment** — Based on action history and vote record:`,
          `   - Current probability of passage`,
          `   - Key obstacles or supporters`,
          `   - Expected next steps`,
        ].join('\n'),
      },
    },
  ],
});
