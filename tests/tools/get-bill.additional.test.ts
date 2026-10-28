/**
 * @fileoverview Additional coverage for getBill: not_found re-throw, versions,
 * documents, related_bills, and sparse upstream fields in format.
 * @module tests/tools/get-bill.additional.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBill } from '@/mcp-server/tools/definitions/get-bill.tool.js';
import { links, normalizeLink, readBack } from '../helpers/commonmark.js';
import { PAYLOADS, type Slot, structure } from '../helpers/markdown-sweep.js';

vi.mock('@/services/openstates/openstates-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/openstates/openstates-service.js')>()),
  getOpenStatesApiService: vi.fn(),
}));

const BILL_UUID = '4f255ccf-42a6-46ad-bbc6-0b027ebb15f2';
const BILL_ID = `ocd-bill/${BILL_UUID}`;
/** Well-formed but invented — passes local validation, so only upstream can say it doesn't exist. */
const MISSING_BILL_ID = 'ocd-bill/00000000-0000-4000-8000-000000000000';

const textOf = (blocks: ReturnType<NonNullable<typeof getBill.format>>) =>
  (blocks[0] as { text: string }).text;

const baseBill = {
  id: 'ocd-bill/12345',
  identifier: 'HB 1000',
  title: 'An act relating to public safety',
  session: '2025',
  jurisdiction: {
    id: 'ocd-jurisdiction/country:us/state:wa/government',
    name: 'Washington',
  },
  from_organization: { name: 'House', classification: 'lower' },
  classification: ['bill'],
  subject: ['public safety'],
  first_action_date: '2025-01-14',
  latest_action_date: '2025-03-10',
  latest_action_description: 'Passed Senate',
  latest_passage_date: '2025-03-10',
  openstates_url: 'https://openstates.org/wa/bills/2025/HB1000/',
};

describe('getBill — not_found contract error', () => {
  let mockService: {
    getBillById: ReturnType<typeof vi.fn>;
    getBillByPath: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      getBillById: vi.fn(),
      getBillByPath: vi.fn(),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('re-throws McpError NotFound as not_found contract error (openstates_id path)', async () => {
    mockService.getBillById.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'Bill not found'),
    );
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ openstates_id: MISSING_BILL_ID });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'not_found' },
    });
    expect(mockService.getBillById).toHaveBeenCalledWith(MISSING_BILL_ID, undefined, ctx);
  });

  it('re-throws McpError NotFound as not_found contract error (path triple)', async () => {
    mockService.getBillByPath.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'Bill not found'),
    );
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ jurisdiction: 'wa', session: '2025', bill_id: 'HB 9999' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'not_found' },
    });
  });

  it('propagates non-NotFound errors without wrapping in not_found', async () => {
    mockService.getBillById.mockRejectedValue(new Error('Network timeout'));
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ openstates_id: BILL_ID });
    await expect(getBill.handler(input, ctx)).rejects.toThrow('Network timeout');
  });
});

describe('getBill — missing_lookup_params with partial path', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const mockService = {
      getBillById: vi.fn(),
      getBillByPath: vi.fn(),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('throws missing_lookup_params when only session provided', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ session: '2025' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_lookup_params' },
    });
  });

  it('throws missing_lookup_params when only bill_id provided', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ bill_id: 'HB 1' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_lookup_params' },
    });
  });

  it('throws missing_lookup_params when jurisdiction+bill_id but no session', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ jurisdiction: 'wa', bill_id: 'HB 1' });
    await expect(getBill.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_lookup_params' },
    });
  });
});

