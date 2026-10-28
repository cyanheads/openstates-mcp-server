/**
 * @fileoverview Tests for the searchCommittees tool.
 * @module tests/tools/search-committees.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchCommittees } from '@/mcp-server/tools/definitions/search-committees.tool.js';
import {
  inlineTokens,
  inlineTypes,
  links,
  normalizeLink,
  readBack,
} from '../helpers/commonmark.js';
import { AUTHORED_INLINE, HOSTILE, leaves, withLeaf } from '../helpers/markdown-sweep.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
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
    const ctx = createMockContext({ errors: searchCommittees.errors });
    const input = searchCommittees.input.parse({ jurisdiction: 'wa' });
    const result = await searchCommittees.handler(input, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.id).toBe('ocd-organization/comm-1');
    expect(result.results[0]!.name).toBe('Committee on Transportation');
    const enrichment = getEnrichment(ctx);
    expect(enrichment.coverageNote).toBeDefined();
    expect(enrichment.coverageNote).toContain('experimental');
  });

  /**
   * `GET /committees` with no jurisdiction returned `200 {"total_items": 0}` when the previous
   * description was written; upstream no longer answers it at all — it sits on the gateway for
   * its full ~60s window and returns 504. The requirement used to live only in the handler, which
   * left `tools/list` advertising `required: []`; it is now a schema constraint.
   */
  describe('jurisdiction is required by the input schema (issue #35)', () => {
    /**
     * `io: 'input'` reads the schema `tools/list` advertises. The default `'output'` view treats
     * a defaulted field as always-present, so it lists `page`/`per_page` under `required` — an
     * artifact no client ever sees.
     */
    it('advertises jurisdiction, and only jurisdiction, in the wire required list', () => {
      const { required = [] } = z.toJSONSchema(searchCommittees.input, { io: 'input' }) as {
        required?: string[];
      };
      expect(required).toContain('jurisdiction');
      expect(required).not.toContain('page');
      expect(required).not.toContain('per_page');
    });

    it('rejects an omitted jurisdiction', () => {
      expect(searchCommittees.input.safeParse({}).success).toBe(false);
    });

    it('rejects a chamber-only request — a chamber does not scope the all-states query', () => {
      expect(searchCommittees.input.safeParse({ chamber: 'upper' }).success).toBe(false);
    });

    it('rejects an empty-string jurisdiction', () => {
      expect(searchCommittees.input.safeParse({ jurisdiction: '' }).success).toBe(false);
    });

    it('no longer declares a jurisdiction_required reason — the schema owns the constraint', () => {
      expect(searchCommittees.errors?.map((e) => e.reason)).not.toContain('jurisdiction_required');
    });
  });

  it('still issues the request when only a chamber accompanies the jurisdiction', async () => {
    const ctx = createMockContext({ errors: searchCommittees.errors });
    const input = searchCommittees.input.parse({ jurisdiction: 'wa', chamber: 'upper' });
    await searchCommittees.handler(input, ctx);
    expect(mockService.searchCommittees).toHaveBeenCalledTimes(1);
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

    const ctx = createMockContext({ errors: searchCommittees.errors });
    const input = searchCommittees.input.parse({ jurisdiction: 'wa', include: ['memberships'] });
    const result = await searchCommittees.handler(input, ctx);
    expect(result.results[0]!.memberships).toBeDefined();
    expect(result.results[0]!.memberships?.[0]?.role).toBe('chair');
  });

  it('filters by chamber when provided', async () => {
    const ctx = createMockContext({ errors: searchCommittees.errors });
    const input = searchCommittees.input.parse({ jurisdiction: 'wa', chamber: 'upper' });
    await searchCommittees.handler(input, ctx);
    expect(mockService.searchCommittees).toHaveBeenCalledWith(
      expect.objectContaining({ chamber: 'upper' }),
      expect.anything(),
    );
  });

  it('forwards a full state name plus chamber to the service (normalization is service-side)', async () => {
    // The tool passes jurisdiction through verbatim; the service normalizes the name to an
    // abbreviation before the request. This guards the tool→service boundary for the shape that
    // previously produced an upstream 500.
    const ctx = createMockContext({ errors: searchCommittees.errors });
    const input = searchCommittees.input.parse({ jurisdiction: 'Texas', chamber: 'upper' });
    await searchCommittees.handler(input, ctx);
    expect(mockService.searchCommittees).toHaveBeenCalledWith(
      expect.objectContaining({ jurisdiction: 'Texas', chamber: 'upper' }),
      expect.anything(),
    );
  });

  it('always sets coverageNote enrichment regardless of result count', async () => {
    mockService.searchCommittees.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext({ errors: searchCommittees.errors });
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
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0]! as { text: string }).text;
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
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Jane Smith');
    expect(text).toContain('chair');
    expect(text).toContain('ocd-person/abc');
  });

  it.each([
    [
      'all fields present',
      { role: 'chair', person_id: 'ocd-person/abc' },
      'Jane Smith (chair) — ID: ocd-person/abc',
    ],
    ['empty role', { role: '', person_id: 'ocd-person/abc' }, 'Jane Smith — ID: ocd-person/abc'],
    ['empty person_id', { role: 'chair', person_id: '' }, 'Jane Smith (chair)'],
    ['both empty', { role: '', person_id: '' }, 'Jane Smith'],
  ])('member line leaves no orphaned punctuation: %s', (_label, fields, expected) => {
    const result = {
      results: [{ ...mockCommittee, memberships: [{ person_name: 'Jane Smith', ...fields }] }],
      pagination: mockCommitteeResult.pagination,
    };
    const text = (searchCommittees.format!(result)[0]! as { text: string }).text;
    expect(readBack(text)).toContain(expected);
  });

  it('echoes applied filters in enrichment for self-verification', async () => {
    const ctx = createMockContext({ errors: searchCommittees.errors });
    const input = searchCommittees.input.parse({
      jurisdiction: 'wa',
      classification: 'subcommittee',
      chamber: 'upper',
    });
    await searchCommittees.handler(input, ctx);
    expect(getEnrichment(ctx).appliedFilters).toMatchObject({
      jurisdiction: 'wa',
      classification: 'subcommittee',
      chamber: 'upper',
      page: 1,
      per_page: 10,
    });
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18). search_committees
 * advertises links and sources via `include` (memberships already surfaced), but the tool output
 * schema declared neither — so Zod stripped the keys on the structuredContent path and format()
 * never rendered them on the content[] path, even though the service already carried them through
 * verbatim. Fixture shapes mirror the Committee interface in src/services/openstates/types.ts
 * (links is PersonLink[] = { note, url }).
 */
describe('searchCommittees — include enrichment surfacing (links, sources)', () => {
  const enrichedCommittee = {
    ...mockCommittee,
    links: [{ note: 'homepage', url: 'https://committee.example.gov' }],
    sources: [{ url: 'https://leg.example.gov/committee-roster', note: 'official roster' }],
  };

  /** structuredContent path — output.parse strips undeclared keys, which is how these dropped. */
  it('retains links and sources through the output schema', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = {
      searchCommittees: vi.fn().mockResolvedValue({
        results: [enrichedCommittee],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);

    const ctx = createMockContext({ errors: searchCommittees.errors });
    const input = searchCommittees.input.parse({
      jurisdiction: 'tx',
      include: ['links', 'sources'],
    });
    const handlerResult = await searchCommittees.handler(input, ctx);
    const committee = searchCommittees.output.parse(handlerResult).results[0]!;

    expect(committee.links).toEqual([{ note: 'homepage', url: 'https://committee.example.gov' }]);
    expect(committee.sources).toEqual([
      { url: 'https://leg.example.gov/committee-roster', note: 'official roster' },
    ]);
  });

  /** content[] path. format() rendered neither pre-fix. */
  it('renders links and sources in format() text', () => {
    const blocks = searchCommittees.format!({
      results: [enrichedCommittee],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
    });
    const text = (blocks[0]! as { text: string }).text;
    expect(links(text)).toEqual([
      { href: 'https://committee.example.gov', label: 'homepage' },
      { href: 'https://leg.example.gov/committee-roster', label: 'official roster' },
    ]);
  });
});

/**
 * A committee link with an empty upstream `note` rendered as a dangling `: ` in front of the URL
 * on the `content[]` path. `structuredContent` keeps `note: ""` — it is the accurate value.
 */
describe('searchCommittees — link rendering with an empty note', () => {
  const pagination = { page: 1, per_page: 10, max_page: 1, total_items: 1 };

  it('renders the URL alone when the note is empty', () => {
    const blocks = searchCommittees.format!({
      results: [
        {
          ...mockCommittee,
          links: [{ url: 'https://committee.example.gov', note: '' }],
        },
      ],
      pagination,
    });
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)).toContain(
      'ID: ocd-organization/comm-1\nClassification: committee\nLinks: https://committee.example.gov',
    );
    expect(links(text)).toEqual([
      { href: 'https://committee.example.gov', label: 'https://committee.example.gov' },
    ]);
  });

  it('renders a source URL alone when its note is empty — no stray _()_', () => {
    const blocks = searchCommittees.format!({
      results: [{ ...mockCommittee, sources: [{ url: 'https://leg.example.gov/src', note: '' }] }],
      pagination,
    });
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)).toContain('https://leg.example.gov/src');
    expect(inlineTypes(text).has('em_open')).toBe(false);
    expect(links(text)).toEqual([
      { href: 'https://leg.example.gov/src', label: 'https://leg.example.gov/src' },
    ]);
  });

  it('still labels a link that has a note', () => {
    const blocks = searchCommittees.format!({
      results: [
        {
          ...mockCommittee,
          links: [{ url: 'https://committee.example.gov', note: 'homepage' }],
        },
      ],
      pagination,
    });
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)).toContain(
      'ID: ocd-organization/comm-1\nClassification: committee\nLinks: homepage',
    );
    expect(links(text)).toEqual([{ href: 'https://committee.example.gov', label: 'homepage' }]);
  });
});

