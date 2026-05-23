/**
 * @fileoverview Tests for the legislatorProfile prompt.
 * @module tests/prompts/legislator-profile.prompt.test
 */

import { describe, expect, it } from 'vitest';
import { legislatorProfile } from '@/mcp-server/prompts/definitions/legislator-profile.prompt.js';

describe('legislatorProfile', () => {
  it('generates a user message for the given legislator', () => {
    const args = legislatorProfile.args.parse({
      name: 'Jane Smith',
      jurisdiction: 'Washington',
    });
    const messages = legislatorProfile.generate(args);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content.type).toBe('text');
  });

  it('embeds name and jurisdiction in the prompt text', () => {
    const args = legislatorProfile.args.parse({
      name: 'Bob Jones',
      jurisdiction: 'California',
    });
    const messages = legislatorProfile.generate(args);
    const text = (messages[0].content as { text: string }).text;
    expect(text).toContain('Bob Jones');
    expect(text).toContain('California');
  });

  it('instructs use of openstates tools in the prompt text', () => {
    const args = legislatorProfile.args.parse({
      name: 'Smith',
      jurisdiction: 'wa',
    });
    const messages = legislatorProfile.generate(args);
    const text = (messages[0].content as { text: string }).text;
    expect(text).toContain('openstates_search_people');
    expect(text).toContain('openstates_search_bills');
    expect(text).toContain('openstates_search_committees');
  });

  it('requests include=offices,links for contact information', () => {
    const args = legislatorProfile.args.parse({
      name: 'Jane Smith',
      jurisdiction: 'wa',
    });
    const messages = legislatorProfile.generate(args);
    const text = (messages[0].content as { text: string }).text;
    expect(text).toContain('offices');
    expect(text).toContain('links');
  });

  it('covers voting record instructions', () => {
    const args = legislatorProfile.args.parse({
      name: 'Jane Smith',
      jurisdiction: 'wa',
    });
    const messages = legislatorProfile.generate(args);
    const text = (messages[0].content as { text: string }).text;
    expect(text).toContain('openstates_get_bill');
    expect(text).toContain('votes');
  });
});