describe('getBill format — versions, documents, related_bills, abstracts', () => {
  it('formats versions when present', () => {
    const result = {
      ...baseBill,
      versions: [
        {
          id: 'ver-1',
          note: 'Introduced',
          date: '2025-01-14',
          links: [{ url: 'https://example.com/HB1000.pdf', media_type: 'application/pdf' }],
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Bill Text Versions');
    expect(text).toContain('ver-1');
    expect(text).toContain('Introduced');
    expect(text).toContain('https://example.com/HB1000.pdf');
    expect(text).toContain('application/pdf');
  });

  it('formats documents when present', () => {
    const result = {
      ...baseBill,
      documents: [
        {
          id: 'doc-1',
          note: 'Fiscal Note',
          date: '2025-01-20',
          links: [{ url: 'https://example.com/fiscal.pdf', media_type: 'application/pdf' }],
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Documents');
    expect(text).toContain('doc-1');
    expect(text).toContain('Fiscal Note');
    expect(text).toContain('https://example.com/fiscal.pdf');
  });

  it('formats related_bills when present', () => {
    const result = {
      ...baseBill,
      related_bills: [
        {
          identifier: 'SB 500',
          legislative_session: '2025',
          relation_type: 'companion',
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Related Bills');
    expect(text).toContain('SB 500');
    expect(text).toContain('companion');
    expect(text).toContain('2025');
  });

  it('formats abstracts when present', () => {
    const result = {
      ...baseBill,
      abstracts: [
        {
          abstract: 'This bill establishes standards for public safety.',
          note: 'House Research',
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Summary');
    expect(text).toContain('This bill establishes standards for public safety.');
    expect(text).toContain('House Research');
  });

  it('formats voter with linked person record', () => {
    const result = {
      ...baseBill,
      votes: [
        {
          id: 'vote-1',
          motion_text: 'Do pass',
          start_date: '2025-03-10',
          result: 'pass',
          identifier: 'HB1000-v1',
          counts: [
            { option: 'yes', value: 60 },
            { option: 'no', value: 30 },
          ],
          votes: [
            {
              option: 'yes',
              voter_name: 'Rep. Smith',
              voter: { id: 'ocd-person/smith', name: 'Rep. Smith' },
            },
          ],
        },
      ],
    };
    const blocks = getBill.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('ocd-person/smith');
    expect(text).toContain('Rep. Smith');
    expect(text).toContain('yes: 60');
    expect(text).toContain('no: 30');
  });
});

describe('getBill — Zod input validation', () => {
  it('accepts numeric string for include array items via schema', () => {
    // include must be BillIncludeEnum values — invalid value should be rejected
    expect(() =>
      getBill.input.parse({ openstates_id: 'ocd-bill/1', include: ['invalid_include'] }),
    ).toThrow();
  });

  it('accepts all valid include values', () => {
    const validIncludes = [
      'sponsorships',
      'abstracts',
      'other_titles',
      'other_identifiers',
      'actions',
      'sources',
      'documents',
      'versions',
      'votes',
      'related_bills',
    ];
    for (const inc of validIncludes) {
      expect(() =>
        getBill.input.parse({ openstates_id: 'ocd-bill/1', include: [inc] }),
      ).not.toThrow();
    }
  });
});

/**
 * Regression coverage for the include-enrichment data loss (issue #18). get_bill
 * already surfaces votes/versions/documents/related_bills, but other_titles,
 * other_identifiers, and sources were advertised via `include` yet dropped: the
 * output schema stripped the keys and format() never rendered them. Fixture
 * shapes mirror the Bill interface in src/services/openstates/types.ts.
 */
describe('getBill — include enrichment surfacing (other_titles, other_identifiers, sources)', () => {
  const enrichedBill = {
    ...baseBill,
    other_titles: [{ title: 'An act concerning public safety', note: 'as introduced' }],
    other_identifiers: [{ identifier: 'HB1000-2025', scheme: 'lwrsn' }],
    sources: [{ url: 'https://leg.wa.gov/HB1000', note: 'Legislature bill page' }],
  };

  /**
   * structuredContent path. getBill.output previously stripped these three keys
   * (Zod drops undeclared keys), so this parse dropped them and the assertions
   * failed pre-fix.
   */
  it('retains other_titles, other_identifiers, and sources through the output schema', () => {
    const parsed = getBill.output.parse(enrichedBill);
    expect(parsed.other_titles).toEqual([
      { title: 'An act concerning public safety', note: 'as introduced' },
    ]);
    expect(parsed.other_identifiers).toEqual([{ identifier: 'HB1000-2025', scheme: 'lwrsn' }]);
    expect(parsed.sources).toEqual([
      { url: 'https://leg.wa.gov/HB1000', note: 'Legislature bill page' },
    ]);
  });

  /**
   * content[] path. format() rendered none of these three pre-fix.
   */
  it('renders other_titles, other_identifiers, and sources in format() text', () => {
    const blocks = getBill.format!(enrichedBill);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('An act concerning public safety');
    expect(text).toContain('as introduced');
    expect(text).toContain('HB1000-2025');
    expect(text).toContain('lwrsn');
    expect(text).toContain('https://leg.wa.gov/HB1000');
    expect(text).toContain('Legislature bill page');
  });
});

/**
 * Regression coverage for issue #31. Open States returns bill `other_identifiers` entries with
 * only an `identifier` key — no `scheme` — so a required `scheme` failed the output parse and
 * lost the entire bill record. The fixtures above supply a `scheme`, which is why unit tests
 * passed while every live `include=other_identifiers` call errored.
 */
describe('getBill — other_identifiers without a scheme (issue #31)', () => {
  const billWithSchemelessIdentifier = {
    ...baseBill,
    other_identifiers: [{ identifier: 'ocd-bill-wa-2025_2026-hb2073' }],
  };

  it('parses an entry that omits scheme through the output schema', () => {
    const parsed = getBill.output.parse(billWithSchemelessIdentifier);
    expect(parsed.other_identifiers).toEqual([{ identifier: 'ocd-bill-wa-2025_2026-hb2073' }]);
    expect(parsed.other_identifiers?.[0]?.scheme).toBeUndefined();
  });

  it('renders the identifier without an empty parenthetical', () => {
    const blocks = getBill.format!(getBill.output.parse(billWithSchemelessIdentifier));
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('- ocd-bill-wa-2025_2026-hb2073');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('()');
  });
});

/**
 * Regression coverage for issue #38. `note` is a required, non-nullable string on abstracts,
 * versions, and documents, so `""` is a legal upstream value — and Open States sends it.
 * Interpolating it unguarded left `_()_` after an abstract. Version and document lines carry an
 * optional `date` alongside `note`, so their full combination matrix lives in the issue #41 block
 * below. structuredContent is unaffected: `note: ""` is the accurate upstream value and stays.
 */
describe('getBill — empty abstract note renders no stray punctuation (issue #38)', () => {
  const abstract = 'This bill establishes standards for public safety.';

  it('drops the abstract parenthetical when note is empty', () => {
    const blocks = getBill.format!({ ...baseBill, abstracts: [{ abstract, note: '' }] });
    const text = (blocks[0] as { text: string }).text;
    expect(text.split('\n')).toContain(abstract);
    expect(text).not.toContain('_()_');
  });

  it('keeps the abstract parenthetical when note is present', () => {
    const blocks = getBill.format!({
      ...baseBill,
      abstracts: [{ abstract, note: 'House Research' }],
    });
    const text = (blocks[0] as { text: string }).text;
    expect(text.split('\n')).toContain(`${abstract} _(House Research)_`);
  });
});

/**
 * Regression coverage for issue #41. `date` is a required, non-nullable string on versions and
 * documents, and Open States routinely sends `""` alongside a populated `note`, which left a
 * bare `()` mid-line. The note and date segments are independently optional, so each of the four
 * combinations is pinned here: id alone, id + note, id + date, id + note + date. Each line is read
 * back through a CommonMark parse (the link is a Markdown link since issue #53), and the read-back
 * text and the link are pinned whole. structuredContent is unaffected: `date: ""` is the accurate
 * upstream value and stays.
 */
describe('getBill — version and document note/date composition (issue #41)', () => {
  const url = 'https://leg.wa.gov/HB1000.pdf';
  const linkList = [{ url, media_type: 'application/pdf' }];
  const expectedLinks = [
    { href: baseBill.openstates_url, label: baseBill.openstates_url },
    { href: url, label: 'application/pdf' },
  ];

  const renderVersion = (note: string, date: string) =>
    textOf(
      getBill.format!({
        ...baseBill,
        versions: [{ id: 'HB1000-2025', note, date, links: linkList }],
      }),
    );

  const renderDocument = (note: string, date: string) =>
    textOf(
      getBill.format!({ ...baseBill, documents: [{ id: 'doc-1', note, date, links: linkList }] }),
    );

  it.each([
    [
      'a version with neither note nor date as the id alone',
      () => renderVersion('', ''),
      '[HB1000-2025]: application/pdf',
    ],
    [
      'a version with a note and no date without a parenthetical',
      () => renderVersion('Introduced', ''),
      '[HB1000-2025] Introduced: application/pdf',
    ],
    [
      'a version with a date and no note',
      () => renderVersion('', '2025-01-13'),
      '[HB1000-2025] (2025-01-13): application/pdf',
    ],
    [
      'a version with both note and date',
      () => renderVersion('Introduced', '2025-01-13'),
      '[HB1000-2025] Introduced (2025-01-13): application/pdf',
    ],
    [
      'a document with neither note nor date as the id alone',
      () => renderDocument('', ''),
      '[doc-1]: application/pdf',
    ],
    [
      'a document with a note and no date without a parenthetical',
      () => renderDocument('Fiscal Note', ''),
      '[doc-1] Fiscal Note: application/pdf',
    ],
    [
      'a document with a date and no note',
      () => renderDocument('', '2025-01-20'),
      '[doc-1] (2025-01-20): application/pdf',
    ],
    [
      'a document with both note and date',
      () => renderDocument('Fiscal Note', '2025-01-20'),
      '[doc-1] Fiscal Note (2025-01-20): application/pdf',
    ],
  ])('renders %s', (_name, render, line) => {
    const text = render();
    expect(readBack(text)).toContain(line);
    expect(links(text)).toEqual(expectedLinks);
  });
});

/**
 * Regression coverage for issue #43. `start_date` on a vote event and `date` on an action are
 * required, non-nullable strings, so `""` is a legal upstream value that reaches format() intact.
 * Interpolated unguarded, the first left a bare `()` in the vote heading and the second a double
 * space plus an orphan colon on the action line. structuredContent is unaffected: `""` is the
 * accurate upstream value and stays.
 */
describe('getBill — empty vote start_date and action date (issue #43)', () => {
  const renderLines = (bill: Record<string, unknown>) => {
    const blocks = getBill.format!({ ...baseBill, ...bill });
    return (blocks[0] as { text: string }).text.split('\n');
  };

  const vote = (start_date: string) => ({
    id: 'ocd-vote/1',
    motion_text: 'Third Reading',
    start_date,
    result: 'pass',
    identifier: 'HV-12',
    counts: [{ option: 'yes', value: 60 }],
    votes: [],
  });

  const action = (date: string) => ({
    description: 'Introduced',
    date,
    classification: [],
    order: 1,
    organization: { name: 'House', classification: 'lower' },
  });

  it('drops the vote-date parenthetical when start_date is empty', () => {
    const lines = renderLines({ votes: [vote('')] });
    expect(lines).toContain('### Third Reading');
    expect(lines.join('\n')).not.toContain('()');
  });

  it('keeps the vote-date parenthetical when start_date is present', () => {
    expect(renderLines({ votes: [vote('2025-03-01')] })).toContain(
      '### Third Reading (2025-03-01)',
    );
  });

  it('drops the action date and its separator space when date is empty', () => {
    expect(renderLines({ actions: [action('')] })).toContain('- #1: Introduced — House (lower)');
  });

  it('keeps the action date when present', () => {
    expect(renderLines({ actions: [action('2025-01-14')] })).toContain(
      '- #1 2025-01-14: Introduced — House (lower)',
    );
  });
});

/**
 * Regression coverage for issue #49. `openstates_id` resolves into the request path the way the
 * service's URL builder resolves it, is percent-decoded once, and must then name one of the two
 * bill-detail routes; the canonical id is what reaches the service. Every form listed under
 * "reaches upstream" returned the bill before the change (or newly does: leading whitespace, an
 * uppercase UUID or prefix), so this table is the guard against narrowing.
 */
describe('getBill — openstates_id normalization and validation (issue #49)', () => {
  let mockService: {
    getBillById: ReturnType<typeof vi.fn>;
    getBillByPath: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = {
      getBillById: vi.fn().mockResolvedValue(baseBill),
      getBillByPath: vi.fn().mockResolvedValue(baseBill),
    };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it.each([
    ['the canonical id', BILL_ID, BILL_ID],
    ['trailing spaces', `${BILL_ID}   `, BILL_ID],
    ['leading and trailing whitespace', ` \t${BILL_ID} \n`, BILL_ID],
    [
      'a tab, CR, and LF inside the id',
      `ocd-bill/4f25\t5ccf-42a6\r-46ad-bbc6\n-0b027ebb15f2`,
      BILL_ID,
    ],
    ['an encoded slash', `ocd-bill%2F${BILL_UUID}`, BILL_ID],
    ['a lowercase encoded slash', `ocd-bill%2f${BILL_UUID}`, BILL_ID],
    ['a trailing slash', `${BILL_ID}/`, BILL_ID],
    ['a query suffix', `${BILL_ID}?x=1`, BILL_ID],
    ['a fragment suffix', `${BILL_ID}#x`, BILL_ID],
    ['an uppercase UUID', `ocd-bill/${BILL_UUID.toUpperCase()}`, BILL_ID],
    ['an uppercase prefix and UUID', `OCD-BILL/${BILL_UUID.toUpperCase()}`, BILL_ID],
    ['a well-formed id upstream may not hold', MISSING_BILL_ID, MISSING_BILL_ID],
    ['a jurisdiction/session/bill_id path', 'wa/2025-2026/HB 2383', 'wa/2025-2026/HB 2383'],
    ['an encoded space in the path form', 'wa/2025-2026/HB%202383', 'wa/2025-2026/HB 2383'],
    ['the path form with a trailing slash', 'wa/2025-2026/HB 2383/', 'wa/2025-2026/HB 2383'],
  ])('%s reaches upstream as the canonical id', async (_name, raw, expected) => {
    const ctx = createMockContext({ errors: getBill.errors });
    await getBill.handler(getBill.input.parse({ openstates_id: raw }), ctx);
    expect(mockService.getBillById).toHaveBeenCalledTimes(1);
    expect(mockService.getBillById).toHaveBeenCalledWith(expected, undefined, ctx);
    expect(mockService.getBillByPath).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty ocd-bill/ prefix', 'ocd-bill/'],
    ['a bare UUID', BILL_UUID],
    ['a non-UUID after the prefix', 'ocd-bill/not-a-uuid'],
    ['a UUID one hex digit short', `ocd-bill/${BILL_UUID.slice(0, -1)}`],
    ['a UUID without hyphens', `ocd-bill/${BILL_UUID.replaceAll('-', '')}`],
    ['a non-bill route', '../jurisdictions/wa'],
    ['a non-bill route under the prefix', 'ocd-bill/../../people'],
    ['a non-bill route in the path form', 'wa/../x'],
    ['an encoded non-bill route in the path form', 'wa/2025/%2e%2e'],
    ['an encoded non-bill route after decoding', 'wa%2F..%2Fjurisdictions'],
    ['an encoded non-bill route under the prefix', 'ocd-bill%2F..%2F..%2Fjurisdictions%2Fwa'],
    ['an encoded single-dot segment', 'wa%2F2025%2F.'],
    ['an empty path segment', 'wa//HB 1'],
    ['four path segments', 'wa/2025/HB/1'],
    ['an extra segment after a valid id', `${BILL_ID}/extra`],
    ['a malformed percent escape', 'ocd-bill/%E0%A4%A'],
  ])('rejects %s locally with invalid_openstates_id', async (_name, raw) => {
    const ctx = createMockContext({ errors: getBill.errors });
    await expect(
      getBill.handler(getBill.input.parse({ openstates_id: raw }), ctx),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      message: expect.stringContaining('openstates_search_bills'),
      data: { reason: 'invalid_openstates_id' },
    });
    expect(mockService.getBillById).not.toHaveBeenCalled();
    expect(mockService.getBillByPath).not.toHaveBeenCalled();
  });

  it('carries the declared recovery on the wire for a rejected id', async () => {
    const result = await runToolContract(getBill, { openstates_id: 'ocd-bill/' });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.ValidationError,
          data: {
            reason: 'invalid_openstates_id',
            recovery: { hint: expect.stringContaining('openstates_search_bills') },
          },
        },
      },
    });
    expect(mockService.getBillById).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only openstates_id as absent and uses the path triple', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({
      openstates_id: '  ',
      jurisdiction: 'wa',
      session: '2025-2026',
      bill_id: 'HB 2383',
    });
    await getBill.handler(input, ctx);
    expect(mockService.getBillByPath).toHaveBeenCalledWith(
      'wa',
      '2025-2026',
      'HB 2383',
      undefined,
      ctx,
    );
    expect(mockService.getBillById).not.toHaveBeenCalled();
  });

  it('leaves the three-part path lookup unvalidated beyond presence', async () => {
    const ctx = createMockContext({ errors: getBill.errors });
    const input = getBill.input.parse({ jurisdiction: 'tx', session: '89R', bill_id: 'HB2' });
    await getBill.handler(input, ctx);
    expect(mockService.getBillByPath).toHaveBeenCalledWith('tx', '89R', 'HB2', undefined, ctx);
  });
});

/**
 * The `not_found` recovery has to serve both lookup modes: a direct-ID caller holds no session or
 * bill_id to correct. Upstream also resolves "HB2" and "HB 2" to the same bill, so the hint names
 * no spacing convention.
 */
describe('getBill — not_found recovery covers both lookup modes (issue #49)', () => {
  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    const notFound = () =>
      new McpError(JsonRpcErrorCode.NotFound, 'No such Bill.', { status: 404 });
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      getBillById: vi.fn().mockRejectedValue(notFound()),
      getBillByPath: vi.fn().mockRejectedValue(notFound()),
    } as never);
  });

  it.each([
    ['a well-formed direct id', { openstates_id: MISSING_BILL_ID }, MISSING_BILL_ID],
    [
      'a path triple',
      { jurisdiction: 'wa', session: '2025', bill_id: 'HB 9999' },
      'wa/2025/HB 9999',
    ],
  ])('%s', async (_name, input, id) => {
    const result = await runToolContract(getBill, input);
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: JsonRpcErrorCode.NotFound,
          message: `Bill not found: ${id}`,
          data: { reason: 'not_found' },
        },
      },
    });
    const hint = (result.structuredContent as { error: { data: { recovery: { hint: string } } } })
      .error.data.recovery.hint;
    expect(hint).toContain('openstates_search_bills');
    expect(hint).toContain('openstates_get_jurisdiction');
    expect(hint).not.toContain('HB1000');
  });
});