/**
 * Paging past the end of a result set 404s upstream. Without a declared reason the caller got a
 * bare status with no `data.reason` and no recovery hint.
 */
describe('searchCommittees — out-of-range page', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchCommittees: vi
        .fn()
        .mockRejectedValue(
          new McpError(
            JsonRpcErrorCode.NotFound,
            'Open States rejected the request: invalid page, must be in [1, 2].',
            { status: 404 },
          ),
        ),
    } as never);
  });

  it('maps an upstream not-found to invalid_page with a recovery hint', async () => {
    // The declared hint is filled by the framework, so the assertion runs through the contract.
    const result = await runToolContract(searchCommittees, { jurisdiction: 'wa', page: 99 });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          message: expect.stringContaining('invalid page, must be in [1, 2]'),
          data: { reason: 'invalid_page', recovery: { hint: expect.stringContaining('max_page') } },
        },
      },
    });
  });
});

/**
 * The enrichment trailer is assembled after `format()`, so these run through the contract. A
 * custom `appliedFilters` render emitted the caller's filters as live Markdown, and the 0.13.18
 * default rendered the server-authored `coverageNote` sentence as a code span.
 */
describe('searchCommittees — enrichment trailer (#53)', () => {
  const hostile = '*x* [y](https://e.org)';

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchCommittees: vi.fn().mockResolvedValue({
        results: [],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
      }),
    } as never);
  });

  const trailerOf = async () => {
    const result = await runToolContract(searchCommittees, { jurisdiction: hostile });
    return (result.content.at(-1) as { text: string }).text;
  };

  it('renders appliedFilters as one code literal carrying caller input verbatim', async () => {
    const trailer = await trailerOf();
    expect(inlineTypes(trailer).has('em_open')).toBe(false);
    expect(inlineTypes(trailer).has('link_open')).toBe(false);
    expect(
      inlineTokens(trailer)
        .filter((t) => t.type === 'code_inline')
        .map((t) => t.content),
    ).toEqual([JSON.stringify({ jurisdiction: hostile, page: 1, per_page: 10 })]);
  });

  it('renders coverageNote as prose, not a code span', async () => {
    const trailer = await trailerOf();
    const note = inlineTokens(trailer).find((t) => t.content.includes('Committee data is'));
    expect(note?.type).toBe('text');
    expect(readBack(trailer)).toEqual([
      `0 total\npage: 1\nmaxPage: 1\ncoverageNote: Committee data is experimental — Open States is working to restore support and not all states have coverage. Empty results may indicate the state lacks data, not that no committees exist.\nappliedFilters: ${JSON.stringify({ jurisdiction: hostile, page: 1, per_page: 10 })}`,
    ]);
  });
});

