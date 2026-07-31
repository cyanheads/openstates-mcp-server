/**
 * @fileoverview Additional coverage for listJurisdictions: classification filter,
 * empty results, per_page boundary, and format edge cases.
 * @module tests/tools/list-jurisdictions.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listJurisdictions } from '@/mcp-server/tools/definitions/list-jurisdictions.tool.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
  getOpenStatesApiService: vi.fn(),
}));

const mockJurisdiction = {
  id: 'ocd-jurisdiction/country:us/state:wa/government',
  name: 'Washington',
  classification: 'government',
  url: 'https://leg.wa.gov',
  latest_bill_update: '2025-05-20T10:00:00Z',
  latest_people_update: '2025-05-19T08:00:00Z',
};

describe('listJurisdictions — filters and pagination', () => {
  let mockService: { listJurisdictions: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      listJurisdictions: vi.fn().mockResolvedValue({
        results: [mockJurisdiction],
        pagination: { page: 1, per_page: 52, max_page: 1, total_items: 52 },
      }),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('default classification is state', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({});
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'state' }),
      expect.anything(),
    );
  });

  it('passes municipality classification to service', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ classification: 'municipality' });
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'municipality' }),
      expect.anything(),
    );
  });

  it('passes country classification to service', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ classification: 'country' });
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'country' }),
      expect.anything(),
    );
  });

  it('rejects invalid classification', () => {
    expect(() => listJurisdictions.input.parse({ classification: 'region' })).toThrow();
  });

  it('per_page maximum is 52', () => {
    expect(() => listJurisdictions.input.parse({ per_page: 53 })).toThrow();
  });

  it('per_page minimum is 1', () => {
    expect(() => listJurisdictions.input.parse({ per_page: 0 })).toThrow();
  });

  it('enrichment reflects response pagination', async () => {
    mockService.listJurisdictions.mockResolvedValue({
      results: [mockJurisdiction],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 52 },
    });
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({});
    await listJurisdictions.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(52);
    expect(enrichment.page).toBe(1);
    expect(enrichment.maxPage).toBe(1);
  });

  it('returns empty results without error', async () => {
    mockService.listJurisdictions.mockResolvedValue({
      results: [],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 0 },
    });
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ classification: 'municipality' });
    const result = await listJurisdictions.handler(input, ctx);
    expect(result.results).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
  });

  it('passes include=latest_runs to service', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ include: ['latest_runs'] });
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ include: ['latest_runs'] }),
      expect.anything(),
    );
  });

  it('passes include=organizations to service', async () => {
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ include: ['organizations'] });
    await listJurisdictions.handler(input, ctx);
    expect(mockService.listJurisdictions).toHaveBeenCalledWith(
      expect.objectContaining({ include: ['organizations'] }),
      expect.anything(),
    );
  });
});

describe('listJurisdictions — format edge cases', () => {
  it('formats jurisdictions without sessions', () => {
    const result = {
      results: [mockJurisdiction],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 1 },
    };
    const blocks = listJurisdictions.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
    expect(text).toContain('https://leg.wa.gov');
    // No sessions section expected
    expect(text).not.toContain('Sessions:');
  });

  it('formats multiple jurisdictions', () => {
    const result = {
      results: [
        mockJurisdiction,
        {
          ...mockJurisdiction,
          id: 'ocd-jurisdiction/country:us/state:ca/government',
          name: 'California',
          url: 'https://leginfo.legislature.ca.gov',
        },
      ],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 2 },
    };
    const blocks = listJurisdictions.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Washington');
    expect(text).toContain('California');
    expect(text).toContain('2 jurisdictions');
  });

  it('formats empty result set', () => {
    const result = {
      results: [],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 0 },
    };
    const blocks = listJurisdictions.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('0 jurisdictions');
  });

  it('formats special session identifier', () => {
    const result = {
      results: [
        {
          ...mockJurisdiction,
          legislative_sessions: [
            {
              identifier: '2025s1',
              name: '2025 Special Session 1',
              classification: 'special',
              start_date: '2025-06-01',
              end_date: '2025-06-15',
            },
          ],
        },
      ],
      pagination: { page: 1, per_page: 52, max_page: 1, total_items: 1 },
    };
    const blocks = listJurisdictions.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('2025s1');
    expect(text).toContain('2025 Special Session 1');
    expect(text).toContain('special');
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18). list_jurisdictions
 * advertises organizations and latest_runs via `include`, but the output schema declared no
 * fields for them (organizations was even untyped upstream), so strict output parsing stripped
 * them from both the structuredContent and content[] paths. The handler returns the service
 * result directly, so the schema + format() change alone must surface them. Fixture shapes mirror
 * JurisdictionOrganization ({ id?, name?, classification? }) and RunPlan ({ start_time, end_time?,
 * success? }) in src/services/openstates/types.ts.
 */
