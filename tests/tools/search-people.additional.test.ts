/**
 * @fileoverview Additional coverage for searchPeople: pagination enrichment,
 * filters, district/org_classification, sparse upstream fields, error contracts.
 * @module tests/tools/search-people.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
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

  it('forwards id to the service as the array upstream repeats, jurisdiction absent', async () => {
    const ctx = createMockContext();
    const ids = ['ocd-person/abc123', 'ocd-person/def456'];
    const input = searchPeople.input.parse({ id: ids });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ id: ids, jurisdiction: undefined }),
      expect.anything(),
    );
  });

  it('forwards id alongside a jurisdiction when both are given', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', id: ['ocd-person/abc123'] });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ jurisdiction: 'wa', id: ['ocd-person/abc123'] }),
      expect.anything(),
    );
  });

  it('echoes id in the applied filters', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ id: ['ocd-person/abc123'] });
    await searchPeople.handler(input, ctx);
    expect(getEnrichment(ctx).appliedFilters).toMatchObject({ id: ['ocd-person/abc123'] });
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

/**
 * An ID lookup that matches nothing fails differently from a filter search: Open States answers an
 * ID it does not know with HTTP 200 and zero rows, so there is no upstream error to surface and
 * nothing to broaden. The notice has to name the two ways that happens instead of telling the
 * caller to loosen filters they never set.
 */
