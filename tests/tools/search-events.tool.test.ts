/**
 * @fileoverview Tests for the searchEvents tool.
 * @module tests/tools/search-events.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchEvents } from '@/mcp-server/tools/definitions/search-events.tool.js';
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

const mockEvent = {
  id: 'ocd-event/evt-1',
  name: 'Transportation Committee Hearing',
  description: 'Public hearing on HB 1000',
  classification: 'committee-meeting',
  start_date: '2025-03-15T09:00:00',
  end_date: '2025-03-15T12:00:00',
  status: 'passed',
  jurisdiction: {
    id: 'ocd-jurisdiction/country:us/state:wa/government',
    name: 'Washington',
  },
};

const mockEventResult = {
  results: [mockEvent],
  pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
};

describe('searchEvents', () => {
  let mockService: { searchEvents: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { searchEvents: vi.fn().mockResolvedValue(mockEventResult) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns events for a jurisdiction', async () => {
    const ctx = createMockContext({ errors: searchEvents.errors });
    const input = searchEvents.input.parse({ jurisdiction: 'wa' });
    const result = await searchEvents.handler(input, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.id).toBe('ocd-event/evt-1');
    expect(result.results[0]!.name).toBe('Transportation Committee Hearing');
  });

  /**
   * The Open States /events endpoint requires jurisdiction and answers
   * `400 must provide 'jurisdiction' parameter` without it — there is no all-states event search.
   * The requirement used to live only in the handler, which left `tools/list` advertising
   * `required: []`; it is now a schema constraint, so the invalid call is unconstructible.
   */
  describe('jurisdiction is required by the input schema (issue #35)', () => {
    /**
     * `io: 'input'` reads the schema `tools/list` advertises. The default `'output'` view treats
     * a defaulted field as always-present, so it lists `page`/`per_page` under `required` — an
     * artifact no client ever sees.
     */
    it('advertises jurisdiction, and only jurisdiction, in the wire required list', () => {
      const { required = [] } = z.toJSONSchema(searchEvents.input, { io: 'input' }) as {
        required?: string[];
      };
      expect(required).toContain('jurisdiction');
      expect(required).not.toContain('page');
      expect(required).not.toContain('per_page');
    });

    it('rejects an omitted jurisdiction', () => {
      expect(searchEvents.input.safeParse({}).success).toBe(false);
    });

    it('rejects a date-range-only search — a date range does not scope the query', () => {
      expect(searchEvents.input.safeParse({ after: '2025-03-01' }).success).toBe(false);
    });

    it('rejects an empty-string jurisdiction', () => {
      expect(searchEvents.input.safeParse({ jurisdiction: '' }).success).toBe(false);
    });

    it('no longer declares a jurisdiction_required reason — the schema owns the constraint', () => {
      expect(searchEvents.errors?.map((e) => e.reason)).not.toContain('jurisdiction_required');
    });
  });

  it('returns empty results with enrichment notice on experimental coverage', async () => {
    mockService.searchEvents.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext({ errors: searchEvents.errors });
    const input = searchEvents.input.parse({ jurisdiction: 'wa' });
    const result = await searchEvents.handler(input, ctx);
    expect(result.results).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.coverageNote).toBeDefined();
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('experimental');
  });

  it('passes date range filters to service', async () => {
    const ctx = createMockContext({ errors: searchEvents.errors });
    const input = searchEvents.input.parse({
      jurisdiction: 'wa',
      after: '2025-03-01',
      before: '2025-04-01',
    });
    await searchEvents.handler(input, ctx);
    expect(mockService.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ after: '2025-03-01', before: '2025-04-01' }),
      expect.anything(),
    );
  });

  it('includes agenda when requested', async () => {
    const eventWithAgenda = {
      ...mockEvent,
      agenda: [
        {
          description: 'HB 1000 — Public Safety',
          classification: ['bill'],
          subjects: ['public safety'],
          related_entities: [{ name: 'HB 1000', entity_type: 'bill' }],
        },
      ],
    };
    mockService.searchEvents.mockResolvedValue({
      results: [eventWithAgenda],
      pagination: mockEventResult.pagination,
    });

    const ctx = createMockContext({ errors: searchEvents.errors });
    const input = searchEvents.input.parse({ jurisdiction: 'wa', include: ['agenda'] });
    const result = await searchEvents.handler(input, ctx);
    expect(result.results[0]!.agenda).toBeDefined();
    expect(result.results[0]!.agenda?.[0]?.description).toContain('HB 1000');
  });

  it('formats output with event id, name, and jurisdiction', () => {
    const result = {
      results: [mockEvent],
      pagination: mockEventResult.pagination,
    };
    const blocks = searchEvents.format!(result);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Transportation Committee Hearing');
    expect(text).toContain('ocd-event/evt-1');
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
    expect(text).toContain('1 events');
  });

  it('formats agenda items when included', () => {
    const result = {
      results: [
        {
          ...mockEvent,
          agenda: [
            {
              description: 'HB 1000 — Public Safety',
              classification: ['bill'],
              subjects: ['public safety'],
              related_entities: [{ name: 'HB 1000', entity_type: 'bill' }],
            },
          ],
        },
      ],
      pagination: mockEventResult.pagination,
    };
    const blocks = searchEvents.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('HB 1000 — Public Safety');
    expect(text).toContain('HB 1000');
    expect(text).toContain('bill');
  });

  it('formats empty results without error', () => {
    const result = {
      results: [],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
    };
    const blocks = searchEvents.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('0 events');
  });

  it('echoes applied filters in enrichment for self-verification', async () => {
    const ctx = createMockContext({ errors: searchEvents.errors });
    const input = searchEvents.input.parse({
      jurisdiction: 'wa',
      after: '2025-03-01',
      before: '2025-04-01',
      require_bills: true,
    });
    await searchEvents.handler(input, ctx);
    expect(getEnrichment(ctx).appliedFilters).toMatchObject({
      jurisdiction: 'wa',
      after: '2025-03-01',
      before: '2025-04-01',
      require_bills: true,
      page: 1,
      per_page: 10,
    });
  });

  it('accepts ISO 8601 date-only and datetime for after/before', () => {
    expect(() =>
      searchEvents.input.parse({ jurisdiction: 'wa', after: '2025-03-01' }),
    ).not.toThrow();
    expect(() =>
      searchEvents.input.parse({ jurisdiction: 'wa', before: '2025-04-01T00:00:00Z' }),
    ).not.toThrow();
  });

  it('rejects malformed date filters before the API call', () => {
    expect(() => searchEvents.input.parse({ jurisdiction: 'wa', after: 'next week' })).toThrow();
    expect(() => searchEvents.input.parse({ jurisdiction: 'wa', before: '04/01/2025' })).toThrow();
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18). search_events advertises
 * links, sources, media, and documents via `include`, but the output schema declared no fields
 * for them, so strict output parsing stripped them from both the structuredContent and content[]
 * paths. Fixture shapes mirror the Event interface in src/services/openstates/types.ts (links and
 * sources are `{ url, note }`; media and documents are records whose URLs sit in `links[]`).
 */
describe('searchEvents — include enrichment surfacing (links, sources, media, documents)', () => {
  const media = [
    {
      note: 'Video recording',
      date: '',
      classification: '',
      links: [{ url: 'https://tvw.org/video/1' }],
    },
  ];
  const documents = [
    {
      note: 'Agenda PDF',
      date: '',
      classification: '',
      links: [{ url: 'https://leg.wa.gov/agenda.pdf' }],
    },
  ];
  const enrichedEvent = {
    ...mockEvent,
    links: [{ note: 'Hearing notice', url: 'https://leg.wa.gov/notice' }],
    sources: [{ url: 'https://leg.wa.gov/source', note: 'official calendar' }],
    media,
    documents,
  };
  const enrichedResult = {
    results: [enrichedEvent],
    pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
  };

  it('carries links, sources, media, and documents through the output schema', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = { searchEvents: vi.fn().mockResolvedValue(enrichedResult) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);

    const ctx = createMockContext({ errors: searchEvents.errors });
    const input = searchEvents.input.parse({
      jurisdiction: 'wa',
      include: ['links', 'sources', 'media', 'documents'],
    });
    const handlerResult = await searchEvents.handler(input, ctx);
    const parsed = searchEvents.output.parse(handlerResult);
    const event = parsed.results[0]!;
    expect(event.links).toEqual([{ note: 'Hearing notice', url: 'https://leg.wa.gov/notice' }]);
    expect(event.sources).toEqual([
      { url: 'https://leg.wa.gov/source', note: 'official calendar' },
    ]);
    expect(event.media).toEqual(media);
    expect(event.documents).toEqual(documents);
  });

  /** content[] path — format() rendered none of these pre-fix. */
  it('renders links, sources, media, and documents in format() text', () => {
    const blocks = searchEvents.format!(enrichedResult);
    const text = (blocks[0]! as { text: string }).text;
    expect(links(text)).toEqual([
      { href: 'https://leg.wa.gov/notice', label: 'Hearing notice' },
      { href: 'https://leg.wa.gov/source', label: 'official calendar' },
      { href: 'https://tvw.org/video/1', label: 'Video recording' },
      { href: 'https://leg.wa.gov/agenda.pdf', label: 'Agenda PDF' },
    ]);
  });
});

