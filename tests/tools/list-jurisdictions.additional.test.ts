/**
 * @fileoverview Additional coverage for listJurisdictions: classification filter,
 * empty results, per_page boundary, and format edge cases.
 * @module tests/tools/list-jurisdictions.additional.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listJurisdictions } from '@/mcp-server/tools/definitions/list-jurisdictions.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
  getOpenStatesApiService: vi.fn(),
}));

const mockJurisdiction = {
  id: 'ocd-jurisdiction/country:us/state:wa/government',
  name: 'Washington',
  classification: 'government',
  url: 'https://leg.wa.gov',
  latest_bill_update: '2025-05-20T10:00:00Z',
  latest_people_update: '2025-05-19T08:00:00Z',
};

describe('listJurisdictions — filters and pagination', () => {
  let mockService: { listJurisdictions: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      listJurisdictions: vi.fn().mockResolvedValue({
        results: [mockJurisdiction],
        pagination: { page: 1, per_page: 52, max_page: 1, total_items: 52 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('default classification is state', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({});
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'state' }),
      expect.anything(),
    );
  });

  it('passes municipality classification to service', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ classification: 'municipality' });
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'municipality' }),
      expect.anything(),
    );
  });

  it('passes country classification to service', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ classification: 'country' });
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'country' }),
      expect.anything(),
    );
  });

  it('rejects invalid classification', () => {
    expect(() => listJurisdictions.input.parse({ classification: 'region' })).toThrow();
  });

  it('per_page maximum is 52', () => {
    expect(() => listJurisdictions.input.parse({ per_page: 53 })).toThrow();
  });

  it('per_page minimum is 1', () => {
    expect(() => listJurisdictions.input.parse({ per_page: 0 })).toThrow();
  });

  it('enrichment reflects response pagination', async () => {
    mockService.listJurisdictions.mockResolvedValue({
      results: [mockJurisdiction],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 52 },
    });
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({});
    await listJurisdictions.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalItems).toBe(52);
    expect(enrichment.page).toBe(1);
    expect(enrichment.maxPage).toBe(1);
  });

  it('returns empty results without error', async () => {
    mockService.listJurisdictions.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ classification: 'municipality' });
    const result = await listJurisdictions.handler(input, ctx);
    expect(result.results).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalItems).toBe(0);
  });

  it('passes include=latest_runs to service', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ include: ['latest_runs'] });
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ include: ['latest_runs'] }),
      expect.anything(),
    );
  });

  it('passes include=organizations to service', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ include: ['organizations'] });
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ include: ['organizations'] }),
      expect.anything(),
    );
  });
});

describe('listJurisdictions — format edge cases', () => {
  it('formats jurisdictions without sessions', () => {
    const result = {
      results: [mockJurisdiction],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 1 },
    };
    const blocks = listJurisdictions.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
    expect(text).toContain('https://leg.wa.gov');
    // No sessions section expected
    expect(text).not.toContain('Sessions:');
  });

  it('formats multiple jurisdictions', () => {
    const result = {
      results: [
        mockJurisdiction,
        {
          ...mockJurisdiction,
          id: 'ocd-jurisdiction/country:us/state:ca/government',
          name: 'California',
          url: 'https://leginfo.legislature.ca.gov',
        },
      ],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 2 },
    };
    const blocks = listJurisdictions.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Washington');
    expect(text).toContain('California');
    expect(text).toContain('2 jurisdictions');
  });

  it('formats empty result set', () => {
    const result = {
      results: [],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 0 },
    };
    const blocks = listJurisdictions.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('0 jurisdictions');
  });

  it('formats special session identifier', () => {
    const result = {
      results: [
        {
          ...mockJurisdiction,
          legislative_sessions: [
            {
              identifier: '2025s1',
              name: '2025 Special Session 1',
              classification: 'special',
              start_date: '2025-06-01',
              end_date: '2025-06-15',
            },
          ],
        },
      ],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 1 },
    };
    const blocks = listJurisdictions.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('2025s1');
    expect(text).toContain('2025 Special Session 1');
    expect(text).toContain('special');
  });
});