describe('listJurisdictions — include enrichment surfacing (organizations, latest_runs)', () => {
  let mockService: { listJurisdictions: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { listJurisdictions: vi.fn() };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  const enrichedJurisdiction = {
    ...mockJurisdiction,
    organizations: [
      { id: 'ocd-organization/senate', name: 'Washington State Senate', classification: 'upper' },
    ],
    latest_runs: [
      { start_time: '2025-05-20T02:00:00Z', end_time: '2025-05-20T02:12:00Z', success: true },
    ],
  };
  const enrichedResult = {
    results: [enrichedJurisdiction],
    pagination: { page: 1, per_page: 52, max_page: 1, total_items: 1 },
  };

  it('carries organizations and latest_runs through the output schema', async () => {
    mockService.listJurisdictions.mockResolvedValue(enrichedResult);
    const ctx = createMockContext();
    const input = listJurisdictions.input.parse({ include: ['organizations', 'latest_runs'] });
    const handlerResult = await listJurisdictions.handler(input, ctx);
    const jur = listJurisdictions.output.parse(handlerResult).results[0];
    expect(jur.organizations).toEqual([
      { id: 'ocd-organization/senate', name: 'Washington State Senate', classification: 'upper' },
    ]);
    expect(jur.latest_runs).toEqual([
      { start_time: '2025-05-20T02:00:00Z', end_time: '2025-05-20T02:12:00Z', success: true },
    ]);
  });

  /** content[] path — format() rendered neither pre-fix. */
  it('renders organizations and latest_runs in format() text', () => {
    const blocks = listJurisdictions.format!(enrichedResult);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Washington State Senate');
    expect(text).toContain('upper');
    expect(text).toContain('ocd-organization/senate');
    expect(text).toContain('2025-05-20T02:00:00Z');
    expect(text).toContain('2025-05-20T02:12:00Z');
    expect(text).toContain('success');
  });
});

/**
 * `page > 1` bypasses the inventory merge and returns a single upstream page, so an explicit page
 * past the end 404s exactly as it does on the search tools.
 */
describe('listJurisdictions — out-of-range page', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      listJurisdictions: vi
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
    const ctx = createMockContext({ errors: listJurisdictions.errors });
    const input = listJurisdictions.input.parse({ page: 99 });

    const err = await listJurisdictions.handler(input, ctx).catch((e: unknown) => e);

    expect((err as McpError).data).toMatchObject({
      reason: 'invalid_page',
      recovery: { hint: expect.stringContaining('max_page') },
    });
    expect((err as McpError).message).toContain('invalid page, must be in [1, 2]');
  });
});

/**
 * Regression coverage for issue #43. `classification`, `start_date`, and `end_date` on a
 * legislative session are required, non-nullable strings, and Open States sends `""` on sessions
 * it never finished scraping (Missouri 2018 has a start and no end; Alaska 27 has none of the
 * three), which left an empty parenthetical, a trailing en dash, or a bare separator. An absent
 * endpoint means unknown, not open-ended — every observed case is a long-concluded session — so
 * the rendering states only the endpoint upstream gave and never substitutes "present". All four
 * endpoint combinations are pinned; the fully-populated one must stay byte-identical to what
 * shipped before the guard. structuredContent is unaffected: `""` is the accurate upstream value
 * and stays.
 */
describe('listJurisdictions — sessions with an empty classification or date (issue #43)', () => {
  const pagination = { page: 1, per_page: 52, max_page: 1, total_items: 1 };

  const render = (session: {
    identifier: string;
    name: string;
    classification: string;
    start_date: string;
    end_date: string;
  }) => {
    const blocks = listJurisdictions.format!({
      results: [{ ...mockJurisdiction, legislative_sessions: [session] }],
      pagination,
    });
    return (blocks[0] as { text: string }).text;
  };

  const session = {
    identifier: '2018',
    name: '2018 Regular Session',
    classification: 'primary',
    start_date: '2017-12-01',
    end_date: '2018-05-18',
  };
  const head = '- `2018` — 2018 Regular Session (primary)';

  it('renders both endpoints as a dash range, unchanged', () => {
    expect(render(session).split('\n')).toContain(`${head} 2017-12-01–2018-05-18`);
  });

  it('renders a start with no end as "from", with no trailing dash', () => {
    expect(render({ ...session, end_date: '' }).split('\n')).toContain(`${head} from 2017-12-01`);
  });

  it('renders an end with no start as "until", with no leading dash', () => {
    expect(render({ ...session, start_date: '' }).split('\n')).toContain(
      `${head} until 2018-05-18`,
    );
  });

  it('omits the range entirely when neither endpoint is present', () => {
    expect(render({ ...session, start_date: '', end_date: '' }).split('\n')).toContain(head);
  });

  it('drops the classification parenthetical when classification is empty', () => {
    const text = render({
      identifier: '27',
      name: '27th Legislature (2011-2012)',
      classification: '',
      start_date: '',
      end_date: '2012-04-15',
    });
    expect(text.split('\n')).toContain('- `27` — 27th Legislature (2011-2012) until 2012-04-15');
    expect(text).not.toContain('()');
  });
});
