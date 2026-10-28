/**
 * @fileoverview Tests for the getCommittee tool.
 * @module tests/tools/get-committee.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCommittee } from '@/mcp-server/tools/definitions/get-committee.tool.js';
import { inlineTypes, links, normalizeLink, readBack } from '../helpers/commonmark.js';
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

describe('getCommittee', () => {
  let mockService: { getCommittee: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getCommittee: vi.fn().mockResolvedValue(mockCommittee) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns committee by id', async () => {
    const ctx = createMockContext({ errors: getCommittee.errors });
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

    const ctx = createMockContext({ errors: getCommittee.errors });
    const input = getCommittee.input.parse({
      committee_id: 'ocd-organization/comm-1',
      include: ['memberships'],
    });
    const result = await getCommittee.handler(input, ctx);
    expect(result.memberships).toBeDefined();
    expect(result.memberships).toHaveLength(2);
    expect(result.memberships?.[0]?.role).toBe('chair');
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
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0]! as { text: string }).text;
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
    const text = (blocks[0]! as { text: string }).text;
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
    const text = (blocks[0]! as { text: string }).text;
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

    const ctx = createMockContext({ errors: getCommittee.errors });
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
describe('getCommittee — link rendering with an empty note', () => {
  it('renders the URL alone when the note is empty', () => {
    const blocks = getCommittee.format!({
      ...mockCommittee,
      links: [{ url: 'https://committee.example.gov', note: '' }],
      sources: [{ url: 'https://leg.example.gov/roster', note: '' }],
    });
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)).toContain('https://committee.example.gov');
    expect(readBack(text)).toContain('https://leg.example.gov/roster');
    expect(links(text)).toEqual([
      { href: 'https://committee.example.gov', label: 'https://committee.example.gov' },
      { href: 'https://leg.example.gov/roster', label: 'https://leg.example.gov/roster' },
    ]);
    expect(inlineTypes(text).has('em_open')).toBe(false);
  });

  it('still labels a link that has a note', () => {
    const blocks = getCommittee.format!({
      ...mockCommittee,
      links: [{ url: 'https://committee.example.gov', note: 'homepage' }],
    });
    const text = (blocks[0]! as { text: string }).text;
    expect(readBack(text)).toContain('homepage');
    expect(links(text)).toEqual([{ href: 'https://committee.example.gov', label: 'homepage' }]);
  });
});

/**
 * A membership's `role` and `person_id` are `""` when Open States recorded none. The member line
 * drops the segment instead of rendering a bare `()` or a dangling `ID: ` — the same empty-field
 * rule as links, notes, and dates elsewhere. `structuredContent` keeps the empty strings.
 */
describe('getCommittee — member line with empty fields', () => {
  const render = (membership: { person_id: string; person_name: string; role: string }) => {
    const blocks = getCommittee.format!({ ...mockCommittee, memberships: [membership] });
    return readBack((blocks[0]! as { text: string }).text).at(-1);
  };

  it('drops the role parenthetical when the role is empty', () => {
    expect(render({ person_id: 'ocd-person/abc', person_name: 'Jane Smith', role: '' })).toBe(
      'Jane Smith — ID: ocd-person/abc',
    );
  });

  it('drops the ID segment when the membership carries no linked person', () => {
    expect(render({ person_id: '', person_name: 'Jane Smith', role: 'chair' })).toBe(
      'Jane Smith (chair)',
    );
  });

  it('renders the name alone when both are empty', () => {
    expect(render({ person_id: '', person_name: 'Jane Smith', role: '' })).toBe('Jane Smith');
  });

  it('keeps every segment when all three are present', () => {
    expect(render({ person_id: 'ocd-person/abc', person_name: 'Jane Smith', role: 'chair' })).toBe(
      'Jane Smith (chair) — ID: ocd-person/abc',
    );
  });
});

/**
 * Markdown fidelity (#53): every upstream string `format()` renders reads back exactly from a
 * CommonMark parse, and every URL field renders as one link. The sweep sets one string leaf of a
 * fully populated record at a time to each hostile class and checks the whole rendered document.
 */
describe('getCommittee — Markdown fidelity (#53)', () => {
  const full = {
    id: 'ocd-organization/comm-1',
    name: 'Committee on Transportation',
    classification: 'committee',
    parent_id: 'ocd-organization/comm-0',
    memberships: [{ person_id: 'ocd-person/abc', person_name: 'Jane Smith', role: 'chair' }],
    links: [{ url: 'https://committee.example.gov/home', note: 'homepage' }],
    sources: [{ url: 'https://leg.example.gov/roster', note: 'official roster' }],
  };
  const render = (committee: typeof full | typeof mockCommittee) =>
    (getCommittee.format!(getCommittee.output.parse(committee))[0]! as { text: string }).text;

  it('reads the issue fixture back as the literal committee name', () => {
    const text = render({
      id: 'ocd-organization/fixture',
      name: 'Committee *A* [B](https://example.org)',
      classification: 'committee',
      parent_id: null,
    });
    expect(readBack(text)[0]).toBe('Committee *A* [B](https://example.org)');
    expect(links(text)).toEqual([]);
    expect(inlineTypes(text).has('em_open')).toBe(false);
  });

  it.each(Object.entries(HOSTILE))('reads back %s in every rendered string field', (_, payload) => {
    const fields = leaves(full, false);
    expect(fields).toHaveLength(9);
    for (const path of fields) {
      // A line break cannot ride an ATX heading — out of scope for heading-slot values.
      if (path[0] === 'name' && payload.includes('\n')) continue;
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
    const { links: _l, sources: _s, ...noUrls } = full;
    expect(
      render({
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
      } as typeof full),
    ).toBe(
      '# Committee on Transportation\n**ID:** ocd-organization/8e4b0a3c-1f2d-4c5e-9a7b-2d6f0e1c3b4a\n**Classification:** committee\n**Parent ID:** ocd-organization/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e\n\n## Members\n- Jane Smith (chair) — ID: ocd-person/1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
    );
  });
});

/** #51: the service's `rate_limited` error reaches the caller with the declared recovery. */
describe('getCommittee — rate_limited contract (#51)', () => {
  it('surfaces a service rate_limited error with the declared recovery hint', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      getCommittee: vi.fn().mockRejectedValue(
        new McpError(JsonRpcErrorCode.RateLimited, 'exceeded limit of 10/min: 11', {
          reason: 'rate_limited',
          retryable: true,
          retryAfter: 42,
        }),
      ),
    } as never);

    const result = await runToolContract(getCommittee, { committee_id: 'ocd-organization/x' });

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
