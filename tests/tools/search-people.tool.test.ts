/**
 * @fileoverview Tests for the searchPeople tool.
 * @module tests/tools/search-people.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
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

const mockPeopleResult = {
  results: [mockPerson],
  pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
};

describe('searchPeople', () => {
  let mockService: { searchPeople: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { searchPeople: vi.fn().mockResolvedValue(mockPeopleResult) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns legislators matching jurisdiction', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa' });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('ocd-person/abc123');
    expect(result.results[0].name).toBe('Jane Smith');
    expect(result.results[0].party).toBe('Democratic');
  });

  it('returns results for name search', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', name: 'Smith' });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results[0].family_name).toBe('Smith');
  });

  it('returns empty results with a message when no legislators match', async () => {
    mockService.searchPeople.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', name: 'Nonexistent' });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results).toHaveLength(0);
    expect(result.message).toBeDefined();
    expect(result.message).toContain('No legislators matched');
  });

  it('includes offices when requested', async () => {
    const personWithOffices = {
      ...mockPerson,
      offices: [
        {
          name: 'Capitol Office',
          classification: 'capitol',
          voice: '360-786-7660',
          address: 'PO Box 40437, Olympia WA 98504',
        },
      ],
    };
    mockService.searchPeople.mockResolvedValue({
      results: [personWithOffices],
      pagination: mockPeopleResult.pagination,
    });

    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', include: ['offices'] });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results[0].offices).toBeDefined();
    expect(result.results[0].offices?.[0].voice).toBe('360-786-7660');
  });

  it('formats output with id, name, party, and jurisdiction', () => {
    const result = {
      results: [mockPerson],
      pagination: mockPeopleResult.pagination,
    };
    const blocks = searchPeople.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane Smith');
    expect(text).toContain('ocd-person/abc123');
    expect(text).toContain('Democratic');
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
    expect(text).toContain('1 legislators');
  });

  it('formats offices inline when present', () => {
    const result = {
      results: [
        {
          ...mockPerson,
          offices: [
            {
              name: 'Capitol Office',
              classification: 'capitol',
              voice: '360-786-7660',
            },
          ],
        },
      ],
      pagination: mockPeopleResult.pagination,
    };
    const blocks = searchPeople.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Capitol Office');
    expect(text).toContain('360-786-7660');
  });

  it('handles person with null current_role', () => {
    const personNoRole = { ...mockPerson, current_role: null };
    const result = {
      results: [personNoRole],
      pagination: mockPeopleResult.pagination,
    };
    const blocks = searchPeople.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane Smith');
    // Should not throw on null current_role
    expect(text).toContain('ocd-person/abc123');
  });
});