/**
 * Regression coverage for participant role sparsity (issue #19). Open States omits `role` on some
 * participants; the output schema required a string, so a valid search converted into a
 * serialization error, and format() printed the literal "undefined". Pre-fix, output.parse throws
 * on the role-less participant and format() emits "undefined".
 */
describe('searchEvents — participant without upstream role (issue #19)', () => {
  const eventRolelessParticipant = {
    ...mockEvent,
    participants: [
      { name: 'Committee on Transportation', entity_type: 'organization', role: 'host' },
      { name: 'Jane Doe', entity_type: 'person' },
    ],
  };
  const rolelessResult = {
    results: [eventRolelessParticipant],
    pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
  };

  it('accepts a role-less participant through the output schema', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = { searchEvents: vi.fn().mockResolvedValue(rolelessResult) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);

    const ctx = createMockContext({ errors: searchEvents.errors });
    const input = searchEvents.input.parse({ jurisdiction: 'ca', include: ['participants'] });
    const handlerResult = await searchEvents.handler(input, ctx);
    const parsed = searchEvents.output.parse(handlerResult);
    expect(parsed.results[0]!.participants).toHaveLength(2);
    expect(parsed.results[0]!.participants?.[0]?.role).toBe('host');
    expect(parsed.results[0]!.participants?.[1]?.role).toBeUndefined();
  });

  it('renders a role-less participant without printing "undefined"', () => {
    const blocks = searchEvents.format!(rolelessResult);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Jane Doe');
    expect(text).not.toContain('undefined');
  });
});

