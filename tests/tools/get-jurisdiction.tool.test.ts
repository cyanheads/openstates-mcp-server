/**
 * @fileoverview Tests for the getJurisdiction tool.
 * @module tests/tools/get-jurisdiction.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getJurisdiction } from '@/mcp-server/tools/definitions/get-jurisdiction.tool.js';
import { inlineTokens, links, normalizeLink, readBack } from '../helpers/commonmark.js';
import { HOSTILE_VALUES, MULTILINE_VALUES, shape } from '../helpers/markdown-sweep.js';

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
    const ctx = createMockContext({ errors: getJurisdiction.errors });
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

    const ctx = createMockContext({ errors: getJurisdiction.errors });
    const input = getJurisdiction.input.parse({
      jurisdiction_id: 'wa',
      include: ['legislative_sessions'],
    });
    const result = await getJurisdiction.handler(input, ctx);
    expect(result.legislative_sessions).toBeDefined();
    expect(result.legislative_sessions?.[0]?.identifier).toBe('2025');
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
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0]! as { text: string }).text;
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
    const text = (blocks[0]! as { text: string }).text;
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
    const ctx = createMockContext({ errors: getJurisdiction.errors });
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
    const text = (blocks[0]! as { text: string }).text;
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
    return (blocks[0]! as { text: string }).text;
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

/**
 * Issue #53: every upstream string in `format()` reads back exactly from a CommonMark parse. A
 * value is set to each hostile class in turn; it must appear verbatim in the read-back text and
 * leave the block structure and the non-text inline tokens exactly as the benign value did — no
 * emphasis, link, image, raw HTML, heading, list, or quote of its own.
 */
