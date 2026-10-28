/**
 * @fileoverview Tests for the jurisdictionResource resource.
 * @module tests/resources/jurisdiction.resource.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { createWorkerHandler } from '@cyanheads/mcp-ts-core/worker';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jurisdictionResource } from '@/mcp-server/resources/definitions/jurisdiction.resource.js';

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

/**
 * One JSON-RPC request through the served definition — the SDK's URI-template matcher, the
 * framework's params parse, and its error shaping all run, which a direct handler call skips.
 */
async function servedRpc(method: string, params: Record<string, unknown>, name?: string) {
  const worker = createWorkerHandler({
    name: 'openstates-mcp-server',
    title: 'openstates-mcp-server',
    resources: [jurisdictionResource],
  });
  const response = await worker.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': method,
        ...(name === undefined ? {} : { 'Mcp-Name': name }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'resource-test', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
    {} as never,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );
  const text = await response.text();
  const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
  return JSON.parse(dataLine ? dataLine.slice(5) : text);
}

/** `resources/read` of `uri` through the served definition. */
const readServed = (uri: string) => servedRpc('resources/read', { uri }, uri);

/** The JSON a successful served read returned. */
function readJson(body: { result?: { contents?: { text?: string }[] } }): unknown {
  const text = body.result?.contents?.[0]?.text;
  expect(text).toBeTypeOf('string');
  return JSON.parse(text as string);
}

describe('jurisdictionResource', () => {
  let mockService: { getJurisdiction: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    mockService = { getJurisdiction: vi.fn().mockResolvedValue(mockJurisdiction) };
    vi.mocked(getOpenStatesApiService).mockReturnValue(mockService as never);
  });

  it('returns jurisdiction data for a valid abbreviation', async () => {
    const ctx = createMockContext({
      tenantId: 'test-tenant',
      errors: jurisdictionResource.errors,
    });
    const params = jurisdictionResource.params!.parse({ jurisdiction_id: 'wa' });
    const result = await jurisdictionResource.handler(params, ctx);
    expect(result).toBeDefined();
    expect((result as typeof mockJurisdiction).id).toBe(
      'ocd-jurisdiction/country:us/state:wa/government',
    );
    expect((result as typeof mockJurisdiction).name).toBe('Washington');
  });

  it('always requests legislative_sessions include', async () => {
    const ctx = createMockContext({
      tenantId: 'test-tenant',
      errors: jurisdictionResource.errors,
    });
    const params = jurisdictionResource.params!.parse({ jurisdiction_id: 'wa' });
    await jurisdictionResource.handler(params, ctx);
    expect(mockService.getJurisdiction).toHaveBeenCalledWith(
      'wa',
      ['legislative_sessions'],
      expect.anything(),
    );
  });

  it('rethrows a service NotFound as a typed not-found error with the invalid id', async () => {
    // The real not-found path is a rejected McpError (upstream 404 → NotFound), never a
    // resolved null — the service's fetchJson only ever throws on a non-OK response. The
    // resource must translate that into its own typed error, mirroring openstates_get_jurisdiction.
    mockService.getJurisdiction.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'OpenStates returned HTTP 404 Not Found.', {
        url: 'https://v3.openstates.org/jurisdictions/not-a-real-jurisdiction',
      }),
    );
    const ctx = createMockContext({ errors: jurisdictionResource.errors });
    const params = jurisdictionResource.params!.parse({
      jurisdiction_id: 'not-a-real-jurisdiction',
    });
    await expect(jurisdictionResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      message: 'Jurisdiction not found: not-a-real-jurisdiction',
      data: { reason: 'not_found' },
    });
  });

  it('puts the declared not-found recovery hint on the wire', async () => {
    // A direct handler call returns the throw site's error unfilled; the resource factory adds the
    // declared hint, so the read goes through a served definition.
    mockService.getJurisdiction.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'OpenStates returned HTTP 404 Not Found.'),
    );
    const body = await readServed('openstates://jurisdiction/not-a-real-jurisdiction');

    expect(body.error).toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: {
        reason: 'not_found',
        recovery: { hint: expect.stringContaining('openstates_list_jurisdictions') },
      },
    });
  });

  it('propagates a non-NotFound service error without wrapping it as not_found', async () => {
    // Regression guard: only a NotFound is translated; every other upstream failure bubbles
    // up unchanged so the caller sees the real cause (a wrapped ServiceUnavailable would flip
    // the code to NotFound and fail this assertion).
    mockService.getJurisdiction.mockRejectedValue(
      new McpError(JsonRpcErrorCode.ServiceUnavailable, 'Open States API unavailable.'),
    );
    const ctx = createMockContext({ errors: jurisdictionResource.errors });
    const params = jurisdictionResource.params!.parse({ jurisdiction_id: 'wa' });
    await expect(jurisdictionResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
  });

  it('propagates network errors from service', async () => {
    mockService.getJurisdiction.mockRejectedValue(new Error('Service unavailable'));
    const ctx = createMockContext({
      tenantId: 'test-tenant',
      errors: jurisdictionResource.errors,
    });
    const params = jurisdictionResource.params!.parse({ jurisdiction_id: 'wa' });
    await expect(jurisdictionResource.handler(params, ctx)).rejects.toThrow('Service unavailable');
  });

  it('lists sample resources from list()', async () => {
    const listContext = {} as Parameters<NonNullable<typeof jurisdictionResource.list>>[0];
    const listing = await jurisdictionResource.list!(listContext);
    expect(listing.resources).toBeInstanceOf(Array);
    expect(listing.resources.length).toBeGreaterThan(0);
    for (const r of listing.resources) {
      expect(r).toHaveProperty('uri');
      expect(r).toHaveProperty('name');
      expect(r.uri).toMatch(/^openstates:\/\/jurisdiction\//);
    }
  });
});

