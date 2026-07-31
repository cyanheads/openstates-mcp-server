/**
 * @fileoverview Tests for the getJurisdiction tool.
 * @module tests/tools/get-jurisdiction.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getJurisdiction } from '@/mcp-server/tools/definitions/get-jurisdiction.tool.js';

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

describe('getJurisdiction', () => {
  let mockService: { getJurisdiction: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getJurisdiction: vi.fn().mockResolvedValue(mockJurisdiction) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns jurisdiction metadata by abbreviation', async () => {
    const ctx = createMockContext();
    const input = getJurisdiction.input.parse({ jurisdiction_id: 'wa' });
    const result = await getJurisdiction.handler(input, ctx);
    expect(result.id).toBe('ocd-jurisdiction/country:us/state:wa/government');
    expect(result.name).toBe('Washington');
    expect(result.url).toBe('https://leg.wa.gov');
    expect(result.latest_bill_update).toBe('2025-05-20T10:00:00Z');
    expect(result.latest_people_update).toBe('2025-05-19T08:00:00Z');
  });

  it('includes legislative_sessions when requested', async () => {
    const withSessions = {
      ...mockJurisdiction,
      legislative_sessions: [
        {
          identifier: '2025',
          name: '2025 Regular Session',
          classification: 'primary',
          start_date: '2025-01-13',
          end_date: '2025-04-27',
        },
      ],
    };
    mockService.getJurisdiction.mockResolvedValue(withSessions);

    const ctx = createMockContext();
    const input = getJurisdiction.input.parse({
      jurisdiction_id: 'wa',
      include: ['legislative_sessions'],
    });
    const result = await getJurisdiction.handler(input, ctx);
    expect(result.legislative_sessions).toBeDefined();
    expect(result.legislative_sessions?.[0].identifier).toBe('2025');
  });

  it('propagates not_found error from service', async () => {
    mockService.getJurisdiction.mockRejectedValue(new Error('Jurisdiction not found'));
    const ctx = createMockContext({ errors: getJurisdiction.errors });
    const input = getJurisdiction.input.parse({ jurisdiction_id: 'xx' });
    await expect(getJurisdiction.handler(input, ctx)).rejects.toThrow();
  });

  it('formats output with id, name, url, and timestamps', () => {
    const result = {
      id: 'ocd-jurisdiction/country:us/state:wa/government',
      name: 'Washington',
      classification: 'government',
      url: 'https://leg.wa.gov',
      latest_bill_update: '2025-05-20T10:00:00Z',
      latest_people_update: '2025-05-19T08:00:00Z',
    };
    const blocks = getJurisdiction.format!(result);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Washington');
    expect(text).toContain('ocd-jurisdiction/country:us/state:wa/government');
    expect(text).toContain('https://leg.wa.gov');
    expect(text).toContain('2025-05-20T10:00:00Z');
    expect(text).toContain('2025-05-19T08:00:00Z');
  });

  it('formats session identifiers in output when included', () => {
    const result = {
      id: 'ocd-jurisdiction/country:us/state:wa/government',
      name: 'Washington',
      classification: 'government',
      url: 'https://leg.wa.gov',
      latest_bill_update: '2025-05-20T10:00:00Z',
      latest_people_update: '2025-05-19T08:00:00Z',
      legislative_sessions: [
        {
          identifier: '2025',
          name: '2025 Regular Session',
          classification: 'primary',
          start_date: '2025-01-13',
          end_date: '2025-04-27',
        },
      ],
    };
    const blocks = getJurisdiction.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('`2025`');
    expect(text).toContain('2025 Regular Session');
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18). get_jurisdiction
 * advertises organizations and latest_runs via `include`, but the handler rebuilds its return
 * object field-by-field and copied only legislative_sessions, and the output schema declared no
 * fields for them (organizations was even untyped upstream) — so both the structuredContent and
 * content[] paths lost the data. Driving through the handler proves the rebuild now carries them.
 * Fixture shapes mirror JurisdictionOrganization ({ id?, name?, classification? }) and RunPlan
 * ({ start_time, end_time?, success? }) in src/services/openstates/types.ts.
 */
describe('getJurisdiction — include enrichment surfacing (organizations, latest_runs)', () => {
  let mockService: { getJurisdiction: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getJurisdiction: vi.fn() };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  const enrichedJurisdiction = {
    ...mockJurisdiction,
    organizations: [
      { id: 'ocd-organization/house', name: 'Washington State House', classification: 'lower' },
    ],
    latest_runs: [
      { start_time: '2025-05-19T02:00:00Z', end_time: '2025-05-19T02:08:00Z', success: true },
    ],
  };

  it('carries organizations and latest_runs through the handler rebuild and output schema', async () => {
    mockService.getJurisdiction.mockResolvedValue(enrichedJurisdiction);
    const ctx = createMockContext();
    const input = getJurisdiction.input.parse({
      jurisdiction_id: 'wa',
      include: ['organizations', 'latest_runs'],
    });
    const handlerResult = await getJurisdiction.handler(input, ctx);
    const jur = getJurisdiction.output.parse(handlerResult);
    expect(jur.organizations).toEqual([
      { id: 'ocd-organization/house', name: 'Washington State House', classification: 'lower' },
    ]);
    expect(jur.latest_runs).toEqual([
      { start_time: '2025-05-19T02:00:00Z', end_time: '2025-05-19T02:08:00Z', success: true },
    ]);
  });

  /** content[] path — format() rendered neither pre-fix. */
  it('renders organizations and latest_runs in format() text', () => {
    const blocks = getJurisdiction.format!(enrichedJurisdiction);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Washington State House');
    expect(text).toContain('lower');
    expect(text).toContain('ocd-organization/house');
    expect(text).toContain('2025-05-19T02:00:00Z');
    expect(text).toContain('2025-05-19T02:08:00Z');
    expect(text).toContain('success');
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
describe('getJurisdiction — sessions with an empty classification or date (issue #43)', () => {
  const render = (session: {
    identifier: string;
    name: string;
    classification: string;
    start_date: string;
    end_date: string;
  }) => {
    const blocks = getJurisdiction.format!({
      ...mockJurisdiction,
      legislative_sessions: [session],
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