/** #51: the service's `rate_limited` error reaches the caller with the declared recovery. */
describe('searchCommittees — rate_limited contract (#51)', () => {
  it('surfaces a service rate_limited error with the declared recovery hint', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchCommittees: vi.fn().mockRejectedValue(
        new McpError(JsonRpcErrorCode.RateLimited, 'exceeded limit of 10/min: 11', {
          reason: 'rate_limited',
          retryable: true,
          retryAfter: 42,
        }),
      ),
    } as never);

    const result = await runToolContract(searchCommittees, { jurisdiction: 'wa' });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.RateLimited,
          data: {
            reason: 'rate_limited',
            retryable: true,
            retryAfter: 42,
            recovery: {
              hint: 'Wait the number of seconds in retryAfter, then retry the same call unchanged.',
            },
          },
        },
      },
    });
  });
});

/**
 * Markdown fidelity (#53): every upstream string `format()` renders reads back exactly from a
 * CommonMark parse, and every URL field renders as one link. The sweep sets one string leaf of a
 * fully populated record at a time to each hostile class and checks the whole rendered document.
 */
describe('searchCommittees — Markdown fidelity (#53)', () => {
  const committee = {
    id: 'ocd-organization/comm-1',
    name: 'Committee on Transportation',
    classification: 'committee',
    parent_id: 'ocd-organization/comm-0',
    memberships: [{ person_id: 'ocd-person/abc', person_name: 'Jane Smith', role: 'chair' }],
    links: [{ url: 'https://committee.example.gov/home', note: 'homepage' }],
    sources: [{ url: 'https://leg.example.gov/roster', note: 'official roster' }],
  };
  const full = {
    results: [committee],
    pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
  };
  const render = (result: typeof full) =>
    (searchCommittees.format!(searchCommittees.output.parse(result))[0]! as { text: string }).text;

  it.each(Object.entries(HOSTILE))('reads back %s in every rendered string field', (_, payload) => {
    const fields = leaves(full, false);
    expect(fields).toHaveLength(9);
    for (const path of fields) {
      // A line break cannot ride an ATX heading — out of scope for heading-slot values.
      if (path[2] === 'name' && payload.includes('\n')) continue;
      const text = render(withLeaf(full, path, payload));
      const where = path.join('.');
      expect(readBack(text).join('\n'), where).toContain(payload);
      expect(
        links(text).map((l) => l.href),
        where,
      ).toEqual(['https://committee.example.gov/home', 'https://leg.example.gov/roster']);
      expect(
        [...inlineTypes(text)].filter((t) => !AUTHORED_INLINE.has(t)),
        where,
      ).toEqual([]);
    }
  });

  it.each([
    'https://committee.example.gov/a b',
    'https://committee.example.gov/p_(x)*y*',
    'https://committee.example.gov/q?a=<1>&b=[2]',
    'https://committee.example.gov/r?x=1&amp;y=2',
  ])('renders each URL field as one link to %s', (url) => {
    const fields = leaves(full, true);
    expect(fields).toHaveLength(2);
    for (const path of fields) {
      const found = links(render(withLeaf(full, path, url)));
      expect(found, path.join('.')).toHaveLength(2);
      expect(
        found.filter((l) => l.href === normalizeLink(url)),
        path.join('.'),
      ).toHaveLength(1);
    }
  });

  it('renders a non-http(s) URL as literal text with no link token', () => {
    for (const path of leaves(full, true)) {
      const text = render(withLeaf(full, path, 'javascript:alert(1)'));
      expect(links(text), path.join('.')).toHaveLength(1);
      expect(readBack(text).join('\n'), path.join('.')).toContain('javascript:alert(1)');
    }
  });

  /** Real-shaped values pass through the encoders unchanged — pinned against the pre-#53 text. */
  it('renders real-shaped identifiers byte-identical', () => {
    const { links: _l, sources: _s, ...noUrls } = committee;
    expect(
      render({
        ...full,
        results: [
          {
            ...noUrls,
            id: 'ocd-organization/8e4b0a3c-1f2d-4c5e-9a7b-2d6f0e1c3b4a',
            parent_id: 'ocd-organization/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e',
            memberships: [
              {
                person_id: 'ocd-person/1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
                person_name: 'Jane Smith',
                role: 'chair',
              },
            ],
          } as typeof committee,
        ],
      }),
    ).toBe(
      '**1 committees** (page 1/1, per page 10, showing 1)\n\n## Committee on Transportation\n**ID:** ocd-organization/8e4b0a3c-1f2d-4c5e-9a7b-2d6f0e1c3b4a\n**Classification:** committee\n**Parent ID:** ocd-organization/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e\n**Members:**\n- Jane Smith (chair) — ID: ocd-person/1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
    );
  });
});
