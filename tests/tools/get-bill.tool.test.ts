/**
 * @fileoverview Tests for the getBill tool.
 * @module tests/tools/get-bill.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBill } from '@/mcp-server/tools/definitions/get-bill.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
  getOpenStatesApiService: vi.fn(),
}));

const mockBill = {
  id: 'ocd-bill/12345',
  identifier: 'HB 1000',
  title: 'An act relating to public safety',
  session: '2025',
  jurisdiction: {
    id: 'ocd-jurisdiction/country:us/state:wa/government',
    name: 'Washington',
  },
  from_organization: { name: 'House', classification: 'lower' },
  classification: ['bill'],
  subject: ['public safety'],
  first_action_date: '2025-01-14',
  latest_action_date: '2025-03-10',
  latest_action_description: 'Passed Senate',
  latest_passage_date: '2025-03-10',
  openstates_url: 'https://openstates.org/wa/bills/2025/HB1000/',
};

describe('getBill', () => {
  let mockService: {
    getBillById: ReturnType<typeof vi.fn>;
    getBillByPath: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      getBillById: vi.fn().mockResolvedValue(mockBill),
      getBillByPath: vi.fn().mockResolvedValue(mockBill),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('fetches bill by openstates_id', async () => {
    const ctx = createMockContext();
    const input = getBill.input.parse({ openstates_id: 'ocd-bill/12345' });
    const result = await getBill.handler(input, ctx);
    expect(result.id).toBe('ocd-bill/12345');
    expect(result.identifier).toBe('HB 1000');
    expect(mockService.getBillById).toHaveBeenCalledWith('ocd-bill/12345', undefined, ctx);
  });

  it('fetches bill by path (jurisdiction + session + bill_id)', async () => {
    const ctx = createMockContext();
    const input = getBill.input.parse({
      jurisdiction: 'wa',
      session: '2025',
      bill_id: 'HB 1000',
    });
    const result = await getBill.handler(input, ctx);
    expect(result.id).toBe('ocd-bill/12345');
    expect(mockService.getBillByPath).toHaveBeenCalledWith('wa', '2025', 'HB 1000', undefined, ctx);
  });

  it('throws missing_lookup_params when neither openstates_id nor path triple is provided', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ include: ['sponsorships'] });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_lookup_params' },
    });
  });

  it('throws missing_lookup_params for incomplete path (missing bill_id)', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ jurisdiction: 'wa', session: '2025' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_lookup_params' },
    });
  });

  it('passes include array to service when provided', async () => {
    const billWithVotes = {
      ...mockBill,
      votes: [
        {
          id: 'vote-1',
          motion_text: 'Pass the bill',
          start_date: '2025-03-10',
          result: 'pass',
          identifier: 'HB1000-vote-1',
          counts: [
            { option: 'yes', value: 75 },
            { option: 'no', value: 22 },
          ],
          votes: [{ id: 'pv-1', option: 'yes', voter_name: 'Representative A', voter: undefined }],
        },
      ],
    };
    mockService.getBillById.mockResolvedValue(billWithVotes);

    const ctx = createMockContext();
    const input = getBill.input.parse({ openstates_id: 'ocd-bill/12345', include: ['votes'] });
    const result = await getBill.handler(input, ctx);
    expect(result.votes).toBeDefined();
    expect(result.votes?.[0].result).toBe('pass');
  });

  it('formats output with id, identifier, jurisdiction, and url', () => {
    const blocks = getBill.format!(mockBill);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('HB 1000');
    expect(text).toContain('ocd-bill/12345');
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
    expect(text).toContain('https://openstates.org/wa/bills/2025/HB1000/');
  });

  it('formats sponsorships when present', () => {
    const result = {
      ...mockBill,
      sponsorships: [
        {
          id: 'sp-1',
          name: 'Jane Smith',
          entity_type: 'person',
          primary: true,
          classification: 'primary',
          person: { id: 'ocd-person/abc', name: 'Jane Smith' },
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane Smith');
    expect(text).toContain('ocd-person/abc');
  });

  it('formats votes when present', () => {
    const result = {
      ...mockBill,
      votes: [
        {
          id: 'vote-1',
          motion_text: 'Passage of HB 1000',
          start_date: '2025-03-10',
          result: 'pass',
          identifier: 'HB1000-vote-1',
          counts: [
            { option: 'yes', value: 75 },
            { option: 'no', value: 22 },
          ],
          votes: [{ id: 'pv-1', option: 'yes', voter_name: 'Rep. A' }],
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('vote-1');
    expect(text).toContain('Passage of HB 1000');
    expect(text).toContain('yes: 75');
    expect(text).toContain('Rep. A');
  });

  it('handles sparse bill without optional fields', () => {
    const sparseBill = {
      id: 'ocd-bill/sparse',
      identifier: 'SB 1',
      title: 'Sparse bill',
      session: '2025',
      jurisdiction: { id: 'ocd-jurisdiction/country:us/state:wa/government', name: 'Washington' },
      from_organization: { name: 'Senate', classification: 'upper' },
      classification: [],
      subject: [],
      first_action_date: null,
      latest_action_date: null,
      latest_action_description: null,
      latest_passage_date: null,
    };
    const blocks = getBill.format!(sparseBill);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('ocd-bill/sparse');
    expect(text).toContain('SB 1');
  });
});
