/**
 * @fileoverview Tests for the billResearch prompt.
 * @module tests/prompts/bill-research.prompt.test
 */

import { describe, expect, it } from 'vitest';
import { billResearch } from '@/mcp-server/prompts/definitions/bill-research.prompt.js';

describe('billResearch', () => {
  it('generates a user message for the given bill', () => {
    const args = billResearch.args.parse({
      jurisdiction: 'Washington',
      session: '2025',
      bill_id: 'HB 1000',
    });
    const messages = billResearch.generate(args);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content.type).toBe('text');
  });

  it('embeds jurisdiction, session, and bill_id in the prompt text', () => {
    const args = billResearch.args.parse({
      jurisdiction: 'California',
      session: '2023-2024',
      bill_id: 'AB 100',
    });
    const messages = billResearch.generate(args);
    const text = (messages[0].content as { text: string }).text;
    expect(text).toContain('California');
    expect(text).toContain('2023-2024');
    expect(text).toContain('AB 100');
  });

  it('instructs use of openstates tools in the prompt text', () => {
    const args = billResearch.args.parse({
      jurisdiction: 'wa',
      session: '2025',
      bill_id: 'SB 5001',
    });
    const messages = billResearch.generate(args);
    const text = (messages[0].content as { text: string }).text;
    // The prompt references openstates_search_people for sponsor lookup;
    // bill detail fetch is referenced via the include= parameters, not a tool name.
    expect(text).toContain('openstates_search_people');
    expect(text).toContain('openstates tools');
  });

  it('requests include=sponsorships,actions,votes,abstracts,versions in the prompt', () => {
    const args = billResearch.args.parse({
      jurisdiction: 'wa',
      session: '2025',
      bill_id: 'HB 1000',
    });
    const messages = billResearch.generate(args);
    const text = (messages[0].content as { text: string }).text;
    expect(text).toContain('sponsorships');
    expect(text).toContain('actions');
    expect(text).toContain('votes');
    expect(text).toContain('abstracts');
    expect(text).toContain('versions');
  });
});