/**
 * Links, media, and documents render each URL labeled by its note. Open States often supplies an empty
 * `note`, which put a dangling separator in front of every URL on the `content[]` path.
 * `structuredContent` keeps `note: ""` — it is the accurate upstream value.
 */
describe('searchEvents — link, media, and document rendering with an empty note', () => {
  const pagination = { page: 1, per_page: 10, max_page: 1, total_items: 1 };

  const render = (event: Record<string, unknown>) =>
    (
      searchEvents.format!({
        results: [{ ...mockEvent, ...event }],
        pagination,
      })[0]! as { text: string }
    ).text;

  /** The event block's read-back ends with the list line; nothing precedes the URL but its label. */
  const lastLine = (text: string) => readBack(text).at(-1)!.split('\n').at(-1);

  it('renders a link URL alone when the note is empty', () => {
    const url = 'https://leg.example.gov/hearing';
    const text = render({ links: [{ url, note: '' }] });
    expect(lastLine(text)).toBe(`Links: ${url}`);
    expect(links(text)).toEqual([{ href: url, label: url }]);
  });

  it('renders a media URL alone when the note is empty', () => {
    const url = 'https://tvw.example.org/clip';
    const text = render({ media: [{ note: '', date: '', classification: '', links: [{ url }] }] });
    expect(lastLine(text)).toBe(`Media: ${url}`);
    expect(links(text)).toEqual([{ href: url, label: url }]);
  });

  it('renders a document URL alone when the note is empty', () => {
    const url = 'https://leg.example.gov/agenda.pdf';
    const text = render({
      documents: [{ note: '', date: '', classification: '', links: [{ url }] }],
    });
    expect(lastLine(text)).toBe(`Documents: ${url}`);
    expect(links(text)).toEqual([{ href: url, label: url }]);
  });

  it('renders a source URL alone when the note is empty — no stray ()', () => {
    const url = 'https://leg.example.gov/src';
    const text = render({ sources: [{ url, note: '' }] });
    expect(lastLine(text)).toBe(`Sources: ${url}`);
    expect(links(text)).toEqual([{ href: url, label: url }]);
  });

  it('still labels each list when the note is present', () => {
    const text = render({
      links: [{ url: 'https://leg.example.gov/hearing', note: 'hearing notice' }],
      media: [
        {
          note: 'video',
          date: '',
          classification: '',
          links: [{ url: 'https://tvw.example.org/clip' }],
        },
      ],
      documents: [
        {
          note: 'agenda',
          date: '',
          classification: '',
          links: [{ url: 'https://leg.example.gov/agenda.pdf' }],
        },
      ],
    });
    expect(readBack(text).at(-1)).toMatch(
      /\nLinks: hearing notice\nMedia: video\nDocuments: agenda$/,
    );
    expect(links(text)).toEqual([
      { href: 'https://leg.example.gov/hearing', label: 'hearing notice' },
      { href: 'https://tvw.example.org/clip', label: 'video' },
      { href: 'https://leg.example.gov/agenda.pdf', label: 'agenda' },
    ]);
  });
});

