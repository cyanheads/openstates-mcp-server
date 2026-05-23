/**
 * @fileoverview Tests for the getLegislatorsByLocation tool.
 * @module tests/tools/get-legislators-by-location.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLegislatorsByLocation } from '@/mcp-server/tools/definitions/get-legislators-by-location.tool.js';

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
  email: 'jane.smith@leg.wa.gov',
  openstates_url: 'https://openstates.org/person/jane-smith/',
};

describe('getLegislatorsByLocation', () => {
  let mockService: { getPeopleByGeo: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      getPeopleByGeo: vi.fn().mockResolvedValue({
        results: [mockPerson],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns legislators for valid coordinates', async () => {
    const ctx = createMockContext();
    const input = getLegislatorsByLocation.input.parse({ lat: 47.6062, lng: -122.3321 });
    const result = await getLegislatorsByLocation.handler(input, ctx);
    expect(result.legislators).toHaveLength(1);
    expect(result.count).toBe(1);
    expect(result.legislators[0].id).toBe('ocd-person/abc123');
  });

  it('throws invalid_coordinate for lat out of range', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ lat: 91, lng: -122 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_coordinate' },
    });
  });

  it('throws invalid_coordinate for lng out of range', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ lat: 47, lng: 181 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_coordinate' },
    });
  });

  it('returns coverage_note when no legislators found', async () => {
    mockService.getPeopleByGeo.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 0, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext();
    const input = getLegislatorsByLocation.input.parse({ lat: 20, lng: -160 });
    const result = await getLegislatorsByLocation.handler(input, ctx);
    expect(result.legislators).toHaveLength(0);
    expect(result.count).toBe(0);
    expect(result.coverage_note).toBeDefined();
    expect(result.coverage_note).toContain('No legislators found');
  });

  it('formats output with legislator id, name, and count', () => {
    const result = {
      legislators: [mockPerson],
      count: 1,
    };
    const blocks = getLegislatorsByLocation.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane Smith');
    expect(text).toContain('ocd-person/abc123');
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
    expect(text).toContain('1 legislators found');
  });

  it('formats coverage_note when no legislators returned', () => {
    const result = {
      legislators: [],
      count: 0,
      coverage_note: 'No legislators found for coordinates (20, -160).',
    };
    const blocks = getLegislatorsByLocation.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No legislators found');
  });
});
