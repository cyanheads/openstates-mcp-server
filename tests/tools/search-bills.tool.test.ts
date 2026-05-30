/**
 * @fileoverview Tests for the searchBills tool.
 * @module tests/tools/search-bills.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
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

const mockBillListResult = {
  results: [mockBill],
  pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
};

describe('searchBills', () => {
  let mockService: { searchBills: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { searchBills: vi.fn().mockResolvedValue(mockBillListResult) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns bills for a valid jurisdiction', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa' });
    const result = await searchBills.handler(input, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('ocd-bill/12345');
    expect(result.results[0].identifier).toBe('HB 1000');
    expect(result.pagination.total_items).toBe(1);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalItems).toBe(1);
    expect(enrichment.page).toBe(1);
    expect(enrichment.maxPage).toBe(1);
  });

  it('returns bills for a full-text query', async () => {
    const ctx = createMockContext();
    const input = searchBills.input.parse({ q: 'public safety' });
    const result = await searchBills.handler(input, ctx);
    expect(result.results).toHaveLength(1);
  });

  it('throws missing_scope when neither jurisdiction nor q is provided', async () => {
    const ctx = createMockContext({ errors: searchBills.errors });
    const input = searchBills.input.parse({ session: '2025' });
    await expect(searchBills.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_scope' },
    });
  });

  it('returns empty results with enrichment notice when no bills match', async () => {
    mockService.searchBills.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext();
    const input = searchBills.input.parse({ jurisdiction: 'wa', session: 'badSession' });
    const result = await searchBills.handler(input, ctx);
    expect(result.results).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalItems).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('No bills matched');
  });

  it('includes sponsorships and actions when requested', async () => {
    const billWithData = {
      ...mockBill,
      sponsorships: [
        {
          id: 'sp-1',
          name: 'Jane Smith',
          entity_type: 'person',
          primary: true,
          classification: 'primary',
        },
      ],
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
    };
    mockService.searchBills.mockResolvedValue({
      results: [billWithData],
      pagination: mockBillListResult.pagination,
    });

    const ctx = createMockContext();
    const input = searchBills.input.parse({
      jurisdiction: 'wa',
      include: ['sponsorships', 'actions'],
    });
    const result = await searchBills.handler(input, ctx);
    expect(result.results[0].sponsorships).toBeDefined();
    expect(result.results[0].actions).toBeDefined();
    expect(result.results[0].sponsorships?.[0].name).toBe('Jane Smith');
    expect(result.results[0].actions?.[0].description).toBe('First reading');
  });

  it('formats output with bill id, identifier, and jurisdiction', () => {
    const result = {
      results: [mockBill],
      pagination: mockBillListResult.pagination,
    };
    const blocks = searchBills.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('HB 1000');
    expect(text).toContain('ocd-bill/12345');
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
    expect(text).toContain('1 bills');
  });

  it('formats empty results without error', () => {
    const result = {
      results: [],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('0 bills');
  });

  it('formats sponsorships inline when present', () => {
    const result = {
      results: [
        {
          ...mockBill,
          sponsorships: [
            {
              id: 'sp-1',
              name: 'Jane Smith',
              entity_type: 'person',
              primary: true,
              classification: 'primary',
            },
          ],
        },
      ],
      pagination: mockBillListResult.pagination,
    };
    const blocks = searchBills.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane Smith');
  });

  it('handles sparse upstream bill without optional fields', () => {
    const sparseResult = {
      results: [
        {
          id: 'ocd-bill/sparse',
          identifier: 'SB 5',
          title: 'A sparse bill',
          session: '2025',
          jurisdiction: {
            id: 'ocd-jurisdiction/country:us/state:wa/government',
            name: 'Washington',
          },
          from_organization: { name: 'Senate', classification: 'upper' },
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
    expect(text).toContain('ocd-bill/sparse');
    expect(text).toContain('SB 5');
  });
});
