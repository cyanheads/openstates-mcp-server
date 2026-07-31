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

/**
 * Regression coverage for the include-enrichment data loss (issue #18).
 * get_legislators_by_location advertises other_names, other_identifiers, and sources via
 * `include`, but each was dropped before MCP serialization at TWO layers: the service's
 * normalizePerson() — shared with search_people through getPeopleByGeo — copied only
 * offices/links (covered in tests/services/openstates-service.test.ts), and the tool output
 * schema declared no fields for them, so Zod stripped the keys on the structuredContent path
 * and format() never rendered them on the content[] path. Fixture shapes mirror the Person
 * interface in src/services/openstates/types.ts.
 */
describe('getLegislatorsByLocation — include enrichment surfacing', () => {
  const enrichedPerson = {
    ...mockPerson,
    other_names: [{ name: 'Jane A. Smith', note: 'ballot name' }],
    other_identifiers: [{ identifier: 'WA000123', scheme: 'legacy_openstates' }],
    sources: [{ url: 'https://leg.wa.gov/senators/smith', note: 'official roster' }],
  };

  /** structuredContent path — output.parse strips undeclared keys, which is how these dropped. */
  it('retains other_names/other_identifiers/sources through the output schema', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = {
      getPeopleByGeo: vi.fn().mockResolvedValue({
        results: [enrichedPerson],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);

    const ctx = createMockContext();
    const input = getLegislatorsByLocation.input.parse({
      latitude: 47.6,
      longitude: -122.3,
      include: ['other_names', 'other_identifiers', 'sources'],
    });
    const handlerResult = await getLegislatorsByLocation.handler(input, ctx);
    const person = getLegislatorsByLocation.output.parse(handlerResult).legislators[0];

    expect(person.other_names).toEqual([{ name: 'Jane A. Smith', note: 'ballot name' }]);
    expect(person.other_identifiers).toEqual([
      { identifier: 'WA000123', scheme: 'legacy_openstates' },
    ]);
    expect(person.sources).toEqual([
      { url: 'https://leg.wa.gov/senators/smith', note: 'official roster' },
    ]);
  });

  /** content[] path. format() rendered none of these three pre-fix. */
  it('renders other_names/other_identifiers/sources in format() text', () => {
    const blocks = getLegislatorsByLocation.format!({ legislators: [enrichedPerson] });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane A. Smith');
    expect(text).toContain('ballot name');
    expect(text).toContain('WA000123');
    expect(text).toContain('legacy_openstates');
    expect(text).toContain('https://leg.wa.gov/senators/smith');
    expect(text).toContain('official roster');
  });
});

/**
 * Open States frequently returns `note: ""` for a person link. Rendering it as `${note}: ${url}`
 * unconditionally put a dangling separator in front of the URL on the `content[]` path.
 * `structuredContent` is unaffected — `""` is the accurate upstream value and stays.
 */
describe('getLegislatorsByLocation — link rendering with an empty note', () => {
  const personWithLinks = {
    ...mockPerson,
    links: [
      { url: 'https://housedemocrats.example.gov/thomas/', note: '' },
      { url: 'https://leg.example.gov/members/thomas', note: '' },
    ],
  };

  it('renders the URL alone when the note is empty', () => {
    const blocks = getLegislatorsByLocation.format!({ legislators: [personWithLinks] });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain(
      '**Links:** https://housedemocrats.example.gov/thomas/, https://leg.example.gov/members/thomas',
    );
    expect(text).not.toContain(': https://housedemocrats.example.gov/thomas/');
  });

  it('still labels a link that has a note', () => {
    const blocks = getLegislatorsByLocation.format!({
      legislators: [
        {
          ...mockPerson,
          links: [
            { url: 'https://leg.example.gov/members/thomas', note: 'official page' },
            { url: 'https://housedemocrats.example.gov/thomas/', note: '' },
          ],
        },
      ],
    });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain(
      '**Links:** official page: https://leg.example.gov/members/thomas, https://housedemocrats.example.gov/thomas/',
    );
  });
});
