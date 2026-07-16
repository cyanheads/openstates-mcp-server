/**
 * @fileoverview Tests for the searchEvents tool.
 * @module tests/tools/search-events.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchEvents } from '@/mcp-server/tools/definitions/search-events.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
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
    const ctx = createMockContext();
    const input = searchEvents.input.parse({ jurisdiction: 'wa' });
    const result = await searchEvents.handler(input, ctx);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('ocd-event/evt-1');
    expect(result.results[0].name).toBe('Transportation Committee Hearing');
  });

  /**
   * The Open States /events endpoint requires jurisdiction and answers
   * `400 must provide 'jurisdiction' parameter` without it — there is no
   * all-states event search. Guard locally so the agent gets a typed reason and
   * a recovery hint instead of a generic upstream 400.
   */
  it('throws jurisdiction_required when jurisdiction is omitted, without calling the service', async () => {
    const ctx = createMockContext({ errors: searchEvents.errors });
    const input = searchEvents.input.parse({});
    await expect(searchEvents.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'jurisdiction_required' },
    });
    expect(mockService.searchEvents).not.toHaveBeenCalled();
  });

  it('returns empty results with enrichment notice on experimental coverage', async () => {
    mockService.searchEvents.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext();
    const input = searchEvents.input.parse({ jurisdiction: 'wa' });
    const result = await searchEvents.handler(input, ctx);
    expect(result.results).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.coverageNote).toBeDefined();
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('experimental');
  });

  it('passes date range filters to service', async () => {
    const ctx = createMockContext();
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

    const ctx = createMockContext();
    const input = searchEvents.input.parse({ jurisdiction: 'wa', include: ['agenda'] });
    const result = await searchEvents.handler(input, ctx);
    expect(result.results[0].agenda).toBeDefined();
    expect(result.results[0].agenda?.[0].description).toContain('HB 1000');
  });

  it('formats output with event id, name, and jurisdiction', () => {
    const result = {
      results: [mockEvent],
      pagination: mockEventResult.pagination,
    };
    const blocks = searchEvents.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
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
    const text = (blocks[0] as { text: string }).text;
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
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('0 events');
  });

  it('echoes applied filters in enrichment for self-verification', async () => {
    const ctx = createMockContext();
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

    const ctx = createMockContext();
    const input = searchEvents.input.parse({
      jurisdiction: 'wa',
      include: ['links', 'sources', 'media', 'documents'],
    });
    const handlerResult = await searchEvents.handler(input, ctx);
    const parsed = searchEvents.output.parse(handlerResult);
    const event = parsed.results[0];
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
    const text = (blocks[0] as { text: string }).text;
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

    const ctx = createMockContext();
    const input = searchEvents.input.parse({ jurisdiction: 'ca', include: ['participants'] });
    const handlerResult = await searchEvents.handler(input, ctx);
    const parsed = searchEvents.output.parse(handlerResult);
    expect(parsed.results[0].participants).toHaveLength(2);
    expect(parsed.results[0].participants?.[0].role).toBe('host');
    expect(parsed.results[0].participants?.[1].role).toBeUndefined();
  });

  it('renders a role-less participant without printing "undefined"', () => {
    const blocks = searchEvents.format!(rolelessResult);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane Doe');
    expect(text).not.toContain('undefined');
  });
});
