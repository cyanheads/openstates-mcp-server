/**
 * @fileoverview Additional coverage for searchPeople: pagination enrichment,
 * filters, district/org_classification, sparse upstream fields, error contracts.
 * @module tests/tools/search-people.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchPeople } from '@/mcp-server/tools/definitions/search-people.tool.js';
import {
  images,
  inlineTokens,
  inlineTypes,
  links,
  normalizeLink,
  readBack,
} from '../helpers/commonmark.js';
import { HOSTILE_VALUES, MULTILINE_VALUES, shape } from '../helpers/markdown-sweep.js';

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
    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({ jurisdiction: 'wa', district: '37' });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ district: '37' }),
      expect.anything(),
    );
  });

  it('passes org_classification filter to service', async () => {
    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({ jurisdiction: 'wa', org_classification: 'upper' });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ org_classification: 'upper' }),
      expect.anything(),
    );
  });

  it('keeps legislature in the enum and forwards it for the service to resolve', async () => {
    const ctx = createMockContext({ errors: searchPeople.errors });
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
    const ctx = createMockContext({ errors: searchPeople.errors });
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
    const ctx = createMockContext({ errors: searchPeople.errors });
    const ids = ['ocd-person/abc123', 'ocd-person/def456'];
    const input = searchPeople.input.parse({ id: ids });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ id: ids, jurisdiction: undefined }),
      expect.anything(),
    );
  });

  it('forwards id alongside a jurisdiction when both are given', async () => {
    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({ jurisdiction: 'wa', id: ['ocd-person/abc123'] });
    await searchPeople.handler(input, ctx);
    expect(mockService.searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ jurisdiction: 'wa', id: ['ocd-person/abc123'] }),
      expect.anything(),
    );
  });

  it('echoes id in the applied filters', async () => {
    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({ id: ['ocd-person/abc123'] });
    await searchPeople.handler(input, ctx);
    expect(getEnrichment(ctx).appliedFilters).toMatchObject({ id: ['ocd-person/abc123'] });
  });

  it('passes page and per_page to service', async () => {
    const ctx = createMockContext({ errors: searchPeople.errors });
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
    const ctx = createMockContext({ errors: searchPeople.errors });
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
    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({ jurisdiction: 'wa', include: ['links'] });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results[0]!.links).toBeDefined();
    expect(result.results[0]!.links?.[0]?.url).toBe('https://rep.example.com');
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
    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({ id: ['ocd-person/unknown'] });
    await searchPeople.handler(input, ctx);
    const { notice } = getEnrichment(ctx);
    expect(notice).toContain('ocd-person/unknown');
    expect(notice).toContain('zero rows');
    expect(notice).toContain('jurisdiction');
  });

  it('omits the jurisdiction clause entirely when none was supplied', async () => {
    const ctx = createMockContext({ errors: searchPeople.errors });
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
    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({ jurisdiction: 'wa' });
    const result = await searchPeople.handler(input, ctx);
    expect(result.results[0]!.email).toBe('');
    expect(result.results[0]!.openstates_url).toBe('');
  });
});

describe('searchPeople — format edge cases', () => {
  it('formats person with email and openstates_url', () => {
    const result = {
      results: [mockPerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchPeople.format!(result);
    const text = (blocks[0]! as { text: string }).text;
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
    const text = (blocks[0]! as { text: string }).text;
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
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Nguyễn Thị Hương');
  });

  it('formats person with no party as empty string', () => {
    const noPtyPerson = { ...mockPerson, party: '' };
    const result = {
      results: [noPtyPerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    };
    const blocks = searchPeople.format!(result);
    const text = (blocks[0]! as { text: string }).text;
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
 * including domain validation failures that a short name was once assumed to produce.
 */
