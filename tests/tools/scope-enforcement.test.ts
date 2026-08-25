/**
 * @fileoverview Cross-tool checks on the `jurisdiction`-or-`q` / `jurisdiction`-or-`id` scope rule:
 * that `openstates_search_bills` and `openstates_search_people` reject the same violation in the
 * same shape, and that no input the rule is meant to catch reaches the Open States API. The second
 * suite runs the real service against an instrumented `fetch` rather than a mocked accessor, so a
 * leak anywhere between the schema and the HTTP call would show up as a recorded request.
 * @module tests/tools/scope-enforcement.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchBills } from '@/mcp-server/tools/definitions/search-bills.tool.js';
import { searchPeople } from '@/mcp-server/tools/definitions/search-people.tool.js';
import { initOpenStatesApiService } from '@/services/openstates/openstates-service.js';

/**
 * Both tools enforce the same class of rule and, since #45 converged them on a cross-field
 * refinement, answer a violation with the same kind of failure: a Zod issue on the input object,
 * surfaced as an input-validation error carrying no `structuredContent`. The two message strings
 * differ only where the field names do.
 */
describe('either/or scope rejection has the same shape on both tools', () => {
  it('rejects an omitted scope at the object root on both', () => {
    for (const [name, issues] of [
      ['openstates_search_bills', searchBills.input.safeParse({}).error?.issues],
      ['openstates_search_people', searchPeople.input.safeParse({}).error?.issues],
    ] as const) {
      expect(issues, name).toHaveLength(1);
      expect(issues?.[0]?.code, name).toBe('custom');
      expect(issues?.[0]?.path, name).toEqual([]);
      expect(issues?.[0]?.message, name).toMatch(/^Either jurisdiction or (q|id) is required\./);
    }
  });

  /**
   * The residual divergence #47 recorded: `search_people` rejected `""` at the schema layer while
   * `search_bills` let it through to a handler guard that answered a typed `missing_scope` error.
   * With the guard gone, `""` satisfies `!== undefined`, so `.min(1)` on both tools' `jurisdiction`
   * is what stops it — and both now produce the identical issue.
   */
  it('rejects an empty-string jurisdiction identically on both (issue #47)', () => {
    const bills = searchBills.input.safeParse({ jurisdiction: '' }).error?.issues;
    const people = searchPeople.input.safeParse({ jurisdiction: '' }).error?.issues;

    expect(bills).toHaveLength(1);
    expect(people).toHaveLength(1);
    expect(bills?.[0]?.code).toBe('too_small');
    expect(bills?.[0]?.path).toEqual(['jurisdiction']);
    expect(people?.[0]?.code).toBe(bills?.[0]?.code);
    expect(people?.[0]?.path).toEqual(bills?.[0]?.path);
    expect(people?.[0]?.message).toBe(bills?.[0]?.message);
  });

  it('declares missing_scope on neither tool', () => {
    expect(searchBills.errors?.map((e) => e.reason)).not.toContain('missing_scope');
    expect(searchPeople.errors?.map((e) => e.reason)).not.toContain('missing_scope');
  });
});

/**
 * Every input shape in which a tool's two scope fields are both effectively absent. Each has to be
 * refused before an unscoped request goes out — that request sits on the upstream gateway for its
 * full window and answers 504.
 *
 * Each suite carries its own closures rather than a shared tool reference so both handlers' input
 * types stay checked. `run` returns whether the input survived the schema: a `true` marks a shape
 * that reached the handler, which the assertions below then hold to the same zero-request bar.
 */
const SCOPE_SUITES = [
  {
    tool: 'openstates_search_bills',
    unscoped: [
      {},
      { jurisdiction: '' },
      { q: '' },
      { jurisdiction: '', q: '' },
      { jurisdiction: null },
      { q: null },
      { jurisdiction: 0 },
      { q: [] },
      { q: {} },
      { session: '2025' },
      { sort: 'updated_desc' },
      { per_page: 5 },
      { page: 2 },
      { chamber: 'upper' },
      { subject: [] },
      { classification: 'bill' },
      { sponsor: 'Smith' },
      { include: ['actions'] },
    ],
    runScoped: async () => {
      // The real service reads `ctx.state` for its response cache, which needs a tenant.
      const ctx = createMockContext({ tenantId: 'default', errors: searchBills.errors });
      await searchBills.handler(searchBills.input.parse({ jurisdiction: 'wa' }), ctx);
    },
    run: async (input: unknown) => {
      const parsed = searchBills.input.safeParse(input);
      if (!parsed.success) return false;
      const ctx = createMockContext({ tenantId: 'default', errors: searchBills.errors });
      await Promise.resolve(searchBills.handler(parsed.data, ctx)).catch(() => undefined);
      return true;
    },
  },
  {
    tool: 'openstates_search_people',
    unscoped: [
      {},
      { jurisdiction: '' },
      { id: [] },
      { id: [''] },
      { jurisdiction: '', id: [] },
      { jurisdiction: null },
      { id: null },
      { id: {} },
      { id: 'ocd-person/9eddb3cd-868e-42ba-831a-b415fd7ed445' },
      { name: 'Ferguson' },
      { org_classification: 'upper' },
      { district: '37' },
      { per_page: 5 },
      { page: 2 },
      { include: ['offices'] },
    ],
    runScoped: async () => {
      const ctx = createMockContext({ tenantId: 'default', errors: searchPeople.errors });
      await searchPeople.handler(searchPeople.input.parse({ jurisdiction: 'wa' }), ctx);
    },
    run: async (input: unknown) => {
      const parsed = searchPeople.input.safeParse(input);
      if (!parsed.success) return false;
      const ctx = createMockContext({ tenantId: 'default', errors: searchPeople.errors });
      await Promise.resolve(searchPeople.handler(parsed.data, ctx)).catch(() => undefined);
      return true;
    },
  },
] as const;

describe.each(SCOPE_SUITES)('no effectively-unscoped $tool call reaches the API', (suite) => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [],
            pagination: { page: 1, per_page: 10, max_page: 1, total_items: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    // The real service, not a mocked accessor — the instrumentation sits at the HTTP boundary, so
    // anything that slips past the schema and the handler is recorded as a request.
    initOpenStatesApiService(
      {} as Parameters<typeof initOpenStatesApiService>[0],
      {} as Parameters<typeof initOpenStatesApiService>[1],
      {
        apiKey: 'test-key',
        apiBaseUrl: 'https://v3.openstates.org',
        dailyRequestBudget: 250,
        requestTimeoutMs: 45_000,
        totalRequestBudgetMs: 90_000,
      } as Parameters<typeof initOpenStatesApiService>[2],
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Positive control. Without it, a zero-request result would also be what a stub that never
   * intercepts anything produces.
   */
  it('records a request for a scoped call', async () => {
    await suite.runScoped();
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it.each(suite.unscoped.map((input) => [JSON.stringify(input), input] as const))(
    'issues no request for %s',
    async (_label, input) => {
      // A shape that survives the schema is the leak this suite exists to catch, and there is no
      // handler guard left to stop it. `run` gives the handler a tenant so the service reaches its
      // HTTP call rather than failing earlier on `ctx.state` — an early throw would satisfy the
      // assertion below without proving anything. How the call ends does not matter; whether a
      // request went out does.
      await suite.run(input);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});
