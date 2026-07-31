/**
 * @fileoverview Tests for the getLegislatorsByLocation tool.
 * @module tests/tools/get-legislators-by-location.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
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
    classification: 'state',
  },
  given_name: 'Jane',
  family_name: 'Smith',
  email: 'jane.smith@leg.wa.gov',
  openstates_url: 'https://openstates.org/person/jane-smith/',
};

/**
 * A US Senator as `/people.geo` returns one alongside the state delegation: `org_classification`
 * is `upper` exactly as for a state senator, and only `jurisdiction.classification` says federal.
 */
const mockFederalPerson = {
  id: 'ocd-person/fed456',
  name: 'Maria Cantwell',
  party: 'Democratic',
  current_role: {
    title: 'Senator',
    org_classification: 'upper',
    district: 'Washington',
  },
  jurisdiction: {
    id: 'ocd-jurisdiction/country:us/government',
    name: 'United States',
    classification: 'country',
  },
  given_name: 'Maria',
  family_name: 'Cantwell',
  email: '',
  openstates_url: 'https://openstates.org/person/maria-cantwell/',
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
    const input = getLegislatorsByLocation.input.parse({ latitude: 47.6062, longitude: -122.3321 });
    const result = await getLegislatorsByLocation.handler(input, ctx);
    expect(result.legislators).toHaveLength(1);
    expect(result.legislators[0].id).toBe('ocd-person/abc123');
    const enrichment = getEnrichment(ctx);
    expect(enrichment.count).toBe(1);
  });

  it('throws invalid_coordinate for lat out of range', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 91, longitude: -122 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_coordinate' },
    });
  });

  it('throws invalid_coordinate for lng out of range', async () => {
    const ctx = createMockContext({ errors: getLegislatorsByLocation.errors });
    const input = getLegislatorsByLocation.input.parse({ latitude: 47, longitude: 181 });
    await expect(getLegislatorsByLocation.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_coordinate' },
    });
  });

  it('sets enrichment notice when no legislators found', async () => {
    mockService.getPeopleByGeo.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 0, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext();
    const input = getLegislatorsByLocation.input.parse({ latitude: 20, longitude: -160 });
    const result = await getLegislatorsByLocation.handler(input, ctx);
    expect(result.legislators).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.count).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('No legislators found');
  });

  it('formats output with legislator id, name, and count', () => {
    const result = {
      legislators: [mockPerson],
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

  /**
   * The constituent-facing tool: the headshot and the OCD division of the district a coordinate
   * falls in are exactly what a "who represents this address" answer renders, and both were
   * stripped by the output schema despite `/people.geo` returning them.
   */
  describe('image and current_role.division_id (issue #27)', () => {
    const enrichedPerson = {
      ...mockPerson,
      image: 'https://data.openstates.org/images/small/ocd-person/abc123',
      current_role: {
        ...mockPerson.current_role,
        division_id: 'ocd-division/country:us/state:wa/sldu:37',
      },
    };

    it('keeps both in structuredContent', async () => {
      mockService.getPeopleByGeo.mockResolvedValue({
        results: [enrichedPerson],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      });
      const ctx = createMockContext();
      const input = getLegislatorsByLocation.input.parse({
        latitude: 47.6062,
        longitude: -122.3321,
      });
      const structured = getLegislatorsByLocation.output.parse(
        await getLegislatorsByLocation.handler(input, ctx),
      );
      const person = structured.legislators[0];
      expect(person?.image).toBe('https://data.openstates.org/images/small/ocd-person/abc123');
      expect(person?.current_role?.division_id).toBe('ocd-division/country:us/state:wa/sldu:37');
    });

    it('renders both in format()', () => {
      const blocks = getLegislatorsByLocation.format!({ legislators: [enrichedPerson] });
      const text = (blocks[0] as { text: string }).text;
      expect(text).toContain('https://data.openstates.org/images/small/ocd-person/abc123');
      expect(text).toContain('ocd-division/country:us/state:wa/sldu:37');
    });

    it('omits both when upstream carries neither (sparse payload)', () => {
      const structured = getLegislatorsByLocation.output.parse({ legislators: [mockPerson] });
      const person = structured.legislators[0];
      expect(person?.image).toBeUndefined();
      expect(person?.current_role?.division_id).toBeUndefined();

      const text = (getLegislatorsByLocation.format!(structured)[0] as { text: string }).text;
      expect(text).toContain('Jane Smith');
      expect(text).not.toContain('**Photo:**');
      expect(text).not.toContain('**Division:**');
    });
  });

  it('formats zero legislators when none returned', () => {
    const result = {
      legislators: [],
    };
    const blocks = getLegislatorsByLocation.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('0 legislators found');
  });

  /**
   * Regression coverage for issue #36. `/people.geo` returns the coordinate's federal delegation
   * alongside its state legislators, and nothing in the output said so — `org_classification` is
   * `upper`/`lower` for both tiers, so an agent asked for state legislators presented members of
   * Congress as state legislators. `given_name`/`family_name` were populated by the service and
   * then stripped by this tool's output schema.
   */
  describe('federal tier disclosure and name parts (issue #36)', () => {
    const bothTiers = [mockPerson, mockFederalPerson];

    beforeEach(() => {
      mockService.getPeopleByGeo.mockResolvedValue({
        results: bothTiers,
        pagination: { page: 1, per_page: 2, max_page: 1, total_items: 2 },
      });
    });

    const run = async () => {
      const ctx = createMockContext();
      const input = getLegislatorsByLocation.input.parse({
        latitude: 47.6062,
        longitude: -122.3321,
      });
      const structured = getLegislatorsByLocation.output.parse(
        await getLegislatorsByLocation.handler(input, ctx),
      );
      return { ctx, structured };
    };

    it('keeps jurisdiction.classification through the output schema', async () => {
      const { structured } = await run();
      expect(structured.legislators[0]?.jurisdiction.classification).toBe('state');
      expect(structured.legislators[1]?.jurisdiction.classification).toBe('country');
    });

    it('counts each tier in the enrichment', async () => {
      const { ctx } = await run();
      const enrichment = getEnrichment(ctx);
      expect(enrichment.count).toBe(2);
      expect(enrichment.stateCount).toBe(1);
      expect(enrichment.federalCount).toBe(1);
    });

    it('labels each legislator tier in the rendered text', async () => {
      const { structured } = await run();
      const text = (getLegislatorsByLocation.format!(structured)[0] as { text: string }).text;
      expect(text).toContain('**2 legislators found** — 1 state, 1 federal (US Congress)');
      expect(text).toContain(
        'Washington (ocd-jurisdiction/country:us/state:wa/government) — state legislature',
      );
      expect(text).toContain(
        'United States (ocd-jurisdiction/country:us/government) — federal (US Congress)',
      );
    });

    it('keeps given_name and family_name through the output schema and the rendered text', async () => {
      const { structured } = await run();
      expect(structured.legislators[0]?.given_name).toBe('Jane');
      expect(structured.legislators[0]?.family_name).toBe('Smith');
      const text = (getLegislatorsByLocation.format!(structured)[0] as { text: string }).text;
      expect(text).toContain('**Given name:** Maria | **Family name:** Cantwell');
    });

    it('omits the tier breakdown when every result is state-level', async () => {
      mockService.getPeopleByGeo.mockResolvedValue({
        results: [mockPerson],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      });
      const { ctx, structured } = await run();
      expect(getEnrichment(ctx).federalCount).toBe(0);
      const text = (getLegislatorsByLocation.format!(structured)[0] as { text: string }).text;
      expect(text).toContain('**1 legislators found**\n');
      expect(text).not.toContain('federal');
    });

    /**
     * A level neither tier constant covers is rendered verbatim rather than dropped, so a
     * content[]-only client still sees what upstream reported. It counts toward neither tier.
     */
    it('renders an unrecognized classification verbatim', async () => {
      mockService.getPeopleByGeo.mockResolvedValue({
        results: [
          {
            ...mockPerson,
            jurisdiction: {
              id: 'ocd-jurisdiction/country:us/state:wa/place:seattle/government',
              name: 'Seattle',
              classification: 'municipality',
            },
          },
        ],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      });
      const { ctx, structured } = await run();
      expect(getEnrichment(ctx).stateCount).toBe(0);
      expect(getEnrichment(ctx).federalCount).toBe(0);
      const text = (getLegislatorsByLocation.format!(structured)[0] as { text: string }).text;
      expect(text).toContain(
        'Seattle (ocd-jurisdiction/country:us/state:wa/place:seattle/government) — municipality',
      );
    });

    /** A payload without the discriminator is not labelled or counted — never guessed at. */
    it('leaves a result with no jurisdiction classification unlabelled and uncounted', async () => {
      mockService.getPeopleByGeo.mockResolvedValue({
        results: [{ ...mockPerson, jurisdiction: { id: 'ocd-jurisdiction/x', name: 'Somewhere' } }],
        pagination: { page: 1, per_page: 1, max_page: 1, total_items: 1 },
      });
      const { ctx, structured } = await run();
      const enrichment = getEnrichment(ctx);
      expect(enrichment.count).toBe(1);
      expect(enrichment.stateCount).toBe(0);
      expect(enrichment.federalCount).toBe(0);
      const text = (getLegislatorsByLocation.format!(structured)[0] as { text: string }).text;
      expect(text).toContain('**Jurisdiction:** Somewhere (ocd-jurisdiction/x)\n');
      expect(text).not.toContain('legislature');
    });

    /**
     * The header split and the enrichment counts must agree. Tallying each tier by its own
     * predicate is what keeps them aligned — deriving the state count by subtracting the federal
     * one from the total silently folds a record at neither tier into the state side, so the two
     * surfaces report different numbers for the same result set.
     */
    it('keeps the header split equal to the enrichment counts when a result sits at neither tier', async () => {
      mockService.getPeopleByGeo.mockResolvedValue({
        results: [
          mockPerson,
          mockFederalPerson,
          {
            ...mockPerson,
            id: 'ocd-person/muni789',
            jurisdiction: {
              id: 'ocd-jurisdiction/country:us/state:wa/place:seattle/government',
              name: 'Seattle',
              classification: 'municipality',
            },
          },
        ],
        pagination: { page: 1, per_page: 3, max_page: 1, total_items: 3 },
      });
      const { ctx, structured } = await run();
      const enrichment = getEnrichment(ctx);
      expect(enrichment).toMatchObject({ count: 3, stateCount: 1, federalCount: 1 });
      const text = (getLegislatorsByLocation.format!(structured)[0] as { text: string }).text;
      expect(text).toContain('**3 legislators found** — 1 state, 1 federal (US Congress)');
      expect(text).toContain(
        'Seattle (ocd-jurisdiction/country:us/state:wa/place:seattle/government) — municipality',
      );
    });
  });
});
