/**
 * @fileoverview Tests for the searchEvents tool.
 * @module tests/tools/search-events.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchEvents } from '@/mcp-server/tools/definitions/search-events.tool.js';

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
 * paths. Fixture shapes mirror the Event interface in src/services/openstates/types.ts
 * (links/media/documents are PersonLink[] = { note, url }; sources is { url, note }).
 */
describe('searchEvents — include enrichment surfacing (links, sources, media, documents)', () => {
  const enrichedEvent = {
    ...mockEvent,
    links: [{ note: 'Hearing notice', url: 'https://leg.wa.gov/notice' }],
    sources: [{ url: 'https://leg.wa.gov/source', note: 'official calendar' }],
    media: [{ note: 'Video recording', url: 'https://tvw.org/video/1' }],
    documents: [{ note: 'Agenda PDF', url: 'https://leg.wa.gov/agenda.pdf' }],
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
    expect(event.media).toEqual([{ note: 'Video recording', url: 'https://tvw.org/video/1' }]);
    expect(event.documents).toEqual([{ note: 'Agenda PDF', url: 'https://leg.wa.gov/agenda.pdf' }]);
  });

  /** content[] path — format() rendered none of these pre-fix. */
  it('renders links, sources, media, and documents in format() text', () => {
    const blocks = searchEvents.format!(enrichedResult);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Hearing notice');
    expect(text).toContain('https://leg.wa.gov/notice');
    expect(text).toContain('https://leg.wa.gov/source');
    expect(text).toContain('official calendar');
    expect(text).toContain('Video recording');
    expect(text).toContain('https://tvw.org/video/1');
    expect(text).toContain('Agenda PDF');
    expect(text).toContain('https://leg.wa.gov/agenda.pdf');
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
 * Links, media, and documents all render as `${note}: ${url}`. Open States often supplies an empty
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

  it('renders a link URL alone when the note is empty', () => {
    const text = render({ links: [{ url: 'https://leg.example.gov/hearing', note: '' }] });
    expect(text).toContain('**Links:** https://leg.example.gov/hearing');
    expect(text).not.toContain(': https://leg.example.gov/hearing');
  });

  it('renders a media URL alone when the note is empty', () => {
    const text = render({ media: [{ url: 'https://tvw.example.org/clip', note: '' }] });
    expect(text).toContain('**Media:** https://tvw.example.org/clip');
    expect(text).not.toContain(': https://tvw.example.org/clip');
  });

  it('renders a document URL alone when the note is empty', () => {
    const text = render({ documents: [{ url: 'https://leg.example.gov/agenda.pdf', note: '' }] });
    expect(text).toContain('**Documents:** https://leg.example.gov/agenda.pdf');
    expect(text).not.toContain(': https://leg.example.gov/agenda.pdf');
  });

  it('still labels each list when the note is present', () => {
    const text = render({
      links: [{ url: 'https://leg.example.gov/hearing', note: 'hearing notice' }],
      media: [{ url: 'https://tvw.example.org/clip', note: 'video' }],
      documents: [{ url: 'https://leg.example.gov/agenda.pdf', note: 'agenda' }],
    });
    expect(text).toContain('**Links:** hearing notice: https://leg.example.gov/hearing');
    expect(text).toContain('**Media:** video: https://tvw.example.org/clip');
    expect(text).toContain('**Documents:** agenda: https://leg.example.gov/agenda.pdf');
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
    const ctx = createMockContext({ errors: searchEvents.errors });
    const input = searchEvents.input.parse({ jurisdiction: 'wa', page: 99, per_page: 3 });

    const err = await Promise.resolve(searchEvents.handler(input, ctx)).catch((e: unknown) => e);

    expect((err as McpError).data).toMatchObject({
      reason: 'invalid_page',
      recovery: { hint: expect.stringContaining('max_page') },
    });
    expect((err as McpError).message).toContain('invalid page, must be in [1, 1]');
  });
});
