/**
 * @fileoverview Tests for the searchCommittees tool.
 * @module tests/tools/search-committees.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchCommittees } from '@/mcp-server/tools/definitions/search-committees.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
  getOpenStatesApiService: vi.fn(),
}));

const mockCommittee = {
  id: 'ocd-organization/comm-1',
  name: 'Committee on Transportation',
  classification: 'committee',
  parent_id: null,
};

const mockCommitteeResult = {
  results: [mockCommittee],
  pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
};

describe('searchCommittees', () => {
  let mockService: { searchCommittees: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { searchCommittees: vi.fn().mockResolvedValue(mockCommitteeResult) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns committees for a jurisdiction', async () => {
    const ctx = createMockContext();
    const input = searchCommittees.input.parse({ jurisdiction: 'wa' });
    const result = await searchCommittees.handler(input, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('ocd-organization/comm-1');
    expect(result.results[0].name).toBe('Committee on Transportation');
    const enrichment = getEnrichment(ctx);
    expect(enrichment.coverageNote).toBeDefined();
    expect(enrichment.coverageNote).toContain('experimental');
  });

  it('includes memberships when requested', async () => {
    const committeeWithMembers = {
      ...mockCommittee,
      memberships: [{ person_id: 'ocd-person/abc', person_name: 'Jane Smith', role: 'chair' }],
    };
    mockService.searchCommittees.mockResolvedValue({
      results: [committeeWithMembers],
      pagination: mockCommitteeResult.pagination,
    });

    const ctx = createMockContext();
    const input = searchCommittees.input.parse({ jurisdiction: 'wa', include: ['memberships'] });
    const result = await searchCommittees.handler(input, ctx);
    expect(result.results[0].memberships).toBeDefined();
    expect(result.results[0].memberships?.[0].role).toBe('chair');
  });

  it('filters by chamber when provided', async () => {
    const ctx = createMockContext();
    const input = searchCommittees.input.parse({ jurisdiction: 'wa', chamber: 'upper' });
    await searchCommittees.handler(input, ctx);
    expect(mockService.searchCommittees).toHaveBeenCalledWith(
      expect.objectContaining({ chamber: 'upper' }),
      expect.anything(),
    );
  });

  it('always sets coverageNote enrichment regardless of result count', async () => {
    mockService.searchCommittees.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext();
    const input = searchCommittees.input.parse({ jurisdiction: 'wa' });
    await searchCommittees.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.coverageNote).toBeTruthy();
  });

  it('formats output with committee id, name, and count', () => {
    const result = {
      results: [mockCommittee],
      pagination: mockCommitteeResult.pagination,
    };
    const blocks = searchCommittees.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Committee on Transportation');
    expect(text).toContain('ocd-organization/comm-1');
    expect(text).toContain('1 committees');
  });

  it('formats memberships inline when present', () => {
    const result = {
      results: [
        {
          ...mockCommittee,
          memberships: [{ person_id: 'ocd-person/abc', person_name: 'Jane Smith', role: 'chair' }],
        },
      ],
      pagination: mockCommitteeResult.pagination,
    };
    const blocks = searchCommittees.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane Smith');
    expect(text).toContain('chair');
    expect(text).toContain('ocd-person/abc');
  });
});
