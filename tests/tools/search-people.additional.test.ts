/**
 * @fileoverview Additional coverage for searchPeople: pagination enrichment,
 * filters, district/org_classification, sparse upstream fields, error contracts.
 * @module tests/tools/search-people.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchPeople } from '@/mcp-server/tools/definitions/search-people.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
  getOpenStatesApiService: vi.fn(),
}));

const mockPerson = {
  id: 'ocd-person/abc123',
  name: 'Jane Smith',
  party: 'Democratic',
  current_role: {
    title: 'Senator',
    org_classification: 'upper',
    district: '37',
  },
  jurisdiction: {
    id: 'ocd-jurisdiction/country:us/state:wa/government',
    name: 'Washington',
  },
  given_name: 'Jane',
  family_name: 'Smith',
  email: 'jane.smith@leg.wa.gov',
  openstates_url: 'https://openstates.org/person/jane-smith/',
};

describe('searchPeople — filters forwarded to service', () => {
  let mockService: { searchPeople: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      searchPeople: vi.fn().mockResolvedValue({
        results: [mockPerson],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes district filter to service', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', district: '37' });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ district: '37' }),
      expect.anything(),
    );
  });

  it('passes org_classification filter to service', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', org_classification: 'upper' });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ org_classification: 'upper' }),
      expect.anything(),
    );
  });

  it('keeps legislature in the enum and forwards it for the service to resolve', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({
      jurisdiction: 'wa',
      org_classification: 'legislature',
    });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ org_classification: 'legislature' }),
      expect.anything(),
    );
  });

  it('echoes legislature back as the applied filter, not the chambers it resolved to', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({
      jurisdiction: 'wa',
      org_classification: 'legislature',
    });
    await searchPeople.handler(input, ctx);
    expect(getEnrichment(ctx).appliedFilters).toMatchObject({
      jurisdiction: 'wa',
      org_classification: 'legislature',
    });
  });

  it('passes page and per_page to service', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', page: 2, per_page: 5 });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, per_page: 5 }),
      expect.anything(),
    );
  });

  it('enrichment reflects pagination metadata', async () => {
    mockService.searchPeople.mockResolvedValue({
      results: [mockPerson],
      pagination: { page: 3, per_page: 5, max_page: 8, total_items: 40 },
    });
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', page: 3, per_page: 5 });
    await searchPeople.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(40);
    expect(enrichment.page).toBe(3);
    expect(enrichment.maxPage).toBe(8);
  });

  it('passes include=links to service', async () => {
    const personWithLinks = {
      ...mockPerson,
      links: [{ note: 'official website', url: 'https://rep.example.com' }],
    };
    mockService.searchPeople.mockResolvedValue({
      results: [personWithLinks],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    });
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', include: ['links'] });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results[0].links).toBeDefined();
    expect(result.results[0].links?.[0].url).toBe('https://rep.example.com');
  });
});

describe('searchPeople — sparse upstream payloads', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = {
      searchPeople: vi.fn().mockResolvedValue({
        results: [
          {
            ...mockPerson,
            email: '',
            openstates_url: '',
            given_name: '',
            family_name: '',
          },
        ],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('handles person with empty optional string fields', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa' });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results[0].email).toBe('');
    expect(result.results[0].openstates_url).toBe('');
  });
});

describe('searchPeople — format edge cases', () => {
  it('formats person with email and openstates_url', () => {
    const result = {
      results: [mockPerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchPeople.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('jane.smith@leg.wa.gov');
    expect(text).toContain('https://openstates.org/person/jane-smith/');
  });

  it('formats person with links when present', () => {
    const result = {
      results: [
        {
          ...mockPerson,
          links: [{ note: 'website', url: 'https://smith.example.com' }],
        },
      ],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchPeople.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('https://smith.example.com');
    expect(text).toContain('website');
  });

  it('formats person with unicode name correctly', () => {
    const unicodePerson = {
      ...mockPerson,
      name: 'Nguyễn Thị Hương',
      given_name: 'Hương',
      family_name: 'Nguyễn',
    };
    const result = {
      results: [unicodePerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchPeople.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Nguyễn Thị Hương');
  });

  it('formats person with no party as empty string', () => {
    const noPtyPerson = { ...mockPerson, party: '' };
    const result = {
      results: [noPtyPerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchPeople.format!(result);
    const text = (blocks[0] as { text: string }).text;
    // Should not throw; party line may be absent or blank
    expect(text).toContain('Jane Smith');
  });

  it('per_page minimum is 1', () => {
    expect(() => searchPeople.input.parse({ jurisdiction: 'wa', per_page: 0 })).toThrow();
  });

  it('per_page maximum is 20', () => {
    expect(() => searchPeople.input.parse({ jurisdiction: 'wa', per_page: 21 })).toThrow();
  });
});

/**
 * The Open States /people endpoint enforces no minimum name length — GET
 * /people?name=a returns 200 with tens of thousands of matches. The handler
 * therefore intercepts nothing: every upstream error reaches the caller as-is,
 * including the InvalidParams that a short name was once assumed to produce.
 */
describe('searchPeople — upstream errors bubble unchanged', () => {
  let mockService: { searchPeople: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { searchPeople: vi.fn() };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('bubbles InvalidParams unchanged for a single-character name', async () => {
    const originalErr = new McpError(JsonRpcErrorCode.InvalidParams, 'Bad request');
    mockService.searchPeople.mockRejectedValue(originalErr);
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ name: 'a' });
    await expect(searchPeople.handler(input, ctx)).rejects.toBe(originalErr);
  });

  it('bubbles a non-InvalidParams error unchanged', async () => {
    const originalErr = new McpError(JsonRpcErrorCode.ServiceUnavailable, 'API down');
    mockService.searchPeople.mockRejectedValue(originalErr);
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ name: 'J' });
    await expect(searchPeople.handler(input, ctx)).rejects.toBe(originalErr);
  });
});