/**
 * Paging past the end of a result set 404s upstream. Without a declared reason the caller got a
 * bare status with no `data.reason` and no recovery hint.
 */
describe('searchEvents — out-of-range page', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchEvents: vi
        .fn()
        .mockRejectedValue(
          new McpError(
            JsonRpcErrorCode.NotFound,
            'Open States rejected the request: invalid page, must be in [1, 1].',
            { status: 404 },
          ),
        ),
    } as never);
  });

  it('maps an upstream not-found to invalid_page with a recovery hint', async () => {
    // The declared hint is filled by the framework, so the assertion runs through the contract.
    const result = await runToolContract(searchEvents, {
      jurisdiction: 'wa',
      page: 99,
      per_page: 3,
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          message: expect.stringContaining('invalid page, must be in [1, 1]'),
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
describe('searchEvents — enrichment trailer (#53)', () => {
  const hostile = '*x* [y](https://e.org)';
  const filters = JSON.stringify({
    jurisdiction: hostile,
    require_bills: false,
    page: 1,
    per_page: 10,
  });

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchEvents: vi.fn().mockResolvedValue(mockEventResult),
    } as never);
  });

  const trailerOf = async () => {
    const result = await runToolContract(searchEvents, { jurisdiction: hostile });
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
    ).toEqual([filters]);
  });

  it('renders coverageNote as prose, not a code span', async () => {
    const trailer = await trailerOf();
    const note = inlineTokens(trailer).find((t) => t.content.includes('Event data is'));
    expect(note?.type).toBe('text');
    expect(readBack(trailer)).toEqual([
      `1 total\npage: 1\nmaxPage: 1\ncoverageNote: Event data is experimental — most states do not publish event data to Open States. Empty results may indicate the state lacks data, not that no events occurred.\nappliedFilters: ${filters}`,
    ]);
  });
});