describe('getJurisdiction — format() Markdown fidelity (issue #53)', () => {
  const fixture = {
    id: 'ocd-jurisdiction/country:us/state:wa/government',
    name: 'Washington',
    classification: 'state',
    url: 'https://leg.wa.gov',
    latest_bill_update: '2025-05-20T10:00:00Z',
    latest_people_update: '2025-05-19T08:00:00+00:00',
    legislative_sessions: [
      {
        identifier: '2025-2026',
        name: '2025-2026 Regular Session',
        classification: 'primary',
        start_date: '2025-01-13',
        end_date: '2026-03-12',
      },
      {
        identifier: '2025rs',
        name: '2025 Regular Session',
        classification: '',
        start_date: '2025-01-13',
        end_date: '',
      },
      {
        identifier: '2025s1',
        name: '2025 Special Session 1',
        classification: 'special',
        start_date: '',
        end_date: '',
      },
    ],
    organizations: [
      {
        id: 'ocd-organization/1b2c3d4e-0000-4000-8000-000000000001',
        name: 'Washington State Senate',
        classification: 'upper',
      },
      { name: 'Washington State Legislature' },
    ],
    latest_runs: [
      { start_time: '2025-05-19T02:00:00Z', end_time: '2025-05-19T02:08:00Z', success: true },
      { start_time: '2025-05-18T02:00:00Z' },
    ],
  };
  type Fixture = typeof fixture;

  const render = (value: Fixture) =>
    (getJurisdiction.format!(getJurisdiction.output.parse(value))[0]! as { text: string }).text;

  /** One-line hostile classes; every slot gets these. */
  const fields: { path: string; set: (f: Fixture, v: string) => void; oneLine?: boolean }[] = [
    { path: 'name', set: (f, v) => (f.name = v), oneLine: true },
    { path: 'id', set: (f, v) => (f.id = v) },
    { path: 'classification', set: (f, v) => (f.classification = v) },
    { path: 'latest_bill_update', set: (f, v) => (f.latest_bill_update = v) },
    { path: 'latest_people_update', set: (f, v) => (f.latest_people_update = v) },
    {
      path: 'legislative_sessions[].identifier',
      set: (f, v) => (f.legislative_sessions[0]!.identifier = v),
      oneLine: true,
    },
    { path: 'legislative_sessions[].name', set: (f, v) => (f.legislative_sessions[0]!.name = v) },
    {
      path: 'legislative_sessions[].classification',
      set: (f, v) => (f.legislative_sessions[0]!.classification = v),
    },
    {
      path: 'legislative_sessions[].start_date',
      set: (f, v) => (f.legislative_sessions[0]!.start_date = v),
    },
    {
      path: 'legislative_sessions[].end_date',
      set: (f, v) => (f.legislative_sessions[0]!.end_date = v),
    },
    { path: 'organizations[].id', set: (f, v) => (f.organizations[0]!.id = v) },
    { path: 'organizations[].name', set: (f, v) => (f.organizations[0]!.name = v) },
    {
      path: 'organizations[].classification',
      set: (f, v) => (f.organizations[0]!.classification = v),
    },
    { path: 'latest_runs[].start_time', set: (f, v) => (f.latest_runs[0]!.start_time = v) },
    { path: 'latest_runs[].end_time', set: (f, v) => (f.latest_runs[0]!.end_time = v) },
  ];

  it.each(fields)('$path reads back exactly for every hostile class', ({ set, oneLine }) => {
    const benign = structuredClone(fixture);
    set(benign, 'plain value');
    const expected = shape(render(benign));
    for (const value of oneLine ? HOSTILE_VALUES : [...HOSTILE_VALUES, ...MULTILINE_VALUES]) {
      const f = structuredClone(fixture);
      set(f, value);
      const text = render(f);
      expect({ value, shape: shape(text) }).toEqual({ value, shape: expected });
      expect(
        readBack(text).some((block) => block.includes(value)),
        value,
      ).toBe(true);
    }
  });

  it('keeps a session identifier a code literal that reads back exactly, backticks included', () => {
    for (const identifier of ['2025rs', '20`25', '`2025`', ' 2025 ']) {
      const f = structuredClone(fixture);
      f.legislative_sessions[0]!.identifier = identifier;
      const codes = inlineTokens(render(f)).filter((t) => t.type === 'code_inline');
      expect(codes[0]?.content).toBe(identifier);
    }
  });

  it('renders url as one link whose href is the URL and whose label reads back as it', () => {
    for (const url of ['https://leg.wa.gov', 'https://example.org/a b/(c)?q=<x>&amp;[y]']) {
      const text = render({ ...fixture, url });
      expect(links(text)).toEqual([{ href: normalizeLink(url), label: url }]);
    }
  });

  it('renders a non-http(s) url as literal text with no link token', () => {
    const url = 'javascript:alert(1)';
    const text = render({ ...fixture, url });
    expect(links(text)).toEqual([]);
    expect(readBack(text).some((block) => block.includes(url))).toBe(true);
  });

  /** Characterization: every line carrying no URL field is byte-identical to the pre-#53 output. */
  it('renders real-shaped values byte-identical outside the URL line', () => {
    expect(
      render(fixture)
        .split('\n')
        .filter((line) => !line.includes('https://')),
    ).toEqual([
      '# Washington',
      '**ID:** ocd-jurisdiction/country:us/state:wa/government',
      '**Classification:** state',
      '**Latest bill update:** 2025-05-20T10:00:00Z',
      '**Latest people update:** 2025-05-19T08:00:00+00:00',
      '',
      '## Legislative Sessions',
      '- `2025-2026` — 2025-2026 Regular Session (primary) 2025-01-13–2026-03-12',
      '- `2025rs` — 2025 Regular Session from 2025-01-13',
      '- `2025s1` — 2025 Special Session 1 (special)',
      '',
      '## Organizations',
      '- Washington State Senate (upper) — ocd-organization/1b2c3d4e-0000-4000-8000-000000000001',
      '- Washington State Legislature',
      '',
      '## Latest Runs',
      '- 2025-05-19T02:00:00Z → 2025-05-19T02:08:00Z (success: true)',
      '- 2025-05-18T02:00:00Z (success: n/a)',
    ]);
  });
});

/** Issue #51 wiring: a service `rate_limited` failure surfaces with this tool's declared recovery. */
describe('getJurisdiction — rate_limited contract (issue #51)', () => {
  it('surfaces a service RateLimited error with the declared recovery hint', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      getJurisdiction: vi.fn().mockRejectedValue(
        new McpError(JsonRpcErrorCode.RateLimited, 'exceeded limit of 10/min: 11', {
          reason: 'rate_limited',
          retryable: true,
          retryAfter: 37,
        }),
      ),
    } as never);
    const declared = getJurisdiction.errors?.find((e) => e.reason === 'rate_limited');
    expect(declared?.recovery).toBe(
      'Wait the number of seconds in retryAfter, then retry the same call unchanged.',
    );

    const result = await runToolContract(getJurisdiction, { jurisdiction_id: 'wa' });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.RateLimited,
          data: {
            reason: 'rate_limited',
            retryable: true,
            retryAfter: 37,
            recovery: { hint: declared?.recovery },
          },
        },
      },
    });
  });
});
