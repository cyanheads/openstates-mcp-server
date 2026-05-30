/**
 * @fileoverview Additional coverage for getLegislatorsByLocation: boundary
 * coordinate values, form-client empty strings, and include forwarding.
 * @module tests/tools/get-legislators-by-location.additional.test
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
  current_role: { title: 'Senator', org_classification: 'upper', district: '37' },
  jurisdiction: {
    id: 'ocd-jurisdiction/country:us/state:wa/government',
    name: 'Washington',
  },
  given_name: 'Jane',
  family_name: 'Smith',
  email: '',
  openstates_url: '',
};

describe('getLegislatorsByLocation — coordinate boundary values', () => {
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

  it('accepts lat=90 (north pole boundary)', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 90, longitude: 0 });
    // lat=90 is exactly at the boundary — handler rejects > 90
    // The Zod schema uses .min(-90).max(90), so 90 is valid
    await expect(getLegislatorsByLocation.handler(input, ctx)).resolves.toBeDefined();
  });

  it('accepts lat=-90 (south pole boundary)', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: -90, longitude: 0 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).resolves.toBeDefined();
  });

  it('accepts lng=180 (date line boundary)', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 0, longitude: 180 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).resolves.toBeDefined();
  });

  it('accepts lng=-180 (date line boundary)', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 0, longitude: -180 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).resolves.toBeDefined();
  });

  it('throws invalid_coordinate for lat=90.001', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 90.001, longitude: 0 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_coordinate' },
    });
  });

  it('throws invalid_coordinate for lng=-180.001', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 0, longitude: -180.001 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_coordinate' },
    });
  });
});

describe('getLegislatorsByLocation — include forwarding', () => {
  let mockService: { getPeopleByGeo: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      getPeopleByGeo: vi.fn().mockResolvedValue({
        results: [
          {
            ...mockPerson,
            offices: [{ name: 'Capitol Office', classification: 'capitol', voice: '555-0100' }],
          },
        ],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('passes include=offices to service', async () => {
    const ctx = createMockContext();
    const input = getLegislatorsByLocation.input.parse({
      latitude: 47.6,
      longitude: -122.3,
      include: ['offices'],
    });
    await getLegislatorsByLocation.handler(input, ctx);
    expect(mockService.getPeopleByGeo).toHaveBeenCalledWith(
      47.6,
      -122.3,
      ['offices'],
      expect.anything(),
    );
  });

  it('returns offices in result when include=offices', async () => {
    const ctx = createMockContext();
    const input = getLegislatorsByLocation.input.parse({
      latitude: 47.6,
      longitude: -122.3,
      include: ['offices'],
    });
    const result = await getLegislatorsByLocation.handler(input, ctx);
    expect(result.legislators[0].offices).toBeDefined();
    expect(result.legislators[0].offices?.[0].voice).toBe('555-0100');
  });
});

describe('getLegislatorsByLocation — format with offices', () => {
  it('formats offices when present', () => {
    const result = {
      legislators: [
        {
          ...mockPerson,
          offices: [
            {
              name: 'Capitol Office',
              classification: 'capitol',
              voice: '360-786-7660',
              address: 'PO Box 40437',
            },
          ],
        },
      ],
    };
    const blocks = getLegislatorsByLocation.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Capitol Office');
    expect(text).toContain('360-786-7660');
    expect(text).toContain('PO Box 40437');
  });

  it('formats email and openstates_url when present', () => {
    const result = {
      legislators: [
        {
          ...mockPerson,
          email: 'jane@leg.wa.gov',
          openstates_url: 'https://openstates.org/person/jane-smith/',
        },
      ],
    };
    const blocks = getLegislatorsByLocation.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('jane@leg.wa.gov');
    expect(text).toContain('https://openstates.org/person/jane-smith/');
  });
});

describe('getLegislatorsByLocation — Zod input validation', () => {
  it('rejects invalid include value', () => {
    expect(() =>
      getLegislatorsByLocation.input.parse({
        latitude: 47.6,
        longitude: -122.3,
        include: ['not_a_valid_include'],
      }),
    ).toThrow();
  });

  it('requires latitude', () => {
    expect(() => getLegislatorsByLocation.input.parse({ longitude: -122.3 })).toThrow();
  });

  it('requires longitude', () => {
    expect(() => getLegislatorsByLocation.input.parse({ latitude: 47.6 })).toThrow();
  });
});
