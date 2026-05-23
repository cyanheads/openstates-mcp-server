/**
 * @fileoverview Tests for the getEvent tool.
 * @module tests/tools/get-event.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEvent } from '@/mcp-server/tools/definitions/get-event.tool.js';

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

describe('getEvent', () => {
  let mockService: { getEvent: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getEvent: vi.fn().mockResolvedValue(mockEvent) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns event detail by id', async () => {
    const ctx = createMockContext();
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

    const ctx = createMockContext();
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['participants'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.participants).toBeDefined();
    expect(result.participants?.[0].role).toBe('host');
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

    const ctx = createMockContext();
    const input = getEvent.input.parse({ event_id: 'ocd-event/evt-1', include: ['agenda'] });
    const result = await getEvent.handler(input, ctx);
    expect(result.agenda).toBeDefined();
    expect(result.agenda?.[0].related_entities[0].name).toBe('HB 1000');
  });

  it('propagates not_found error from service', async () => {
    mockService.getEvent.mockRejectedValue(new Error('Event not found'));
    const ctx = createMockContext({ errors: getEvent.errors });
    const input = getEvent.input.parse({ event_id: 'ocd-event/nonexistent' });
    await expect(getEvent.handler(input, ctx)).rejects.toThrow();
  });

  it('formats output with id, name, status, and jurisdiction', () => {
    const blocks = getEvent.format!(mockEvent);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
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
    const text = (blocks[0] as { text: string }).text;
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
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('HB 1000 hearing');
    expect(text).toContain('HB 1000');
    expect(text).toContain('bill');
  });

  it('handles event without optional location', () => {
    const eventNoLocation = { ...mockEvent };
    const blocks = getEvent.format!(eventNoLocation);
    const text = (blocks[0] as { text: string }).text;
    // Should not throw, no location line expected
    expect(text).toContain('ocd-event/evt-1');
  });
});
