/**
 * @fileoverview Tests for the searchPeople tool.
 * @module tests/tools/search-people.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchPeople } from '@/mcp-server/tools/definitions/search-people.tool.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
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

  /**
   * `GET /people` with no jurisdiction — and `GET /people?name=…` alone — sits on the upstream
   * gateway for its full ~60s window and answers 504, so an unscoped *search* cannot complete. An
   * `id` lookup addresses named records instead of scanning, so it bounds the query on its own and
   * satisfies the same requirement. The rule is a schema refinement rather than a handler guard, so
   * a call carrying neither is rejected during input validation and never reaches upstream.
   */
  describe('scope is required by the input schema: jurisdiction or id', () => {
    it('accepts a jurisdiction alone', () => {
      expect(searchPeople.input.safeParse({ jurisdiction: 'wa' }).success).toBe(true);
    });

    it('accepts an id alone, with no jurisdiction', () => {
      expect(searchPeople.input.safeParse({ id: ['ocd-person/abc123'] }).success).toBe(true);
    });

    it('accepts both together', () => {
      const parsed = searchPeople.input.safeParse({
        jurisdiction: 'wa',
        id: ['ocd-person/abc123'],
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects a call carrying neither, naming both fields', () => {
      const parsed = searchPeople.input.safeParse({});
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe('Either jurisdiction or id is required.');
    });

    /**
     * The rejection is a validation issue on the object itself, not a thrown handler error — which
     * is what keeps it an input-validation failure the caller sees before any upstream request.
     */
    it('raises the rejection as a schema issue at the object root', () => {
      const issue = searchPeople.input.safeParse({}).error?.issues[0];
      expect(issue?.code).toBe('custom');
      expect(issue?.path).toEqual([]);
    });

    it('rejects a name-only search — a name does not scope the all-states query', () => {
      expect(searchPeople.input.safeParse({ name: 'Ferguson' }).success).toBe(false);
    });

    it('rejects an empty-string jurisdiction', () => {
      expect(searchPeople.input.safeParse({ jurisdiction: '' }).success).toBe(false);
    });

    it('rejects an empty id array — it names no records, so it scopes nothing', () => {
      expect(searchPeople.input.safeParse({ id: [] }).success).toBe(false);
    });

    it('rejects an empty-string person ID', () => {
      expect(searchPeople.input.safeParse({ id: [''] }).success).toBe(false);
    });

    it('declares no jurisdiction_required reason — the schema owns the constraint', () => {
      expect(searchPeople.errors?.map((e) => e.reason)).not.toContain('jurisdiction_required');
    });

    /**
     * The cost of the either/or: `required` takes one field list, so neither field can appear in
     * it once either satisfies the rule. The constraint stays in the schema, but a client reading
     * only `required` no longer sees it — the same trade `openstates_search_bills` makes for
     * `jurisdiction`-or-`q`, which is why both tools state the rule in their description.
     */
    it('carries neither field in the JSON Schema required list', () => {
      const { required = [] } = z.toJSONSchema(searchPeople.input, { io: 'input' }) as {
        required?: string[];
      };
      expect(required).not.toContain('jurisdiction');
      expect(required).not.toContain('id');
      expect(searchPeople.description).toContain('Either jurisdiction or id is required');
    });
  });

  it('returns results for name search', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', name: 'Smith' });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results[0].family_name).toBe('Smith');
  });

  it('returns empty results with enrichment notice when no legislators match', async () => {
    mockService.searchPeople.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', name: 'Nonexistent' });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('No legislators matched');
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

  /**
   * `/people` returns both fields on every record; the output schema decides whether a client
   * ever sees them. The headshot is what profile and constituent-facing output needs, and the
   * division ID is the stable handle for the district the label only names loosely.
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
      mockService.searchPeople.mockResolvedValue({
        results: [enrichedPerson],
        pagination: mockPeopleResult.pagination,
      });
      const ctx = createMockContext();
      const input = searchPeople.input.parse({ jurisdiction: 'wa' });
      const structured = searchPeople.output.parse(await searchPeople.handler(input, ctx));
      const person = structured.results[0];
      expect(person?.image).toBe('https://data.openstates.org/images/small/ocd-person/abc123');
      expect(person?.current_role?.division_id).toBe('ocd-division/country:us/state:wa/sldu:37');
    });

    it('renders both in format()', () => {
      const blocks = searchPeople.format!({
        results: [enrichedPerson],
        pagination: mockPeopleResult.pagination,
      });
      const text = (blocks[0] as { text: string }).text;
      expect(text).toContain('https://data.openstates.org/images/small/ocd-person/abc123');
      expect(text).toContain('ocd-division/country:us/state:wa/sldu:37');
    });

    it('omits both when upstream carries neither (sparse payload)', () => {
      const structured = searchPeople.output.parse(mockPeopleResult);
      const person = structured.results[0];
      expect(person?.image).toBeUndefined();
      expect(person?.current_role?.division_id).toBeUndefined();

      const text = (searchPeople.format!(structured)[0] as { text: string }).text;
      expect(text).toContain('Jane Smith');
      expect(text).not.toContain('**Photo:**');
      expect(text).not.toContain('**Division:**');
    });

    it('renders no division line for an undistricted role carrying a null division_id', () => {
      const atLarge = {
        ...mockPerson,
        current_role: {
          title: 'Delegate',
          org_classification: 'lower',
          district: null,
          division_id: null,
        },
      };
      const structured = searchPeople.output.parse({
        results: [atLarge],
        pagination: mockPeopleResult.pagination,
      });
      expect(structured.results[0]?.current_role?.division_id).toBeNull();
      const text = (searchPeople.format!(structured)[0] as { text: string }).text;
      expect(text).toContain('Delegate');
      expect(text).not.toContain('**Division:**');
    });
  });

  it('echoes applied filters in enrichment for self-verification', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({
      jurisdiction: 'wa',
      name: 'Smith',
      org_classification: 'upper',
      district: '37',
    });
    await searchPeople.handler(input, ctx);
    expect(getEnrichment(ctx).appliedFilters).toMatchObject({
      jurisdiction: 'wa',
      name: 'Smith',
      org_classification: 'upper',
      district: '37',
      page: 1,
      per_page: 10,
    });
  });
});
