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
});