describe('searchPeople — upstream errors bubble unchanged', () => {
  let mockService: { searchPeople: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { searchPeople: vi.fn() };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('bubbles ValidationError unchanged for a single-character name', async () => {
    const originalErr = new McpError(JsonRpcErrorCode.ValidationError, 'Bad request');
    mockService.searchPeople.mockRejectedValue(originalErr);
    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({ jurisdiction: 'wa', name: 'a' });
    await expect(searchPeople.handler(input, ctx)).rejects.toBe(originalErr);
  });

  it('bubbles a non-validation error unchanged', async () => {
    const originalErr = new McpError(JsonRpcErrorCode.ServiceUnavailable, 'API down');
    mockService.searchPeople.mockRejectedValue(originalErr);
    const ctx = createMockContext({ errors: searchPeople.errors });
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

    const ctx = createMockContext({ errors: searchPeople.errors });
    const input = searchPeople.input.parse({
      jurisdiction: 'wa',
      include: ['other_names', 'other_identifiers', 'sources'],
    });
    const handlerResult = await searchPeople.handler(input, ctx);
    const person = searchPeople.output.parse(handlerResult).results[0]!;

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
    const text = (blocks[0]! as { text: string }).text;
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
 * unconditionally put a dangling separator in front of the URL on the `content[]` path. Each link
 * renders as a Markdown link labelled by its note, or by the URL itself when the note is empty, so
 * the read-back line carries no stray `: `.
 */
describe('searchPeople — link rendering with an empty note', () => {
  const pagination = { page: 1, per_page: 10, max_page: 1, total_items: 1 };
  const linksLine = (text: string) =>
    readBack(text)
      .flatMap((block) => block.split('\n'))
      .find((line) => line.startsWith('Links:'));

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
    const text = (blocks[0]! as { text: string }).text;
    expect(linksLine(text)).toBe(
      'Links: https://housedemocrats.example.gov/thomas/, https://leg.example.gov/members/thomas',
    );
    expect(links(text).slice(1)).toEqual([
      {
        href: 'https://housedemocrats.example.gov/thomas/',
        label: 'https://housedemocrats.example.gov/thomas/',
      },
      {
        href: 'https://leg.example.gov/members/thomas',
        label: 'https://leg.example.gov/members/thomas',
      },
    ]);
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
    const text = (blocks[0]! as { text: string }).text;
    expect(linksLine(text)).toBe('Links: official page');
    expect(links(text).slice(1)).toEqual([
      { href: 'https://leg.example.gov/members/thomas', label: 'official page' },
    ]);
  });
});

/**
 * Issue #53: every upstream string in `format()` reads back exactly from a CommonMark parse. Each
 * field of the second person is set to each hostile class in turn; it must appear verbatim in the
 * read-back text and leave the block structure and the non-text inline tokens exactly as the
 * benign value did — no emphasis, link, image, raw HTML, heading, list, or quote of its own.
 */
describe('searchPeople — format() Markdown fidelity (issue #53)', () => {
  const person = {
    id: 'ocd-person/9eddb3cd-868e-42ba-831a-b415fd7ed445',
    name: 'Jane Smith',
    party: 'Democratic',
    current_role: {
      title: 'Senator',
      org_classification: 'upper',
      district: 'At-Large',
      division_id: 'ocd-division/country:us/state:wa/sldu:37',
    },
    jurisdiction: { id: 'ocd-jurisdiction/country:us/state:wa/government', name: 'Washington' },
    given_name: 'Jane',
    family_name: 'Smith',
    email: 'jane_smith@leg.wa.gov',
    openstates_url: 'https://openstates.org/person/jane-smith-4Xyz/',
    image: 'https://data.openstates.org/images/small/ocd-person/9eddb3cd.jpg',
    offices: [
      {
        name: 'Capitol Office',
        classification: 'capitol',
        voice: '360-786-7660',
        fax: '360-786-1999',
        address: 'PO Box 40437; Olympia, WA 98504',
      },
    ],
    links: [
      { url: 'https://senate.wa.gov/smith/', note: 'website' },
      { url: 'https://x.example.gov/jsmith', note: '' },
    ],
    other_names: [
      { name: 'Jane A. Smith', note: 'ballot name' },
      { name: 'J. Smith', note: '' },
    ],
    other_identifiers: [{ identifier: 'WAL000123', scheme: 'legacy_openstates' }],
    sources: [
      { url: 'https://leg.wa.gov/senators/smith', note: 'official roster' },
      { url: 'https://leg.wa.gov/roster', note: '' },
    ],
  };
  type Person = typeof person;
  const pagination = { page: 1, per_page: 10, max_page: 1, total_items: 2 };
  const fixture = { results: [person, structuredClone(person)], pagination };

  const render = (value: typeof fixture) =>
    (searchPeople.format!(searchPeople.output.parse(value))[0]! as { text: string }).text;
  const withSecond = (edit: (p: Person) => void) => {
    const f = structuredClone(fixture);
    edit(f.results[1]!);
    return render(f);
  };

  const fields: { path: string; set: (p: Person, v: string) => void; oneLine?: boolean }[] = [
    { path: 'name', set: (p, v) => (p.name = v), oneLine: true },
    { path: 'id', set: (p, v) => (p.id = v) },
    { path: 'party', set: (p, v) => (p.party = v) },
    { path: 'given_name', set: (p, v) => (p.given_name = v) },
    { path: 'family_name', set: (p, v) => (p.family_name = v) },
    { path: 'email', set: (p, v) => (p.email = v) },
    { path: 'jurisdiction.id', set: (p, v) => (p.jurisdiction.id = v) },
    { path: 'jurisdiction.name', set: (p, v) => (p.jurisdiction.name = v) },
    { path: 'current_role.title', set: (p, v) => (p.current_role.title = v) },
    {
      path: 'current_role.org_classification',
      set: (p, v) => (p.current_role.org_classification = v),
    },
    { path: 'current_role.district', set: (p, v) => (p.current_role.district = v) },
    { path: 'current_role.division_id', set: (p, v) => (p.current_role.division_id = v) },
    { path: 'offices[].name', set: (p, v) => (p.offices[0]!.name = v) },
    { path: 'offices[].classification', set: (p, v) => (p.offices[0]!.classification = v) },
    { path: 'offices[].voice', set: (p, v) => (p.offices[0]!.voice = v) },
    { path: 'offices[].fax', set: (p, v) => (p.offices[0]!.fax = v) },
    { path: 'offices[].address', set: (p, v) => (p.offices[0]!.address = v) },
    { path: 'links[].note', set: (p, v) => (p.links[0]!.note = v) },
    { path: 'other_names[].name', set: (p, v) => (p.other_names[1]!.name = v) },
    { path: 'other_names[].note', set: (p, v) => (p.other_names[0]!.note = v) },
    {
      path: 'other_identifiers[].identifier',
      set: (p, v) => (p.other_identifiers[0]!.identifier = v),
    },
    { path: 'other_identifiers[].scheme', set: (p, v) => (p.other_identifiers[0]!.scheme = v) },
    { path: 'sources[].note', set: (p, v) => (p.sources[0]!.note = v) },
  ];

  it.each(fields)('$path reads back exactly for every hostile class', ({ set, oneLine }) => {
    const expected = shape(withSecond((p) => set(p, 'plain value')));
    for (const value of oneLine ? HOSTILE_VALUES : [...HOSTILE_VALUES, ...MULTILINE_VALUES]) {
      const text = withSecond((p) => set(p, value));
      expect({ value, shape: shape(text) }).toEqual({ value, shape: expected });
      expect(
        readBack(text).some((block) => block.includes(value)),
        value,
      ).toBe(true);
    }
  });

  it('labels a link or source with its note, so a forged link in the note adds no link', () => {
    const forged = 'see [x](https://example.org/forged)';
    const text = withSecond((p) => {
      p.links[0]!.note = forged;
      p.sources[0]!.note = forged;
    });
    const second = links(text).slice(links(render(fixture)).length / 2);
    expect(second.map((l) => l.label)).toEqual([
      'https://openstates.org/person/jane-smith-4Xyz/',
      forged,
      'https://x.example.gov/jsmith',
      forged,
      'https://leg.wa.gov/roster',
    ]);
    expect(second.map((l) => l.href)).not.toContain('https://example.org/forged');
  });

  it.each([
    ['openstates_url', (p: Person, url: string) => (p.openstates_url = url), 0, (u: string) => u],
    [
      'links[].url with a note',
      (p: Person, url: string) => (p.links[0]!.url = url),
      1,
      () => 'website',
    ],
    [
      'links[].url without a note',
      (p: Person, url: string) => (p.links[1]!.url = url),
      2,
      (u: string) => u,
    ],
    [
      'sources[].url with a note',
      (p: Person, url: string) => (p.sources[0]!.url = url),
      3,
      () => 'official roster',
    ],
    [
      'sources[].url without a note',
      (p: Person, url: string) => (p.sources[1]!.url = url),
      4,
      (u: string) => u,
    ],
  ] as const)('renders %s as one link to the URL', (_path, set, index, label) => {
    const perPerson = links(render(fixture)).length / 2;
    for (const url of ['https://example.org/plain', 'https://example.org/a b/(c)?q=<x>&amp;[y]']) {
      const link = links(withSecond((p) => set(p, url)))[perPerson + index];
      expect(link).toEqual({ href: normalizeLink(url), label: label(url) });
    }
    const literal = withSecond((p) => set(p, 'javascript:alert(1)'));
    expect(links(literal)).toHaveLength(perPerson * 2 - 1);
    expect(readBack(literal).some((block) => block.includes('javascript:alert(1)'))).toBe(true);
  });

  it('renders image as an image of the person, src the URL, alt the name', () => {
    const url = 'https://example.org/a b/(c)?q=<x>&amp;[y].jpg';
    const name = 'Jane *x* [y](https://e.org)';
    const text = withSecond((p) => {
      p.image = url;
      p.name = name;
    });
    const found = images(text);
    expect(found.map((i) => i.src)).toEqual([normalizeLink(person.image), normalizeLink(url)]);
    expect(found.map((i) => i.alt)).toEqual([person.name, name]);
  });

  it('renders a non-http(s) image as literal text with no image token', () => {
    const text = withSecond((p) => (p.image = 'data:image/png;base64,AAAA'));
    expect(inlineTypes(text).has('image')).toBe(true);
    expect(inlineTokens(text).filter((t) => t.type === 'image')).toHaveLength(1);
    expect(readBack(text).some((block) => block.includes('data:image/png;base64,AAAA'))).toBe(true);
  });

  /**
   * A section label directly under a list was a lazy continuation of the list's last item, so
   * `- J. Smith` read back as `J. Smith\nOther identifiers:`. Each label is its own paragraph.
   */
  it('keeps each section label out of the list item above it', () => {
    const blocks = readBack(render(fixture));
    for (const label of ['Other names:', 'Other identifiers:', 'Sources:']) {
      expect(blocks.filter((block) => block === label)).toHaveLength(2);
    }
  });

  /** The #37/#38 empty-field rules: an empty note leaves no `_()_`, `: `, or empty parenthetical. */
  it('leaves no stray punctuation for an empty note', () => {
    const blocks = readBack(render(fixture));
    expect(blocks).toContain('J. Smith');
    expect(blocks).toContain('https://leg.wa.gov/roster');
    const lines = blocks.flatMap((block) => block.split('\n'));
    expect(lines).toContain('Links: website, https://x.example.gov/jsmith');
  });

  /**
   * Characterization: every non-blank line carrying no URL field is byte-identical to the pre-#53
   * output (blank lines now separate the section labels from the list above them).
   */
  it('renders real-shaped values byte-identical outside the URL lines', () => {
    const text = render({ results: [person], pagination: { ...pagination, total_items: 1 } });
    const kept = text.split('\n').filter((line) => line !== '' && !line.includes('https://'));
    expect(kept).toEqual([
      '**1 legislators** (page 1/1, per page 10, showing 1)',
      '## Jane Smith',
      '**ID:** ocd-person/9eddb3cd-868e-42ba-831a-b415fd7ed445',
      '**Given name:** Jane | **Family name:** Smith',
      '**Party:** Democratic',
      '**Jurisdiction:** Washington (ocd-jurisdiction/country:us/state:wa/government)',
      '**Role:** Senator (upper) — District At-Large',
      '**Division:** ocd-division/country:us/state:wa/sldu:37',
      '**Email:** jane_smith@leg.wa.gov',
      '**Office:** Capitol Office [capitol] | Phone: 360-786-7660 | Fax: 360-786-1999 | Address: PO Box 40437; Olympia, WA 98504',
      '**Other names:**',
      '- Jane A. Smith _(ballot name)_',
      '- J. Smith',
      '**Other identifiers:**',
      '- WAL000123 (legacy_openstates)',
      '**Sources:**',
    ]);
  });
});

/**
 * Issue #53, server-authored enrichment: caller input quoted in the empty-result notice and the
 * applied-filters trailer reads back literally on the assembled `content[]`, and the notice in
 * `structuredContent` is the same Markdown.
 */
describe('searchPeople — enrichment carries caller input literally (issue #53)', () => {
  const hostileName = '*x* [y](https://e.org)';

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchPeople: vi.fn().mockResolvedValue({
        results: [],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
      }),
    } as never);
  });

  const contentText = (result: Awaited<ReturnType<typeof runToolContract>>) =>
    (result.content ?? []).map((block) => (block as { text: string }).text).join('');

  it('quotes a filter search verbatim in the notice and the trailer', async () => {
    const result = await runToolContract(searchPeople, {
      jurisdiction: '<b>wa</b>',
      name: hostileName,
      district: '_37_',
    });
    const text = contentText(result);
    const types = inlineTypes(text);
    for (const markup of ['em_open', 'link_open', 'image', 'html_inline']) {
      expect(types.has(markup), markup).toBe(false);
    }
    const quoted = `jurisdiction="<b>wa</b>", name="${hostileName}", district="_37_"`;
    expect(readBack(text).some((block) => block.includes(quoted))).toBe(true);

    const structured = result.structuredContent as { notice: string; appliedFilters: unknown };
    expect(readBack(structured.notice).join('')).toContain(quoted);
    const codes = inlineTokens(text).filter((t) => t.type === 'code_inline');
    expect(codes.map((t) => t.content)).toContain(JSON.stringify(structured.appliedFilters));
  });

  it('quotes an id lookup verbatim in the notice', async () => {
    const id = 'ocd-person/*x*_[y](https://e.org)';
    const result = await runToolContract(searchPeople, { id: [id] });
    const text = contentText(result);
    expect(inlineTypes(text).has('em_open')).toBe(false);
    expect(inlineTypes(text).has('link_open')).toBe(false);
    expect(readBack(text).some((block) => block.includes(`id=${JSON.stringify([id])}`))).toBe(true);
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
    // The declared hint is filled by the framework, so the assertion runs through the contract.
    const result = await runToolContract(searchPeople, { jurisdiction: 'wa', page: 99 });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          // The upstream constraint survives the remap — it names the range the caller must stay inside.
          message: expect.stringContaining('invalid page, must be in [1, 5]'),
          data: { reason: 'invalid_page', recovery: { hint: expect.stringContaining('max_page') } },
        },
      },
    });
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

  it('rejects an undeclared party key at the contract boundary', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const searchPeopleSpy = vi.fn().mockResolvedValue({
      results: [mockPerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    });
    vi.mocked(getOpenStatesApiService).mockReturnValue({ searchPeople: searchPeopleSpy } as never);

    const result = await runToolContract(searchPeople, {
      jurisdiction: 'wa',
      party: 'Democratic',
    } as never);

    /**
     * An argument rejection is `InvalidParams` (-32602), not `ValidationError` (-32007): the
     * framework parses arguments before the handler runs, so the call never reaches this tool's
     * own validation. A `ValidationError` thrown inside a handler, and an output-schema
     * rejection, keep -32007.
     */
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.InvalidParams,
          message: expect.stringContaining('party'),
          data: {
            reason: 'invalid_arguments',
            // The synthesized hint names the keys the tool does accept, which is what makes the
            // rejection actionable for a model that guessed at a filter.
            recovery: { hint: expect.stringContaining('jurisdiction') },
          },
        },
      },
    });
    /**
     * Both consumption surfaces have to carry the rejection: a client reading `content[]` sees
     * the same offending key, the same hint, and the machine-readable reason. Asserted by
     * containment — the framework appends its `Recovery:` and `(reason …)` lines, so a
     * byte-exact pin would break on the next framework release.
     */
    const [block] = result.content ?? [];
    const text = (block as { text: string }).text;
    expect(text).toContain('party');
    expect(text).toContain('Recovery: Unknown key party');
    expect(text).toContain('reason invalid_arguments');
    expect(searchPeopleSpy).not.toHaveBeenCalled();
  });

  it('still reports party on every result', () => {
    const parsed = searchPeople.output.parse({
      results: [mockPerson],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    });
    expect(parsed.results[0]?.party).toBe('Democratic');
  });
});