describe('searchPeople — empty result for an id lookup', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchPeople: vi.fn().mockResolvedValue({
        results: [],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
      }),
    } as never);
  });

  it('names the ID and the two ways it matches nothing', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ id: ['ocd-person/unknown'] });
    await searchPeople.handler(input, ctx);
    const { notice } = getEnrichment(ctx);
    expect(notice).toContain('ocd-person/unknown');
    expect(notice).toContain('zero rows');
    expect(notice).toContain('jurisdiction');
  });

  it('omits the jurisdiction clause entirely when none was supplied', async () => {
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ id: ['ocd-person/unknown'] });
    await searchPeople.handler(input, ctx);
    expect(getEnrichment(ctx).notice).not.toContain('jurisdiction="');
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
    const input = searchPeople.input.parse({ jurisdiction: 'wa', name: 'a' });
    await expect(searchPeople.handler(input, ctx)).rejects.toBe(originalErr);
  });

  it('bubbles a non-InvalidParams error unchanged', async () => {
    const originalErr = new McpError(JsonRpcErrorCode.ServiceUnavailable, 'API down');
    mockService.searchPeople.mockRejectedValue(originalErr);
    const ctx = createMockContext();
    const input = searchPeople.input.parse({ jurisdiction: 'wa', name: 'J' });
    await expect(searchPeople.handler(input, ctx)).rejects.toBe(originalErr);
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18). search_people
 * advertises other_names, other_identifiers, and sources via `include`, but each was dropped
 * before MCP serialization at TWO layers: the service's normalizePerson() rebuilt the record
 * and copied only offices/links (covered in tests/services/openstates-service.test.ts), and the
 * tool output schema declared no fields for them — so Zod stripped the keys on the
 * structuredContent path and format() never rendered them on the content[] path. This block
 * covers the tool layer; fixture shapes mirror the Person interface in
 * src/services/openstates/types.ts.
 */
describe('searchPeople — include enrichment surfacing', () => {
  const enrichedPerson = {
    ...mockPerson,
    other_names: [{ name: 'Jane A. Smith', note: 'ballot name' }],
    other_identifiers: [{ identifier: 'WA000123', scheme: 'legacy_openstates' }],
    sources: [{ url: 'https://leg.wa.gov/senators/smith', note: 'official roster' }],
  };

  /**
   * structuredContent path. Parsing the handler result through the tool's own output schema is
   * the exact step that dropped the data pre-fix — Zod strips keys the schema does not declare.
   */
  it('retains other_names/other_identifiers/sources through the output schema', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = {
      searchPeople: vi.fn().mockResolvedValue({
        results: [enrichedPerson],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);

    const ctx = createMockContext();
    const input = searchPeople.input.parse({
      jurisdiction: 'wa',
      include: ['other_names', 'other_identifiers', 'sources'],
    });
    const handlerResult = await searchPeople.handler(input, ctx);
    const person = searchPeople.output.parse(handlerResult).results[0];

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
    const blocks = searchPeople.format!({
      results: [enrichedPerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    });
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
 */
describe('searchPeople — link rendering with an empty note', () => {
  const pagination = { page: 1, per_page: 10, max_page: 1, total_items: 1 };

  it('renders the URL alone when the note is empty', () => {
    const blocks = searchPeople.format!({
      results: [
        {
          ...mockPerson,
          links: [
            { url: 'https://housedemocrats.example.gov/thomas/', note: '' },
            { url: 'https://leg.example.gov/members/thomas', note: '' },
          ],
        },
      ],
      pagination,
    });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain(
      '**Links:** https://housedemocrats.example.gov/thomas/, https://leg.example.gov/members/thomas',
    );
    expect(text).not.toContain(': https://housedemocrats.example.gov/thomas/');
  });

  it('still labels a link that has a note', () => {
    const blocks = searchPeople.format!({
      results: [
        {
          ...mockPerson,
          links: [{ url: 'https://leg.example.gov/members/thomas', note: 'official page' }],
        },
      ],
      pagination,
    });
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('**Links:** official page: https://leg.example.gov/members/thomas');
  });
});

/**
 * Paging past the end of a result set 404s upstream. Without a declared reason the caller got a
 * bare status with no `data.reason` and no recovery hint — the service now carries the upstream
 * constraint in the message, and the tool supplies the reason and the next move.
 */
describe('searchPeople — out-of-range page', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchPeople: vi
        .fn()
        .mockRejectedValue(
          new McpError(
            JsonRpcErrorCode.NotFound,
            'Open States rejected the request: invalid page, must be in [1, 5].',
            { status: 404 },
          ),
        ),
    } as never);
  });

  it('maps an upstream not-found to invalid_page with a recovery hint', async () => {
    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({ jurisdiction: 'wa', page: 99 });

    const err = await searchPeople.handler(input, ctx).catch((e: unknown) => e);

    expect((err as McpError).data).toMatchObject({
      reason: 'invalid_page',
      recovery: { hint: expect.stringContaining('max_page') },
    });
    // The upstream constraint survives the remap — it names the range the caller must stay inside.
    expect((err as McpError).message).toContain('invalid page, must be in [1, 5]');
  });
});

/**
 * Regression coverage for issue #39. The description opened by advertising a search "by name,
 * jurisdiction, chamber, district, or party" while the input schema had no `party` field and the
 * service never sent one — a model constructing `party` had it dropped by the schema and got an
 * unfiltered page back with no signal. Upstream `/people` takes no `party` query parameter, so
 * the claim was withdrawn rather than implemented. `party` stays an output field.
 */
describe('searchPeople — party is an output field, not a filter (issue #39)', () => {
  it('exposes no party input', () => {
    expect(Object.keys(searchPeople.input.shape)).not.toContain('party');
  });

  it('does not advertise party among its search dimensions', () => {
    expect(searchPeople.description).not.toContain('chamber, district, or party');
    expect(searchPeople.description).toContain('cannot be filtered on');
  });

  it('silently drops a party key rather than forwarding it', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const searchPeopleSpy = vi.fn().mockResolvedValue({
      results: [mockPerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    });
    vi.mocked(getOpenStatesApiService).mockReturnValue({ searchPeople: searchPeopleSpy } as never);

    const input = searchPeople.input.parse({ jurisdiction: 'wa', party: 'Democratic' });
    expect(input).not.toHaveProperty('party');

    await searchPeople.handler(input, createMockContext());
    expect(searchPeopleSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ party: expect.anything() }),
      expect.anything(),
    );
  });

  it('still reports party on every result', () => {
    const parsed = searchPeople.output.parse({
      results: [mockPerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    });
    expect(parsed.results[0]?.party).toBe('Democratic');
  });
});