/** Issue #51 wiring: a service `rate_limited` error surfaces with this tool's declared recovery. */
describe('getBill — rate_limited contract (issue #51)', () => {
  it('surfaces a service RateLimited error with the declared recovery and retryAfter', async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    vi.mocked(getOpenStatesApiService).mockReturnValue({
      getBillById: vi.fn().mockRejectedValue(
        new McpError(JsonRpcErrorCode.RateLimited, 'exceeded limit of 10/min: 11', {
          reason: 'rate_limited',
          retryable: true,
          retryAfter: 42,
        }),
      ),
      getBillByPath: vi.fn(),
    } as never);

    const result = await runToolContract(getBill, { openstates_id: BILL_ID });

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

/**
 * Issue #53: every upstream string `format()` renders reads back unchanged through a CommonMark
 * parse. `fullBill` populates every string leaf with two entries per array, nested arrays included
 * (sponsorships → person, votes → counts and per-legislator votes → voter, versions/documents →
 * links), so a field rendered raw at any depth or index changes either the parsed structure or the
 * read-back text.
 */
function fullBill(text: (slot: Slot) => string, url: (n: number) => string) {
  let u = 0;
  const t = () => text('inline');
  const h = () => text('heading');
  const link = () => ({ url: url(u++), media_type: t() });
  const textRecord = () => ({ id: t(), note: t(), date: t(), links: [link(), link()] });
  const vote = (withVoter: boolean) => ({
    id: t(),
    motion_text: h(),
    start_date: h(), // rendered in the vote heading beside motion_text
    result: t(),
    identifier: t(),
    counts: [
      { option: t(), value: 60 },
      { option: t(), value: 30 },
    ],
    votes: [
      { option: t(), voter_name: t(), ...(withVoter ? { voter: { id: t(), name: t() } } : {}) },
      { option: t(), voter_name: t(), voter: { id: t(), name: t() } },
    ],
  });
  return {
    id: t(),
    identifier: h(),
    title: h(),
    session: t(),
    jurisdiction: { id: t(), name: t() },
    from_organization: { name: t(), classification: t() },
    classification: [t(), t()],
    subject: [t(), t()],
    first_action_date: t(),
    latest_action_date: t(),
    latest_action_description: t(),
    latest_passage_date: t(),
    updated_at: t(),
    openstates_url: url(u++),
    sponsorships: [
      {
        name: t(),
        entity_type: t(),
        primary: true,
        classification: t(),
        person: { id: t(), name: t() },
      },
      { name: t(), entity_type: t(), primary: false, classification: t() },
    ],
    actions: [0, 1].map((order) => ({
      description: t(),
      date: t(),
      classification: [t(), t()],
      order,
      organization: { name: t(), classification: t() },
    })),
    votes: [vote(true), vote(false)],
    abstracts: [
      { abstract: t(), note: t() },
      { abstract: t(), note: t() },
    ],
    versions: [textRecord(), textRecord()],
    documents: [textRecord(), textRecord()],
    related_bills: [0, 1].map(() => ({
      identifier: t(),
      legislative_session: t(),
      relation_type: t(),
    })),
    other_titles: [
      { title: t(), note: t() },
      { title: t(), note: t() },
    ],
    other_identifiers: [
      { identifier: t(), scheme: t() },
      { identifier: t(), scheme: t() },
    ],
    sources: [
      { url: url(u++), note: t() },
      { url: url(u++), note: t() },
    ],
  };
}

/** String leaves `fullBill` fills through `text` — pinned so a fixture that loses a field fails. */
const TEXT_LEAVES = 105;

describe('getBill format — upstream strings read back literally (issue #53)', () => {
  const plainUrl = (n: number) => `https://example.org/u${n}`;
  const render = (bill: ReturnType<typeof fullBill>) =>
    textOf(getBill.format!(getBill.output.parse(bill)));

  it.each(PAYLOADS)('%s', (_name, payload) => {
    let n = 0;
    const marker = () => `f${String(n++).padStart(3, '0')}`;
    const benign = render(fullBill(() => marker(), plainUrl));

    n = 0;
    const values: string[] = [];
    const hostile = render(
      fullBill((slot) => {
        const value = payload(marker(), slot);
        values.push(value);
        return value;
      }, plainUrl),
    );

    expect(values).toHaveLength(TEXT_LEAVES);
    expect(structure(hostile)).toEqual(structure(benign));
    const read = readBack(hostile).join('\n');
    for (const value of values) expect(read).toContain(value);
  });

  it('keeps real-shaped identifiers byte-identical', () => {
    const text = textOf(
      getBill.format!({
        ...baseBill,
        id: BILL_ID,
        session: '2025rs',
        other_identifiers: [{ identifier: 'ocd-bill-wa-2025_2026-hb2073' }],
      }),
    );
    expect(text.split('\n')).toEqual(
      expect.arrayContaining([
        '# HB 1000 — An act relating to public safety',
        `**ID:** ${BILL_ID}`,
        '**Session:** 2025rs | **Jurisdiction:** Washington (ocd-jurisdiction/country:us/state:wa/government)',
        '**Latest action:** 2025-03-10 — Passed Senate',
        '- ocd-bill-wa-2025_2026-hb2073',
      ]),
    );
  });
});

describe('getBill format — URL fields render as links (issue #53)', () => {
  const hostileUrl = (n: number) => `https://example.org/u${n}/a b(c)<d>[e]&amp;f_g*h`;

  it('renders every URL field as one link: href is the URL, label the note or media type', () => {
    let n = 0;
    const bill = getBill.output.parse(
      fullBill(() => `f${String(n++).padStart(3, '0')}`, hostileUrl),
    );
    const linkTo = (href: string, label: string) => ({ href: normalizeLink(href), label });

    expect(links(textOf(getBill.format!(bill)))).toEqual([
      linkTo(bill.openstates_url!, bill.openstates_url!),
      ...bill.versions!.flatMap((v) => v.links.map((l) => linkTo(l.url, l.media_type))),
      ...bill.documents!.flatMap((d) => d.links.map((l) => linkTo(l.url, l.media_type))),
      ...bill.sources!.map((s) => linkTo(s.url, s.note)),
    ]);
  });

  it('labels a link with its URL when the note or media type is empty', () => {
    const url = 'https://leg.wa.gov/a b(c).pdf';
    const text = textOf(
      getBill.format!({
        ...baseBill,
        openstates_url: undefined,
        versions: [{ id: 'v1', note: '', date: '', links: [{ url, media_type: '' }] }],
        sources: [{ url, note: '' }],
      }),
    );
    expect(links(text)).toEqual([
      { href: normalizeLink(url), label: url },
      { href: normalizeLink(url), label: url },
    ]);
    expect(text).not.toContain('_()_');
    expect(readBack(text)).toContain(`[v1]: ${url}`);
  });

  it('renders a non-http(s) URL as literal text with no link token', () => {
    const text = textOf(
      getBill.format!({
        ...baseBill,
        openstates_url: 'javascript:alert(1)',
        sources: [{ url: 'ftp://example.org/x', note: 'Mirror' }],
      }),
    );
    expect(links(text)).toEqual([]);
    const read = readBack(text).join('\n');
    expect(read).toContain('javascript:alert(1)');
    expect(read).toContain('Mirror (ftp://example.org/x)');
  });
});
