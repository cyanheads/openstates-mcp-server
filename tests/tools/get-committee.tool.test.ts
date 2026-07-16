/**
 * @fileoverview Tests for the getCommittee tool.
 * @module tests/tools/get-committee.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCommittee } from '@/mcp-server/tools/definitions/get-committee.tool.js';

vi.mock('@/services/openstates/openstates-service.js', () => ({
  getOpenStatesApiService: vi.fn(),
}));

const mockCommittee = {
  id: 'ocd-organization/comm-1',
  name: 'Committee on Transportation',
  classification: 'committee',
  parent_id: null,
};

describe('getCommittee', () => {
  let mockService: { getCommittee: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getCommittee: vi.fn().mockResolvedValue(mockCommittee) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns committee by id', async () => {
    const ctx = createMockContext();
    const input = getCommittee.input.parse({ committee_id: 'ocd-organization/comm-1' });
    const result = await getCommittee.handler(input, ctx);
    expect(result.id).toBe('ocd-organization/comm-1');
    expect(result.name).toBe('Committee on Transportation');
    expect(result.parent_id).toBeNull();
  });

  it('includes memberships when requested', async () => {
    const committeeWithMembers = {
      ...mockCommittee,
      memberships: [
        { person_id: 'ocd-person/abc', person_name: 'Jane Smith', role: 'chair' },
        { person_id: 'ocd-person/def', person_name: 'Bob Jones', role: 'member' },
      ],
    };
    mockService.getCommittee.mockResolvedValue(committeeWithMembers);

    const ctx = createMockContext();
    const input = getCommittee.input.parse({
      committee_id: 'ocd-organization/comm-1',
      include: ['memberships'],
    });
    const result = await getCommittee.handler(input, ctx);
    expect(result.memberships).toBeDefined();
    expect(result.memberships).toHaveLength(2);
    expect(result.memberships?.[0].role).toBe('chair');
  });

  it('propagates not_found error from service', async () => {
    mockService.getCommittee.mockRejectedValue(new Error('Committee not found'));
    const ctx = createMockContext({ errors: getCommittee.errors });
    const input = getCommittee.input.parse({ committee_id: 'ocd-organization/nonexistent' });
    await expect(getCommittee.handler(input, ctx)).rejects.toThrow();
  });

  it('formats output with id, name, and classification', () => {
    const result = {
      id: 'ocd-organization/comm-1',
      name: 'Committee on Transportation',
      classification: 'committee',
      parent_id: null,
    };
    const blocks = getCommittee.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Committee on Transportation');
    expect(text).toContain('ocd-organization/comm-1');
    expect(text).toContain('committee');
  });

  it('formats parent_id when present', () => {
    const subcommittee = {
      id: 'ocd-organization/subcomm-1',
      name: 'Subcommittee on Roads',
      classification: 'subcommittee',
      parent_id: 'ocd-organization/comm-1',
    };
    const blocks = getCommittee.format!(subcommittee);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('ocd-organization/comm-1');
  });

  it('formats memberships when present', () => {
    const result = {
      id: 'ocd-organization/comm-1',
      name: 'Committee on Transportation',
      classification: 'committee',
      parent_id: null,
      memberships: [{ person_id: 'ocd-person/abc', person_name: 'Jane Smith', role: 'chair' }],
    };
    const blocks = getCommittee.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Jane Smith');
    expect(text).toContain('chair');
    expect(text).toContain('ocd-person/abc');
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18). get_committee advertises
 * links and sources via `include` (memberships already surfaced), but they were dropped at TWO
 * layers: the handler rebuilds its return object field-by-field and copied only
 * id/name/classification/parent_id/memberships, and the output schema declared no fields for
 * links/sources — so both the structuredContent and content[] paths lost the data. Driving
 * through the handler proves the rebuild now carries them. Fixture shapes mirror the Committee
 * interface in src/services/openstates/types.ts (links is PersonLink[] = { note, url }).
 */
describe('getCommittee — include enrichment surfacing (links, sources)', () => {
  const enrichedCommittee = {
    ...mockCommittee,
    links: [{ note: 'homepage', url: 'https://committee.example.gov' }],
    sources: [{ url: 'https://leg.example.gov/committee-roster', note: 'official roster' }],
  };

  it('carries links and sources through the handler rebuild and output schema', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = { getCommittee: vi.fn().mockResolvedValue(enrichedCommittee) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);

    const ctx = createMockContext();
    const input = getCommittee.input.parse({
      committee_id: 'ocd-organization/comm-1',
      include: ['links', 'sources'],
    });
    const handlerResult = await getCommittee.handler(input, ctx);
    const committee = getCommittee.output.parse(handlerResult);

    expect(committee.links).toEqual([{ note: 'homepage', url: 'https://committee.example.gov' }]);
    expect(committee.sources).toEqual([
      { url: 'https://leg.example.gov/committee-roster', note: 'official roster' },
    ]);
  });

  /** content[] path. format() rendered neither pre-fix. */
  it('renders links and sources in format() text', () => {
    const blocks = getCommittee.format!(enrichedCommittee);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('homepage');
    expect(text).toContain('https://committee.example.gov');
    expect(text).toContain('https://leg.example.gov/committee-roster');
    expect(text).toContain('official roster');
  });
});
