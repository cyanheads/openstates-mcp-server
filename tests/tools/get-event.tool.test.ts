/**
 * @fileoverview Tests for the getEvent tool.
 * @module tests/tools/get-event.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEvent } from '@/mcp-server/tools/definitions/get-event.tool.js';

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

describe('getEvent', () => {
  let mockService: { getEvent: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getEvent: vi.fn().mockResolvedValue(mockEvent) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns event detail by id', async () => {
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1' });
    const result = await getEvent.handler(input, ctx);
    expect(result.id).toBe('ocd-event/evt-1');
    expect(result.name).toBe('Transportation Committee Hearing');
    expect(result.status).toBe('passed');
    expect(result.jurisdiction.name).toBe('Washington');
  });

  it('includes participants when requested', async () => {
    const eventWithParticipants = {
      ...mockEvent,
      participants: [
        { name: 'Committee on Transportation', entity_type: 'organization', role: 'host' },
      ],
    };
    mockService.getEvent.mockResolvedValue(eventWithParticipants);

    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['participants'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.participants).toBeDefined();
    expect(result.participants?.[0]?.role).toBe('host');
  });

  it('includes agenda with related_entities when requested', async () => {
    const eventWithAgenda = {
      ...mockEvent,
      agenda: [
        {
          description: 'HB 1000 hearing',
          classification: ['bill'],
          subjects: ['public safety'],
          related_entities: [{ name: 'HB 1000', entity_type: 'bill' }],
        },
      ],
    };
    mockService.getEvent.mockResolvedValue(eventWithAgenda);

    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['agenda'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.agenda).toBeDefined();
    expect(result.agenda?.[0]?.related_entities[0]?.name).toBe('HB 1000');
  });

  it('propagates not_found error from service', async () => {
    mockService.getEvent.mockRejectedValue(new Error('Event not found'));
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/nonexistent' });
    await expect(getEvent.handler(input, ctx)).rejects.toThrow();
  });

  it('formats output with id, name, status, and jurisdiction', () => {
    const blocks = getEvent.format!(mockEvent);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Transportation Committee Hearing');
    expect(text).toContain('ocd-event/evt-1');
    expect(text).toContain('passed');
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
  });

  it('formats participants when present', () => {
    const result = {
      ...mockEvent,
      participants: [
        { name: 'Committee on Transportation', entity_type: 'organization', role: 'host' },
      ],
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('Committee on Transportation');
    expect(text).toContain('host');
    expect(text).toContain('organization');
  });

  it('formats agenda when present', () => {
    const result = {
      ...mockEvent,
      agenda: [
        {
          description: 'HB 1000 hearing',
          classification: ['bill'],
          subjects: ['public safety'],
          related_entities: [{ name: 'HB 1000', entity_type: 'bill' }],
        },
      ],
    };
    const blocks = getEvent.format!(result);
    const text = (blocks[0]! as { text: string }).text;
    expect(text).toContain('HB 1000 hearing');
    expect(text).toContain('HB 1000');
    expect(text).toContain('bill');
  });

  it('handles event without optional location', () => {
    const eventNoLocation = { ...mockEvent };
    const blocks = getEvent.format!(eventNoLocation);
    const text = (blocks[0]! as { text: string }).text;
    // Should not throw, no location line expected
    expect(text).toContain('ocd-event/evt-1');
  });

  /**
   * #59: Open States sends media and documents as `EventMedia` / `EventDocument` records whose URLs
   * sit in `links[]` — no top-level `url`. The fixture is the live Georgia shape. Pre-fix the output
   * schema demanded a top-level `url`, so the lookup failed validation with -32603.
   */
  it('returns an event carrying upstream-shaped media and documents (#59)', async () => {
    const media = [
      {
        note: 'Livestream',
        date: '',
        classification: '',
        offset: 30,
        links: [
          { url: 'https://vimeo.example.com/showcase/11368491' },
          { url: 'https://vimeo.example.com/showcase/11368491.m3u8', note: 'HLS' },
        ],
      },
    ];
    const documents = [
      {
        note: 'Agenda',
        date: '2025-03-14',
        classification: 'agenda',
        links: [{ url: 'https://legis.example.gov/agendas/agenda.pdf' }],
      },
    ];
    mockService.getEvent.mockResolvedValue({ ...mockEvent, media, documents });

    const result = await runToolContract(getEvent, {
      event_id: 'ocd-event/evt-1',
      include: ['media', 'documents'],
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ media, documents });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain(
      '## Media\n- [Livestream](<https://vimeo.example.com/showcase/11368491>), [HLS](<https://vimeo.example.com/showcase/11368491.m3u8>) (offset 30)\n\n## Documents\n- [Agenda](<https://legis.example.gov/agendas/agenda.pdf>) (2025-03-14, agenda)',
    );
  });

  /** #51: the service's `rate_limited` error reaches the caller with the declared recovery. */
  it('surfaces a service rate_limited error with the declared recovery hint', async () => {
    mockService.getEvent.mockRejectedValue(
      new McpError(JsonRpcErrorCode.RateLimited, 'exceeded limit of 10/min: 11', {
        reason: 'rate_limited',
        retryable: true,
        retryAfter: 42,
      }),
    );

    const result = await runToolContract(getEvent, { event_id: 'ocd-event/evt-1' });

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