/** #51: the service's `rate_limited` error reaches the caller with the declared recovery. */
describe('searchEvents — rate_limited contract (#51)', () => {
  it('surfaces a service rate_limited error with the declared recovery hint', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchEvents: vi.fn().mockRejectedValue(
        new McpError(JsonRpcErrorCode.RateLimited, 'exceeded limit of 10/min: 11', {
          reason: 'rate_limited',
          retryable: true,
          retryAfter: 42,
        }),
      ),
    } as never);

    const result = await runToolContract(searchEvents, { jurisdiction: 'wa' });

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
describe('searchEvents — Markdown fidelity (#53)', () => {
  const event = {
    ...mockEvent,
    location: { name: 'Senate Hearing Room 1', url: 'https://leg.example.gov/room' },
    links: [{ url: 'https://leg.example.gov/link', note: 'hearing notice' }],
    sources: [{ url: 'https://leg.example.gov/src', note: 'official calendar' }],
    // Media exercises the record note standing in as a link label; documents, a lead note
    // before links that carry their own (#59).
    media: [
      {
        note: 'video',
        date: '2025-03-15',
        classification: 'recording',
        offset: 30,
        links: [
          { url: 'https://tvw.example.org/clip', note: 'MP4' },
          { url: 'https://tvw.example.org/clip-2' },
        ],
      },
    ],
    documents: [
      {
        note: 'agenda',
        date: '2025-03-14',
        classification: 'agenda',
        links: [{ url: 'https://leg.example.gov/agenda.pdf', note: 'PDF' }],
      },
    ],
    participants: [
      { name: 'Committee on Transportation', entity_type: 'organization', role: 'host' },
    ],
    agenda: [
      {
        description: 'HB 1000 hearing',
        classification: ['bill'],
        subjects: ['public safety'],
        related_entities: [{ name: 'HB 1000', entity_type: 'bill' }],
      },
    ],
  };
  const full = { results: [event], pagination: mockEventResult.pagination };
  const fullHrefs = [
    'https://leg.example.gov/room',
    'https://leg.example.gov/link',
    'https://leg.example.gov/src',
    'https://tvw.example.org/clip',
    'https://tvw.example.org/clip-2',
    'https://leg.example.gov/agenda.pdf',
  ];
  const render = (result: unknown) =>
    (searchEvents.format!(searchEvents.output.parse(result))[0]! as { text: string }).text;

  it.each(Object.entries(HOSTILE))('reads back %s in every rendered string field', (_, payload) => {
    const fields = leaves(full, false);
    expect(fields).toHaveLength(28);
    for (const path of fields) {
      // A line break cannot ride an ATX heading — out of scope for heading-slot values.
      if (path[2] === 'name' && payload.includes('\n')) continue;
      const text = render(withLeaf(full, path, payload));
      const where = path.join('.');
      expect(readBack(text).join('\n'), where).toContain(payload);
      expect(
        links(text).map((l) => l.href),
        where,
      ).toEqual(fullHrefs);
      expect(
        [...inlineTypes(text)].filter((t) => !AUTHORED_INLINE.has(t)),
        where,
      ).toEqual([]);
    }
  });

  it.each([
    'https://leg.example.gov/a b',
    'https://leg.example.gov/p_(x)*y*',
    'https://leg.example.gov/q?a=<1>&b=[2]',
    'https://leg.example.gov/r?x=1&amp;y=2',
  ])('renders each URL field as one link to %s', (url) => {
    const fields = leaves(full, true);
    expect(fields).toHaveLength(6);
    for (const path of fields) {
      const found = links(render(withLeaf(full, path, url)));
      expect(found, path.join('.')).toHaveLength(6);
      expect(
        found.filter((l) => l.href === normalizeLink(url)),
        path.join('.'),
      ).toHaveLength(1);
    }
  });

  it('renders a non-http(s) URL as literal text with no link token', () => {
    for (const path of leaves(full, true)) {
      const text = render(withLeaf(full, path, 'javascript:alert(1)'));
      expect(links(text), path.join('.')).toHaveLength(5);
      expect(readBack(text).join('\n'), path.join('.')).toContain('javascript:alert(1)');
    }
  });

  /** Real-shaped values pass through the encoders unchanged — pinned against the pre-#53 text. */
  it('renders real-shaped identifiers byte-identical', () => {
    expect(
      render({
        ...full,
        results: [
          {
            ...mockEvent,
            id: 'ocd-event/2f3e4d5c-6b7a-8c9d-0e1f-2a3b4c5d6e7f',
            start_date: '2025-03-15T09:00:00+00:00',
            end_date: '2025-03-15T12:00:00Z',
            location: { name: 'Senate Hearing Room 1' },
            participants: [...event.participants, { name: 'Jane Doe', entity_type: 'person' }],
            agenda: [
              {
                description: 'HB 1000',
                classification: ['bill', 'hearing'],
                subjects: ['public safety'],
                related_entities: [{ name: 'HB 1000', entity_type: 'bill' }],
              },
            ],
          },
        ],
      }),
    ).toBe(
      '**1 events** (page 1/1, per page 10, showing 1)\n\n## Transportation Committee Hearing\n**ID:** ocd-event/2f3e4d5c-6b7a-8c9d-0e1f-2a3b4c5d6e7f\n**Classification:** committee-meeting | **Status:** passed\n**Start:** 2025-03-15T09:00:00+00:00 | **End:** 2025-03-15T12:00:00Z\n**Jurisdiction:** Washington (ocd-jurisdiction/country:us/state:wa/government)\nPublic hearing on HB 1000\n**Location:** Senate Hearing Room 1\n**Participants:** Committee on Transportation (host, organization), Jane Doe (person)\n**Agenda:**\n- HB 1000 [bill, hearing] | Subjects: public safety\n  Related: HB 1000 (bill)',
    );
  });
});

/**
 * #59: Open States sends event media and documents as `EventMedia` / `EventDocument` records —
 * `note`, `date`, `classification`, a `links[]` array of `{ url, note? }`, and `offset` on media —
 * with no top-level `url`. The fixture is the live Georgia shape (`date` and `classification` sent
 * as `""`, each link carrying `url` alone). Pre-fix the output schema demanded a top-level `url`,
 * so the whole call failed validation with -32603.
 */
describe('searchEvents — upstream media and document records (#59)', () => {
  const gaMedia = [
    {
      note: 'Livestream',
      date: '',
      classification: '',
      links: [{ url: 'https://vimeo.example.com/showcase/11368491?autoplay=1' }],
    },
  ];
  const gaDocuments = [
    {
      note: 'Agenda',
      date: '',
      classification: '',
      links: [{ url: 'https://legis.example.gov/agendas/house/Study_Cmte_Agenda_Oct28.pdf' }],
    },
  ];
  const gaEvent = { ...mockEvent, end_date: '', media: gaMedia, documents: gaDocuments };

  const call = async (event: unknown) => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchEvents: vi.fn().mockResolvedValue({
        results: [event],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 1 },
      }),
    } as never);
    return runToolContract(searchEvents, { jurisdiction: 'ga', include: ['media', 'documents'] });
  };
  const textOf = (result: { content: unknown[] }) => (result.content[0] as { text: string }).text;

  it('returns an event carrying upstream-shaped media and documents', async () => {
    const result = await call(gaEvent);
    expect(result.isError).not.toBe(true);
    const event = (result.structuredContent as { results: Record<string, unknown>[] }).results[0]!;
    expect(event.media).toEqual(gaMedia);
    expect(event.documents).toEqual(gaDocuments);
    expect(links(textOf(result))).toEqual([
      { href: gaMedia[0]!.links[0]!.url, label: 'Livestream' },
      { href: gaDocuments[0]!.links[0]!.url, label: 'Agenda' },
    ]);
  });

  /**
   * Past the first level: several links per record, a link with its own note, a link without one
   * (left absent, never defaulted to `""`), recorded date/classification/offset, and a record that
   * carries no link at all.
   */
  it('carries every nested link and record field through both surfaces', async () => {
    const media = [
      {
        note: 'Hearing video',
        date: '2025-03-15',
        classification: 'recording',
        offset: 120,
        links: [
          { url: 'https://tvw.example.org/v/1.mp4', note: 'MP4' },
          { url: 'https://tvw.example.org/v/1' },
        ],
      },
    ];
    const documents = [
      {
        note: 'Testimony',
        date: '',
        classification: 'testimony',
        links: [
          { url: 'https://leg.example.gov/t1.pdf', note: 'Witness A' },
          { url: 'https://leg.example.gov/t2.pdf', note: 'Witness B' },
        ],
      },
      { note: 'Minutes (pending)', date: '2025-03-16', classification: '', links: [] },
    ];
    const result = await call({ ...mockEvent, media, documents });
    expect(result.isError).not.toBe(true);
    const event = (result.structuredContent as { results: Record<string, unknown>[] }).results[0]!;
    expect(event.media).toEqual(media);
    expect(event.documents).toEqual(documents);
    expect(Object.hasOwn((event.media as { links: object[] }[])[0]!.links[1]!, 'note')).toBe(false);

    const text = textOf(result);
    expect(links(text)).toEqual([
      { href: 'https://tvw.example.org/v/1.mp4', label: 'MP4' },
      { href: 'https://tvw.example.org/v/1', label: 'Hearing video' },
      { href: 'https://leg.example.gov/t1.pdf', label: 'Witness A' },
      { href: 'https://leg.example.gov/t2.pdf', label: 'Witness B' },
    ]);
    const lines = readBack(text).at(-1)!.split('\n');
    expect(lines.at(-2)).toBe('Media: MP4, Hearing video (2025-03-15, recording, offset 120)');
    expect(lines.at(-1)).toBe(
      'Documents: Testimony: Witness A, Witness B (testimony); Minutes (pending) (2025-03-16)',
    );
  });

  it('renders a record with no note, date, classification, or link as nothing — no stray punctuation', async () => {
    const result = await call({
      ...mockEvent,
      media: [{ note: '', date: '', classification: '', links: [] }],
      documents: [
        { note: '', date: '', classification: '', links: [{ url: 'https://x.example/d' }] },
      ],
    });
    expect(result.isError).not.toBe(true);
    const lines = readBack(textOf(result)).at(-1)!.split('\n');
    expect(lines.at(-1)).toBe('Documents: https://x.example/d');
    expect(lines.some((l) => l.startsWith('Media'))).toBe(false);
  });
});