// --------------------------------------------------------------------------
// URI-template routing (issue #48): every identifier the resource advertises reads the same
// record the tool returns for it, through the SDK's matcher and one decode.
// --------------------------------------------------------------------------

describe('jurisdictionResource — served reads by every identifier form', () => {
  const AL_OCD = 'ocd-jurisdiction/country:us/state:al/government';
  const alabama = { ...mockJurisdiction, id: AL_OCD, name: 'Alabama' };
  const newYork = {
    ...mockJurisdiction,
    id: 'ocd-jurisdiction/country:us/state:ny/government',
    name: 'New York',
  };
  /** What upstream resolves, keyed by the decoded identifier the service would send. */
  const UPSTREAM = new Map<string, unknown>([
    ['al', alabama],
    ['Alabama', alabama],
    [AL_OCD, alabama],
    ['New York', newYork],
    ['wa', mockJurisdiction],
    ['ca', { ...mockJurisdiction, name: 'California' }],
    ['ny', newYork],
    ['tx', { ...mockJurisdiction, name: 'Texas' }],
  ]);
  let getJurisdiction: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { getOpenStatesApiService } = await import('@/services/openstates/openstates-service.js');
    getJurisdiction = vi.fn((id: string) => {
      const found = UPSTREAM.get(id);
      return found === undefined
        ? Promise.reject(new McpError(JsonRpcErrorCode.NotFound, 'No such Jurisdiction.'))
        : Promise.resolve(found);
    });
    vi.mocked(getOpenStatesApiService).mockReturnValue({ getJurisdiction } as never);
  });

  it('advertises the reserved-expansion template', async () => {
    const body = await servedRpc('resources/templates/list', {});
    const templates = (body.result?.resourceTemplates ?? []) as { uriTemplate: string }[];
    expect(templates.map((t) => t.uriTemplate)).toEqual([
      'openstates://jurisdiction/{+jurisdiction_id}',
    ]);
  });

  it.each([
    ['an abbreviation', 'openstates://jurisdiction/al'],
    ['a single-word state name', 'openstates://jurisdiction/Alabama'],
    ['the raw OCD ID openstates_list_jurisdictions returns', `openstates://jurisdiction/${AL_OCD}`],
    [
      'the percent-encoded OCD ID',
      'openstates://jurisdiction/ocd-jurisdiction%2Fcountry%3Aus%2Fstate%3Aal%2Fgovernment',
    ],
  ])('reads Alabama by %s', async (_form, uri) => {
    const body = await readServed(uri);

    expect(body.error).toBeUndefined();
    expect(readJson(body)).toEqual(alabama);
    expect(getJurisdiction).toHaveBeenCalledTimes(1);
  });

  it('decodes the OCD ID before the lookup, so the service gets the slash form', async () => {
    await readServed(
      'openstates://jurisdiction/ocd-jurisdiction%2Fcountry%3Aus%2Fstate%3Aal%2Fgovernment',
    );
    expect(getJurisdiction).toHaveBeenCalledWith(
      AL_OCD,
      ['legislative_sessions'],
      expect.anything(),
    );
  });

  it('reads a multi-word state name sent with a literal space', async () => {
    // `new URL` normalizes the space to %20 before the matcher sees it.
    const body = await readServed('openstates://jurisdiction/New York');

    expect(body.error).toBeUndefined();
    expect(readJson(body)).toEqual(newYork);
    expect(getJurisdiction).toHaveBeenCalledWith(
      'New York',
      ['legislative_sessions'],
      expect.anything(),
    );
  });

  it('decodes exactly once', async () => {
    // %2520 is an encoded "%20"; a second decode would turn it into a space.
    await readServed('openstates://jurisdiction/New%2520York');
    expect(getJurisdiction).toHaveBeenCalledWith(
      'New%20York',
      ['legislative_sessions'],
      expect.anything(),
    );
  });

  it.each(['wa', 'ca', 'ny', 'tx'])('reads the listed sample %s', async (abbr) => {
    const body = await readServed(`openstates://jurisdiction/${abbr}`);
    expect(body.error).toBeUndefined();
    expect(readJson(body)).toEqual(UPSTREAM.get(abbr));
  });

  it('fails an unknown ID as not_found, naming the decoded value', async () => {
    const body = await readServed('openstates://jurisdiction/Not%20A%20State');

    expect(body.error).toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      message: 'Jurisdiction not found: Not A State',
      data: { reason: 'not_found' },
    });
  });

  it('rejects a malformed percent-escape as a client error, before any lookup', async () => {
    const body = await readServed('openstates://jurisdiction/al%ZZ');

    // The framework classifies a params-schema rejection as ValidationError, never InternalError.
    expect(body.error?.code).toBe(JsonRpcErrorCode.ValidationError);
    expect(body.error?.message).toContain('malformed percent-escape');
    expect(getJurisdiction).not.toHaveBeenCalled();
  });

  /** The service raises `rate_limited` with no hint; the resource's contract supplies it. */
  it('surfaces a service rate_limited error with the declared recovery', async () => {
    getJurisdiction.mockRejectedValue(
      new McpError(
        JsonRpcErrorCode.RateLimited,
        "Open States rate-limited this server's API key: exceeded limit of 10/min: 11.",
        { reason: 'rate_limited', retryable: true, retryAfter: 48 },
      ),
    );
    const body = await readServed('openstates://jurisdiction/wa');

    expect(body.error).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: {
        reason: 'rate_limited',
        retryable: true,
        retryAfter: 48,
        recovery: {
          hint: 'Wait the number of seconds in retryAfter, then retry the same call unchanged.',
        },
      },
    });
  });
});
