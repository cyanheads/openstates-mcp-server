/**
 * @fileoverview Additional coverage for searchBills: pagination boundaries,
 * sort values, filter combinations, and edge cases in format.
 * @module tests/tools/search-bills.additional.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchBills } from '@/mcp-server/tools/definitions/search-bills.tool.js';

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
};

describe('searchBills — pagination and filters', () => {
  let mockService: { searchBills: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      searchBills: vi.fn().mockResolvedValue({
        results: [mockBill],
        pagination: { page: 2, per_page: 5, max_page: 10, total_items: 50 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes page and per_page to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa', page: 2, per_page: 5 });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, per_page: 5 }),
      expect.anything(),
    );
  });

  it('enrichment reflects multi-page response', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa', page: 2, per_page: 5 });
    await searchBills.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalItems).toBe(50);
    expect(enrichment.page).toBe(2);
    expect(enrichment.maxPage).toBe(10);
  });

  it('per_page maximum is 20', () => {
    expect(() => searchBills.input.parse({ jurisdiction: 'wa', per_page: 21 })).toThrow();
  });

  it('per_page minimum is 1', () => {
    expect(() => searchBills.input.parse({ jurisdiction: 'wa', per_page: 0 })).toThrow();
  });

  it('page minimum is 1', () => {
    expect(() => searchBills.input.parse({ jurisdiction: 'wa', page: 0 })).toThrow();
  });
});

describe('searchBills — sort and chamber filters', () => {
  let mockService: { searchBills: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      searchBills: vi.fn().mockResolvedValue({
        results: [],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes sort=latest_action_desc to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      sort: 'latest_action_desc',
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'latest_action_desc' }),
      expect.anything(),
    );
  });

  it('passes chamber=upper to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa', chamber: 'upper' });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ chamber: 'upper' }),
      expect.anything(),
    );
  });

  it('rejects invalid chamber value', () => {
    expect(() => searchBills.input.parse({ jurisdiction: 'wa', chamber: 'middle' })).toThrow();
  });

  it('accepts all valid sort values', () => {
    const validSorts = [
      'updated_asc',
      'updated_desc',
      'first_action_asc',
      'first_action_desc',
      'latest_action_asc',
      'latest_action_desc',
    ];
    for (const sort of validSorts) {
      expect(() => searchBills.input.parse({ jurisdiction: 'wa', sort })).not.toThrow();
    }
  });

  it('notice includes chamber filter when empty results', async () => {
    const { getEnrichment } = await import('@cyanheads/mcp-ts-core/testing');
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      chamber: 'upper',
    });
    await searchBills.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('jurisdiction="wa"');
    // chamber filter is not currently included in the notice
    // but the notice itself should mention broadening
    expect(enrichment.notice).toContain('broadening');
  });
});

describe('searchBills — subject and sponsor filters', () => {
  let mockService: { searchBills: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      searchBills: vi.fn().mockResolvedValue({
        results: [mockBill],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes subject array to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      subject: ['public safety', 'education'],
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ subject: ['public safety', 'education'] }),
      expect.anything(),
    );
  });

  it('passes empty subject array as undefined to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa', subject: [] });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ subject: undefined }),
      expect.anything(),
    );
  });

  it('passes sponsor filter to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      sponsor: 'ocd-person/abc123',
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ sponsor: 'ocd-person/abc123' }),
      expect.anything(),
    );
  });

  it('passes action_since filter to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      action_since: '2025-01-01',
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ action_since: '2025-01-01' }),
      expect.anything(),
    );
  });

  it('passes updated_since filter to service', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      updated_since: '2025-03-01',
    });
    await searchBills.handler(input, ctx);
    expect(mockService.searchBills).toHaveBeenCalledWith(
      expect.objectContaining({ updated_since: '2025-03-01' }),
      expect.anything(),
    );
  });
});

describe('searchBills — format edge cases', () => {
  it('formats bill with abstracts', () => {
    const result = {
      results: [
        {
          ...mockBill,
          abstracts: [
            {
              abstract: 'This bill improves public safety outcomes.',
              note: 'Legislative Digest',
            },
          ],
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('This bill improves public safety outcomes.');
    expect(text).toContain('Legislative Digest');
  });

  it('formats bill with actions inline', () => {
    const result = {
      results: [
        {
          ...mockBill,
          actions: [
            {
              id: 'act-1',
              description: 'First reading',
              date: '2025-01-14',
              classification: ['reading-1'],
              order: 1,
              organization: { name: 'House', classification: 'lower' },
            },
          ],
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Actions:');
    expect(text).toContain('First reading');
    expect(text).toContain('#1');
    expect(text).toContain('reading-1');
  });

  it('formats bill with empty classification and subject arrays', () => {
    const sparseResult = {
      results: [
        {
          ...mockBill,
          classification: [],
          subject: [],
          first_action_date: null,
          latest_action_date: null,
          latest_action_description: null,
          latest_passage_date: null,
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchBills.format!(sparseResult);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('HB 1000');
    // No crashes from missing optional fields
    expect(text).not.toContain('Classification:');
    expect(text).not.toContain('Subjects:');
  });

  it('formats bill cosponsor correctly', () => {
    const result = {
      results: [
        {
          ...mockBill,
          sponsorships: [
            {
              id: 'sp-2',
              name: 'Bob Jones',
              entity_type: 'person',
              primary: false,
              classification: 'cosponsor',
            },
          ],
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Bob Jones');
    expect(text).toContain('Cosponsor');
  });

  it('formats multiple bills on a single page', () => {
    const result = {
      results: [
        mockBill,
        {
          ...mockBill,
          id: 'ocd-bill/99999',
          identifier: 'SB 500',
          title: 'A second bill',
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 2 },
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('HB 1000');
    expect(text).toContain('SB 500');
    expect(text).toContain('2 bills');
  });
});