/**
 * #60: the empty-result notice blamed missing state data even when a narrowing filter emptied the
 * page — `{ jurisdiction: "ca", require_bills: true }` returns 0 while the unfiltered search
 * returns 7. A filtered empty result names its filters and how to widen them; only an unfiltered
 * one keeps the "may lack event data" wording.
 */
describe('searchEvents — empty-result notice (#60)', () => {
  const UNFILTERED =
    'No events found. Event coverage is experimental — most states do not publish event data to Open States. If you expected results, the state may lack event data entirely.';

  const noticeFor = async (input: Record<string, unknown>) => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchEvents: vi.fn().mockResolvedValue({
        results: [],
        pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
      }),
    } as never);
    const ctx = createMockContext({ errors: searchEvents.errors });
    await searchEvents.handler(searchEvents.input.parse({ jurisdiction: 'ca', ...input }), ctx);
    return getEnrichment(ctx).notice as string;
  };

  it('keeps the coverage wording for an unfiltered empty search', async () => {
    expect(await noticeFor({})).toBe(UNFILTERED);
  });

  it('names require_bills and suggests dropping it', async () => {
    const notice = readBack(await noticeFor({ require_bills: true })).join('\n');
    expect(notice).toBe(
      'No events matched require_bills=true. The jurisdiction may still hold events outside these filters — repeat the search without require_bills before concluding it lacks event data.',
    );
  });

  it('names the date bounds and suggests a wider window', async () => {
    const notice = readBack(
      await noticeFor({ after: '2025-03-01', before: '2025-04-01T00:00:00Z' }),
    ).join('\n');
    expect(notice).toBe(
      'No events matched after="2025-03-01", before="2025-04-01T00:00:00Z". The jurisdiction may still hold events outside these filters — repeat the search with a wider after/before window before concluding it lacks event data.',
    );
  });

  it('names every narrowing filter and both widening steps when all are set', async () => {
    const notice = readBack(await noticeFor({ require_bills: true, after: '2025-03-01' })).join(
      '\n',
    );
    expect(notice).toBe(
      'No events matched require_bills=true, after="2025-03-01". The jurisdiction may still hold events outside these filters — repeat the search without require_bills or with a wider after/before window before concluding it lacks event data.',
    );
  });

  it('sets no notice when events are returned', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      searchEvents: vi.fn().mockResolvedValue(mockEventResult),
    } as never);
    const ctx = createMockContext({ errors: searchEvents.errors });
    await searchEvents.handler(
      searchEvents.input.parse({ jurisdiction: 'ca', require_bills: true }),
      ctx,
    );
    expect(getEnrichment(ctx).notice).toBeUndefined();
  });
});
