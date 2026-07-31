/**
 * @fileoverview Open States API v3 REST client — auth, pagination, retry, response normalization.
 * @module services/openstates/openstates-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  JsonRpcErrorCode,
  McpError,
  rateLimited,
  serviceUnavailable,
  timeout,
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import type { RequestContext } from '@cyanheads/mcp-ts-core/utils';
import { fetchWithTimeout, logger, RateLimiter, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { ServerConfig } from '@/config/server-config.js';
import type {
  Bill,
  BillListResponse,
  BillSearchParams,
  Chamber,
  Committee,
  CommitteeListResponse,
  CommitteeSearchParams,
  Event,
  EventListResponse,
  EventSearchParams,
  Jurisdiction,
  JurisdictionListParams,
  JurisdictionListResponse,
  PeopleSearchParams,
  Person,
  PersonListResponse,
  RawPerson,
} from './types.js';

/** Normalize the upstream `party` field — may be string or array of objects. */
function normalizeParty(party: RawPerson['party']): string {
  if (!party) return '';
  if (typeof party === 'string') return party;
  // Array of party objects — prefer the one with no end_date (current)
  const active = party.find((p) => !p.end_date);
  return active?.name ?? party[0]?.name ?? '';
}

/** Normalize a raw membership record — API returns `person: {id, name}` not flat `person_id`. */
function normalizeMembership(raw: Record<string, unknown>): {
  person_id: string;
  person_name: string;
  role: string;
} {
  const person = raw['person'] as { id?: string; name?: string } | undefined;
  return {
    person_id: person?.id ?? (raw['person_id'] as string | undefined) ?? '',
    person_name: (raw['person_name'] as string | undefined) ?? person?.name ?? '',
    role: (raw['role'] as string | undefined) ?? '',
  };
}

function normalizePerson(raw: RawPerson): Person {
  const person: Person = {
    id: raw.id,
    name: raw.name,
    party: normalizeParty(raw.party),
    current_role: raw.current_role ?? null,
    jurisdiction: raw.jurisdiction ?? { id: '', name: '' },
    given_name: raw.given_name ?? '',
    family_name: raw.family_name ?? '',
    email: raw.email ?? '',
    openstates_url: raw.openstates_url ?? '',
  };
  if (raw.image) person.image = raw.image;
  if (raw.offices?.length) person.offices = raw.offices;
  if (raw.links?.length) person.links = raw.links;
  if (raw.other_names?.length) person.other_names = raw.other_names;
  if (raw.other_identifiers?.length) person.other_identifiers = raw.other_identifiers;
  if (raw.sources?.length) person.sources = raw.sources;
  return person;
}

/**
 * Upper bound on the number of pages `listJurisdictions` will auto-merge to satisfy the
 * one-call inventory promise. The `classification=state` set is 56 (50 states + DC + 5 US
 * territories) against an upstream `per_page` ceiling of 52, so it completes in 2 pages;
 * anything larger (e.g. municipalities) falls through to plain single-page pagination rather
 * than draining the collection.
 */
const MAX_JURISDICTION_MERGE_PAGES = 2;

/**
 * Full jurisdiction display name (lowercased) → Open States abbreviation, covering the entire
 * `classification=state` inventory: 50 states, DC, and 5 US territories.
 *
 * The `/committees` endpoint returns HTTP 500 when a full jurisdiction *name* is combined with a
 * `chamber` filter, while the abbreviation and OCD-ID forms resolve correctly; normalizing a name
 * to its abbreviation before the request sidesteps the upstream fault. `/bills`, `/people`, and
 * `/events` do not exhibit it, so this map is applied only in `searchCommittees`. A static map
 * keeps normalization deterministic and adds no request.
 */
const JURISDICTION_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  'new hampshire': 'nh',
  'new jersey': 'nj',
  'new mexico': 'nm',
  'new york': 'ny',
  'north carolina': 'nc',
  'north dakota': 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  'rhode island': 'ri',
  'south carolina': 'sc',
  'south dakota': 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  'west virginia': 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
  'district of columbia': 'dc',
  'american samoa': 'as',
  guam: 'gu',
  'northern mariana islands': 'mp',
  'puerto rico': 'pr',
  // Open States' canonical display name is "United States Virgin Islands"; the shorter form is
  // carried too so either spelling a caller might copy resolves to the abbreviation.
  'united states virgin islands': 'vi',
  'virgin islands': 'vi',
};

/**
 * Resolve a `jurisdiction` input to a `/committees`-safe form. A recognized full state or
 * territory name maps to its abbreviation; abbreviations and OCD-IDs (never name-map keys) and
 * any unrecognized value pass through unchanged.
 */
function normalizeCommitteeJurisdiction(value: string): string {
  return JURISDICTION_NAME_TO_ABBR[value.trim().toLowerCase()] ?? value;
}

/** Rolling window the daily budget is measured over. */
const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Rejection text for the daily-budget guard, interpolated with `{waitTime}` by the framework
 * `RateLimiter`. The default template reads as an upstream 429 ("Rate limit exceeded. Please try
 * again in 84213 seconds."), which invites a retry against a cap this server imposes on itself;
 * naming the budget and the env var that raises it gives the caller the only action that works.
 */
const BUDGET_EXCEEDED_MESSAGE =
  "This server's own daily Open States request budget is spent — this is a self-imposed cap, not a rejection from Open States. It resets in {waitTime} seconds; retrying before then fails again. Raise it with the OPENSTATES_DAILY_REQUEST_BUDGET environment variable if your API key's tier allows more than the free tier's 250 requests/day.";

/** One shared-key budget bucket — the hosted deployment rations a single upstream key across all callers. */
const RATE_LIMIT_KEY = 'openstates:shared-key';

/**
 * Multiplier for the backstop handed to `fetchWithTimeout`'s own timer, kept deliberately later
 * than the service's deadline so the service's always fires first and the helper's never does.
 *
 * The service arms its own deadline (see `fetchAttempt`) rather than delegating to the helper's
 * timer, so expiry is observable on a signal it owns — `deadline.signal.aborted` separates "this
 * client ran out of patience" from "the caller went away" regardless of how the helper classifies
 * the abort it sees. Keeping the helper's timer inert makes the fail-fast path independent of that
 * classification, which has changed across framework versions.
 */
const FETCH_BACKSTOP_MULTIPLIER = 2;

/**
 * Statuses with a dedicated non-retryable path in `classifyUpstreamFailure`. Listing them keeps
 * `fetchWithTimeout` from logging an expected, already-handled outcome at `error` severity; the
 * thrown error is unchanged.
 */
const EXPECTED_UPSTREAM_STATUSES = [429, 504];

/**
 * Which clock ran out on a request, when one did. The two are separately observable and carry
 * different remedies, so they are never collapsed: `deadline` is one attempt exceeding
 * `requestTimeoutMs`, `budget` is the whole call — every attempt plus the backoff between them —
 * exceeding `totalRequestBudgetMs`.
 */
type TimeoutSource = 'deadline' | 'budget';

/**
 * Ceiling on the upstream text carried into a client-visible message. Long enough for any bound
 * Open States states; short enough that a rewritten message stays one readable sentence.
 */
const MAX_DETAIL_LENGTH = 200;

/**
 * Reads the constraint Open States names when it rejects a request. Every 4xx answers with
 * `{"detail": "invalid page, must be in [1, 1]"}` — the exact bound violated, and the only part of
 * the response worth showing the caller. `fetchWithTimeout` captures that body into
 * `error.data.body` but no one reads it, so the caller otherwise sees a bare status line.
 *
 * The value is upstream-controlled text bound for a message the framework renders above its own
 * `Recovery:` line, so it is flattened to a single line and clamped: a `detail` carrying newlines
 * could otherwise write a second, forged recovery hint into what the caller reads.
 *
 * Returns `undefined` for anything else: a body truncated mid-JSON at the helper's 500-byte cap, an
 * HTML gateway page, or FastAPI's array-shaped `detail`. Those pass through with the default
 * message rather than being paraphrased into something this client cannot vouch for.
 */
function upstreamDetail(body: unknown): string | undefined {
  if (typeof body !== 'string' || body.trim() === '') return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const detail = (parsed as Record<string, unknown>)['detail'];
  if (typeof detail !== 'string') return;
  const flattened = detail.replace(/\s+/gu, ' ').trim();
  if (flattened === '') return;
  return flattened.length > MAX_DETAIL_LENGTH
    ? `${flattened.slice(0, MAX_DETAIL_LENGTH)}…`
    : flattened;
}

/**
 * `origin + pathname` of a request URL, for the error payloads and log lines a client can see.
 * Drops the query string the same way the framework redacts the URLs it puts in fetch errors —
 * nothing in the query is needed to act on a failure, and a base URL configured with credentials
 * would otherwise ride out with it.
 */
function redactedUrl(url: string): string {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname}`;
}

/**
 * Log bindings for `fetchWithTimeout`. The handler-facing `Context` carries no index signature,
 * so it is not assignable to the open `RequestContext` bag the helper takes — project the
 * correlation fields explicitly rather than casting.
 */
function fetchLogContext(ctx: Context): RequestContext {
  return {
    requestId: ctx.requestId,
    timestamp: ctx.timestamp,
    tenantId: ctx.tenantId,
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    operation: 'OpenStatesApiService.fetchJson',
  };
}

/**
 * `ctx.state` cache-key namespace for `fetchJson` responses. The storage key validator only accepts
 * `[A-Za-z0-9_.\-/]` (no colons, no query punctuation), so the namespace uses underscores and the URL
 * itself is hashed rather than embedded — see `cacheKeyForUrl`.
 */
const CACHE_KEY_PREFIX = 'openstates_cache_';

/** Search endpoints (bills/people/committees/events) track active legislative movement — short TTL. */
const TTL_SEARCH_SECONDS = 10 * 60;
/** Jurisdiction inventory + metadata refresh on the daily scraper cadence — long TTL. */
const TTL_JURISDICTION_SECONDS = 12 * 60 * 60;
/** Geo district lookup changes only on redistricting — longest TTL. */
const TTL_GEO_SECONDS = 24 * 60 * 60;

/** Cache TTL (seconds) for a request URL, chosen by endpoint path. */
function cacheTtlForUrl(url: string): number {
  const { pathname } = new URL(url);
  if (pathname.startsWith('/people.geo')) return TTL_GEO_SECONDS;
  if (pathname.startsWith('/jurisdictions')) return TTL_JURISDICTION_SECONDS;
  return TTL_SEARCH_SECONDS;
}

/**
 * Derive a storage-safe cache key from a request URL. The raw URL carries `:?&=`, which the storage
 * key validator (`[A-Za-z0-9_.\-/]` only) rejects, so hash it to a hex digest under a valid prefix.
 * Web Crypto is a global in every supported runtime, keeping the hash cross-platform.
 */
export async function cacheKeyForUrl(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${CACHE_KEY_PREFIX}${hex}`;
}

export class OpenStatesApiService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly rateLimiter: RateLimiter;
  /** Per-attempt upstream deadline, from `OPENSTATES_REQUEST_TIMEOUT_MS`. */
  private readonly requestTimeoutMs: number;
  /** Wall-clock ceiling across every attempt of one call, from `OPENSTATES_TOTAL_REQUEST_BUDGET_MS`. */
  private readonly totalRequestBudgetMs: number;

  /**
   * @param dailyRequestBudget - Fail-fast daily request budget for the shared API key. Defaults to
   *   the configured `OPENSTATES_DAILY_REQUEST_BUDGET` value so a deployment's own setting applies
   *   without the caller restating it; the explicit parameter stays for direct construction in
   *   tests, where a small budget makes the guard cheap to exercise.
   */
  constructor(
    appConfig: AppConfig,
    _storage: StorageService,
    serverConfig: ServerConfig,
    dailyRequestBudget: number = serverConfig.dailyRequestBudget,
  ) {
    this.baseUrl = serverConfig.apiBaseUrl.replace(/\/$/, '');
    this.apiKey = serverConfig.apiKey;
    this.requestTimeoutMs = serverConfig.requestTimeoutMs;
    this.totalRequestBudgetMs = serverConfig.totalRequestBudgetMs;
    this.rateLimiter = new RateLimiter(appConfig, logger);
    this.rateLimiter.configure({
      maxRequests: dailyRequestBudget,
      windowMs: BUDGET_WINDOW_MS,
      errorMessage: BUDGET_EXCEEDED_MESSAGE,
    });
  }

  // --- Internal HTTP plumbing ---

  private buildUrl(path: string, params: Record<string, unknown> = {}): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async fetchJson<T>(url: string, ctx: Context): Promise<T> {
    const cacheKey = await cacheKeyForUrl(url);
    const cached = await ctx.state.get<T>(cacheKey);
    if (cached !== null) {
      ctx.log.debug('Cache hit', { path: new URL(url).pathname });
      return cached;
    }

    // One budget per call, armed before the first attempt. The per-attempt deadline bounds a
    // single request; nothing bounded the ladder of them, so a slow-but-retryable upstream (a
    // 502/503 that takes the full deadline to arrive) could hold the caller for every attempt plus
    // the backoff between them. Threading this signal into both `withRetry` and each attempt caps
    // the whole call: `withRetry` stops starting new attempts, and the composed per-attempt signal
    // preempts one already in flight.
    const budget = new AbortController();
    const budgetTimer = setTimeout(
      () =>
        budget.abort(
          new DOMException(
            `Open States did not answer within ${this.totalRequestBudgetMs}ms across all attempts.`,
            'AbortError',
          ),
        ),
      this.totalRequestBudgetMs,
    );

    let result: T;
    try {
      result = await withRetry(
        async () => {
          // Fail-fast daily-budget guard, inside the retry boundary so every real upstream attempt
          // counts and a rejection costs zero requests (it throws before fetch). Reached only on a
          // cache miss, so cache hits never consume the budget.
          this.checkRateBudget();

          const response = await this.fetchAttempt(url, ctx, budget.signal);
          const text = await response.text();
          // HTML from a JSON API is a block / rate-limit page, not a recoverable transient — fail
          // fast so withRetry doesn't retry the block page four times.
          if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
            throw serviceUnavailable(
              'Open States API returned HTML instead of JSON — likely rate-limited or unavailable.',
              { url: redactedUrl(url), retryable: false },
            );
          }

          return JSON.parse(text) as T;
        },
        {
          operation: 'OpenStatesApiService.fetchJson',
          baseDelayMs: 1500,
          signal: AbortSignal.any([ctx.signal, budget.signal]),
        },
      );
    } catch (err) {
      // Only a budget expiry needs classifying here; every other failure arrives already
      // classified by `fetchAttempt`. A budget expiry lands on one of two paths: mid-flight, the
      // attempt itself rejects and is classified there, which the classifier recognizes and leaves
      // alone; mid-backoff, `withRetry`'s sleep rejects with the raw abort reason and never passes
      // through that classifier at all, so it is normalized here.
      throw budget.signal.aborted ? this.classifyUpstreamFailure(err, url, ctx, 'budget') : err;
    } finally {
      clearTimeout(budgetTimer);
    }

    // Only a successful 2xx JSON response reaches here — every error path threw above, so nothing
    // but a good response is ever cached.
    await ctx.state.set(cacheKey, result, { ttl: cacheTtlForUrl(url) });
    return result;
  }

  /**
   * One upstream attempt, bounded by a deadline this service owns rather than the helper's, and by
   * the caller-wide budget armed in `fetchJson`.
   *
   * Both signals are composed with `ctx.signal` so any of the three can cancel the request, but
   * each stays separately observable — `deadline.signal.aborted` and `budgetSignal.aborted`
   * distinguish "this client ran out of patience" (and which clock ran out) from "the caller went
   * away", which the composed signal alone cannot, and which the error the helper produces does not
   * reliably encode (see `FETCH_BACKSTOP_MULTIPLIER`).
   */
  private async fetchAttempt(
    url: string,
    ctx: Context,
    budgetSignal: AbortSignal,
  ): Promise<Response> {
    const deadline = new AbortController();
    // `AbortError`, not `TimeoutError`: from the helper's side this is a caller abort — it
    // identity-matches only the reason its own timer raises — and naming it a timeout would have
    // it log the ceiling it was handed, the inert backstop, for a request that never ran that
    // long. The accurate figure rides the error raised below.
    const timer = setTimeout(
      () =>
        deadline.abort(
          new DOMException(
            `Open States did not respond within ${this.requestTimeoutMs}ms.`,
            'AbortError',
          ),
        ),
      this.requestTimeoutMs,
    );
    try {
      return await fetchWithTimeout(
        url,
        this.requestTimeoutMs * FETCH_BACKSTOP_MULTIPLIER,
        fetchLogContext(ctx),
        {
          headers: {
            'X-API-KEY': this.apiKey,
            Accept: 'application/json',
          },
          signal: AbortSignal.any([deadline.signal, budgetSignal, ctx.signal]),
          expectedStatuses: EXPECTED_UPSTREAM_STATUSES,
        },
      );
    } catch (err) {
      // Deadline first: when both have fired, the per-attempt ceiling is the tighter, more
      // specific fact about this request.
      const expiry = deadline.signal.aborted
        ? 'deadline'
        : budgetSignal.aborted
          ? 'budget'
          : undefined;
      throw this.classifyUpstreamFailure(err, url, ctx, expiry);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Re-stamps the upstream failures this service treats as deterministic so `withRetry` fails fast
   * instead of spending attempts — and shared-key budget — on requests that cannot succeed.
   *
   * - **Timeout.** One of this client's own clocks expiring (`expiry` — the arm that fires in
   *   practice, since upstream takes ~60s to answer `504` and the per-attempt deadline lands
   *   first) or an upstream status that maps to `Timeout` (`504`, `408`, `425`). Retrying any of
   *   them just pays the same wait again: whatever made the request exceed the ceiling — an
   *   over-broad query, a slow gateway — still holds on the next attempt, and the shared-key
   *   budget is spent for nothing. Both clocks carry the one `upstream_timeout` reason: the caller
   *   experiences them identically (the server gave up waiting) and acts on the same narrowing
   *   hint, so they differ only in the message's stated ceiling. Keying on an owned signal first
   *   rather than on the code keeps this correct however the helper classifies an abort.
   * - **RateLimited.** The shared key's cap: deterministic until the window rolls, so retrying
   *   only burns the remaining budget against a capped endpoint.
   * - **Rejected request.** Open States names the violated constraint in a `detail` field
   *   (`invalid page, must be in [1, 1]`); the classification is already right, so only the
   *   message is rewritten to carry it. The status keeps its own code, which is what lets a tool
   *   map a `NotFound` to its own declared reason.
   *
   * Everything else passes through with its default classification, so a genuinely transient
   * `502`/`503` still gets its retries.
   */
  private classifyUpstreamFailure(
    err: unknown,
    url: string,
    ctx: Context,
    expiry: TimeoutSource | undefined,
  ): unknown {
    const mcpError = err instanceof McpError ? err : undefined;

    // Already normalized by an inner call — a mid-flight expiry classified in `fetchAttempt` and
    // rethrown unchanged by `withRetry`. Re-wrapping would restate the wrong ceiling.
    if (mcpError?.data?.['reason'] === 'upstream_timeout') return mcpError;

    const rawStatus = mcpError?.data?.['status'];
    const status = typeof rawStatus === 'number' ? rawStatus : undefined;

    if (expiry !== undefined || mcpError?.code === JsonRpcErrorCode.Timeout) {
      const cause =
        expiry === 'budget'
          ? `did not answer within ${this.totalRequestBudgetMs / 1000}s across all attempts`
          : status === undefined
            ? `did not respond within ${this.requestTimeoutMs / 1000}s`
            : `returned HTTP ${status}`;
      return timeout(
        // States only what was observed. Query breadth is the usual cause but not a fact this
        // client can establish — upstream is also slow for well-scoped queries at times — so the
        // narrowing advice belongs in the recovery hint, not in an assertion about the query.
        `Open States ${cause}.`,
        {
          url: redactedUrl(url),
          ...(status === undefined ? {} : { status }),
          reason: 'upstream_timeout',
          retryable: false,
          ...ctx.recoveryFor('upstream_timeout'),
        },
        { cause: err },
      );
    }

    if (mcpError?.code === JsonRpcErrorCode.RateLimited) {
      return rateLimited(
        mcpError.message,
        { ...mcpError.data, url: redactedUrl(url), retryable: false },
        { cause: mcpError },
      );
    }

    // The default message is the transport's ("Fetch failed for <url>. Status: 404"), which reads
    // like the endpoint is missing. Swap in what Open States actually said. Scoped to 4xx: a 5xx
    // body is a gateway page with nothing to name, and rewriting it would only hide the status.
    if (mcpError && status !== undefined && status >= 400 && status < 500) {
      const detail = upstreamDetail(mcpError.data?.['body']);
      if (detail !== undefined) {
        // Some details are already sentences ("...for your API key."), others are bare clauses.
        const sentence = /[.!?]$/.test(detail) ? detail : `${detail}.`;
        return new McpError(
          mcpError.code,
          `Open States rejected the request: ${sentence}`,
          { ...mcpError.data, url: redactedUrl(url) },
          { cause: mcpError },
        );
      }
    }

    return err;
  }

  /**
   * Fail-fast budget guard over the shared-key `RateLimiter`. Re-stamps the limiter's `RateLimited`
   * rejection with `retryable: false`: `withRetry` classifies `RateLimited` as transient by
   * default, so without the flag it would retry the guard's own rejection four times and defeat it.
   */
  private checkRateBudget(): void {
    try {
      this.rateLimiter.check(RATE_LIMIT_KEY);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.RateLimited) {
        throw rateLimited(err.message, { ...err.data, retryable: false }, { cause: err });
      }
      throw err;
    }
  }

  // --- Bills ---

  searchBills(params: BillSearchParams, ctx: Context): Promise<BillListResponse> {
    const queryParams: Record<string, unknown> = {
      jurisdiction: params.jurisdiction,
      q: params.q,
      session: params.session,
      chamber: params.chamber,
      classification: params.classification,
      subject: params.subject,
      sponsor: params.sponsor,
      sponsor_classification: params.sponsor_classification,
      sort: params.sort,
      action_since: params.action_since,
      updated_since: params.updated_since,
      created_since: params.created_since,
      include: params.include,
      page: params.page ?? 1,
      per_page: params.per_page ?? 10,
    };
    const url = this.buildUrl('/bills', queryParams);
    ctx.log.debug('Searching bills', {
      jurisdiction: params.jurisdiction,
      q: params.q,
      session: params.session,
      page: params.page ?? 1,
    });
    return this.fetchJson<BillListResponse>(url, ctx);
  }

  getBillByPath(
    jurisdiction: string,
    session: string,
    billId: string,
    include: string[] | undefined,
    ctx: Context,
  ): Promise<Bill> {
    const encodedJur = encodeURIComponent(jurisdiction);
    const encodedSession = encodeURIComponent(session);
    const encodedBillId = encodeURIComponent(billId);
    const url = this.buildUrl(`/bills/${encodedJur}/${encodedSession}/${encodedBillId}`, {
      include,
    });
    ctx.log.debug('Fetching bill by path', { jurisdiction, session, billId });
    return this.fetchJson<Bill>(url, ctx);
  }

  getBillById(openstatesId: string, include: string[] | undefined, ctx: Context): Promise<Bill> {
    // The API accepts the full OCD bill ID (e.g. "ocd-bill/...") in the path, unmodified.
    const url = this.buildUrl(`/bills/${openstatesId}`, { include });
    ctx.log.debug('Fetching bill by OCD ID', { openstatesId });
    return this.fetchJson<Bill>(url, ctx);
  }

  // --- People ---

  /**
   * `org_classification=legislature` is in the upstream enum and is accepted input, but it
   * is never any *person's* current role — only `upper`/`lower` (chambers) and `executive`
   * (individual officials) are — so upstream matches nobody and returns an empty set. The
   * legislature is the union of the two chambers, resolved here; every other classification
   * passes through as a single upstream query.
   */
  searchPeople(params: PeopleSearchParams, ctx: Context): Promise<PersonListResponse> {
    return params.org_classification === 'legislature'
      ? this.searchLegislature(params, ctx)
      : this.fetchPeoplePage(params, ctx);
  }

  /** One upstream `/people` page, normalized. */
  private async fetchPeoplePage(
    params: PeopleSearchParams,
    ctx: Context,
  ): Promise<PersonListResponse> {
    const queryParams: Record<string, unknown> = {
      jurisdiction: params.jurisdiction,
      name: params.name,
      org_classification: params.org_classification,
      district: params.district,
      include: params.include,
      page: params.page ?? 1,
      per_page: params.per_page ?? 10,
    };
    const url = this.buildUrl('/people', queryParams);
    ctx.log.debug('Searching people', {
      jurisdiction: params.jurisdiction,
      org_classification: params.org_classification,
      page: params.page ?? 1,
    });
    const raw = await this.fetchJson<{
      results: RawPerson[];
      pagination: PersonListResponse['pagination'];
    }>(url, ctx);
    return {
      results: raw.results.map(normalizePerson),
      pagination: raw.pagination,
    };
  }

  /**
   * Records `[start, start + count)` of one chamber, mapped onto the upstream's page-based
   * pagination. `head` is that chamber's page 1 at the same `per_page`, reused whenever the
   * range reaches into it.
   *
   * Upstream 404s (`invalid page, must be in [1, N]`) for any page above a chamber's
   * `max_page`, so the range is clamped to `head`'s `total_items` before any page number is
   * derived — every request this issues is inside the legal range by construction.
   */
  private async fetchChamberRange(
    params: PeopleSearchParams,
    chamber: Chamber,
    head: PersonListResponse,
    start: number,
    count: number,
    ctx: Context,
  ): Promise<Person[]> {
    const { per_page: perPage, total_items: total } = head.pagination;
    const end = Math.min(start + count, total);
    if (end <= start) return [];

    const firstPage = Math.floor(start / perPage) + 1;
    const lastPage = Math.floor((end - 1) / perPage) + 1;
    const requests: Promise<PersonListResponse>[] = [];
    for (let page = firstPage; page <= lastPage; page++) {
      requests.push(
        page === 1
          ? Promise.resolve(head)
          : this.fetchPeoplePage(
              { ...params, org_classification: chamber, page, per_page: perPage },
              ctx,
            ),
      );
    }
    const fetched = (await Promise.all(requests)).flatMap((res) => res.results);
    const firstIndex = (firstPage - 1) * perPage;
    return fetched.slice(start - firstIndex, end - firstIndex);
  }

  /**
   * The `legislature` union: every `upper` member followed by every `lower` member, sliced to
   * the caller's page.
   *
   * Page 1 of each chamber is the only request that is legal before the chamber's size is
   * known, and it doubles as the head of the union — so both are fetched up front, and their
   * `total_items` bound every page request that follows. The caller's window is then sliced
   * out of the *merged* set: once it runs past `upper`, it reads into `lower` at the offset
   * the merge has actually reached. Threading the caller's offset into each chamber query
   * instead would skip that many records in both and silently drop legislators.
   *
   * Costs two upstream calls for the common first page, at most four for a deep one — never a
   * full drain of either chamber.
   */
  private async searchLegislature(
    params: PeopleSearchParams,
    ctx: Context,
  ): Promise<PersonListResponse> {
    const perPage = params.per_page ?? 10;
    const page = params.page ?? 1;
    const offset = (page - 1) * perPage;

    const [upperHead, lowerHead] = await Promise.all([
      this.fetchPeoplePage(
        { ...params, org_classification: 'upper', page: 1, per_page: perPage },
        ctx,
      ),
      this.fetchPeoplePage(
        { ...params, org_classification: 'lower', page: 1, per_page: perPage },
        ctx,
      ),
    ]);
    const upperTotal = upperHead.pagination.total_items;
    const lowerTotal = lowerHead.pagination.total_items;

    const upperSlice = await this.fetchChamberRange(
      params,
      'upper',
      upperHead,
      offset,
      perPage,
      ctx,
    );
    const lowerSlice = await this.fetchChamberRange(
      params,
      'lower',
      lowerHead,
      Math.max(0, offset - upperTotal),
      perPage - upperSlice.length,
      ctx,
    );

    const totalItems = upperTotal + lowerTotal;
    ctx.log.debug('Merged legislature union', {
      jurisdiction: params.jurisdiction,
      upperTotal,
      lowerTotal,
      returned: upperSlice.length + lowerSlice.length,
    });

    return {
      results: [...upperSlice, ...lowerSlice],
      pagination: {
        page,
        per_page: perPage,
        max_page: Math.max(1, Math.ceil(totalItems / perPage)),
        total_items: totalItems,
      },
    };
  }

  async getPeopleByGeo(
    lat: number,
    lng: number,
    include: string[] | undefined,
    ctx: Context,
  ): Promise<PersonListResponse> {
    const url = this.buildUrl('/people.geo', { lat, lng, include });
    ctx.log.debug('Fetching legislators by geo', { lat, lng });
    const raw = await this.fetchJson<{ results: RawPerson[] }>(url, ctx);
    // geo endpoint doesn't return pagination — synthesize one
    const results = raw.results.map(normalizePerson);
    return {
      results,
      pagination: { page: 1, per_page: results.length, max_page: 1, total_items: results.length },
    };
  }

  // --- Committees ---

  async searchCommittees(
    params: CommitteeSearchParams,
    ctx: Context,
  ): Promise<CommitteeListResponse> {
    const queryParams: Record<string, unknown> = {
      jurisdiction: params.jurisdiction
        ? normalizeCommitteeJurisdiction(params.jurisdiction)
        : undefined,
      classification: params.classification,
      chamber: params.chamber,
      parent: params.parent,
      include: params.include,
      page: params.page ?? 1,
      per_page: params.per_page ?? 10,
    };
    const url = this.buildUrl('/committees', queryParams);
    ctx.log.debug('Searching committees', { jurisdiction: params.jurisdiction });
    const raw = await this.fetchJson<{
      results: Record<string, unknown>[];
      pagination: CommitteeListResponse['pagination'];
    }>(url, ctx);
    return {
      pagination: raw.pagination,
      results: raw.results.map((c) => {
        const memberships = Array.isArray(c['memberships'])
          ? (c['memberships'] as Record<string, unknown>[]).map(normalizeMembership)
          : undefined;
        return { ...c, memberships } as CommitteeListResponse['results'][number];
      }),
    };
  }

  async getCommittee(
    committeeId: string,
    include: string[] | undefined,
    ctx: Context,
  ): Promise<Committee> {
    const url = this.buildUrl(`/committees/${encodeURIComponent(committeeId)}`, { include });
    ctx.log.debug('Fetching committee', { committeeId });
    const raw = await this.fetchJson<Record<string, unknown>>(url, ctx);
    const memberships = Array.isArray(raw['memberships'])
      ? (raw['memberships'] as Record<string, unknown>[]).map(normalizeMembership)
      : undefined;
    return { ...raw, memberships } as Committee;
  }

  // --- Events ---

  searchEvents(params: EventSearchParams, ctx: Context): Promise<EventListResponse> {
    const queryParams: Record<string, unknown> = {
      jurisdiction: params.jurisdiction,
      after: params.after,
      before: params.before,
      require_bills: params.require_bills ? 'true' : undefined,
      include: params.include,
      page: params.page ?? 1,
      per_page: params.per_page ?? 10,
    };
    const url = this.buildUrl('/events', queryParams);
    ctx.log.debug('Searching events', { jurisdiction: params.jurisdiction });
    return this.fetchJson<EventListResponse>(url, ctx);
  }

  getEvent(eventId: string, include: string[] | undefined, ctx: Context): Promise<Event> {
    const url = this.buildUrl(`/events/${encodeURIComponent(eventId)}`, { include });
    ctx.log.debug('Fetching event', { eventId });
    return this.fetchJson<Event>(url, ctx);
  }

  // --- Jurisdictions ---

  /** One upstream `/jurisdictions` page, as-is. */
  private fetchJurisdictionsPage(
    params: JurisdictionListParams,
    page: number,
    perPage: number,
    ctx: Context,
  ): Promise<JurisdictionListResponse> {
    const url = this.buildUrl('/jurisdictions', {
      classification: params.classification ?? 'state',
      include: params.include,
      page,
      per_page: perPage,
    });
    ctx.log.debug('Listing jurisdictions', {
      classification: params.classification ?? 'state',
      page,
      per_page: perPage,
    });
    return this.fetchJson<JurisdictionListResponse>(url, ctx);
  }

  /**
   * The `classification=state` inventory (50 states + DC + 5 US territories = 56) has outgrown
   * the upstream `per_page` ceiling of 52 (HTTP 400 above it), so the advertised one-call
   * inventory no longer fits a single page. For the default full-inventory request — page 1,
   * whose complete set spans at most `MAX_JURISDICTION_MERGE_PAGES` pages — the remaining pages
   * are fetched and merged into one synthesized response, the same reassembly `searchLegislature`
   * does for the chamber union. Explicit deep paging (`page > 1`) and collections too large to
   * complete within the bound (e.g. municipalities) fall through to plain single-page pagination.
   */
  async listJurisdictions(
    params: JurisdictionListParams,
    ctx: Context,
  ): Promise<JurisdictionListResponse> {
    const perPage = params.per_page ?? 52;
    const page = params.page ?? 1;
    const head = await this.fetchJurisdictionsPage(params, page, perPage, ctx);

    const { total_items: total, max_page: maxPage } = head.pagination;
    if (page !== 1 || maxPage <= 1 || maxPage > MAX_JURISDICTION_MERGE_PAGES) {
      return head;
    }

    const rest = await Promise.all(
      Array.from({ length: maxPage - 1 }, (_, i) =>
        this.fetchJurisdictionsPage(params, i + 2, perPage, ctx),
      ),
    );
    const results = [head, ...rest].flatMap((r) => r.results);
    ctx.log.debug('Merged jurisdiction inventory', {
      classification: params.classification ?? 'state',
      pages: maxPage,
      total,
      returned: results.length,
    });
    return {
      results,
      pagination: { page: 1, per_page: results.length, max_page: 1, total_items: total },
    };
  }

  getJurisdiction(
    jurisdictionId: string,
    include: string[] | undefined,
    ctx: Context,
  ): Promise<Jurisdiction> {
    const url = this.buildUrl(`/jurisdictions/${encodeURIComponent(jurisdictionId)}`, { include });
    ctx.log.debug('Fetching jurisdiction', { jurisdictionId });
    return this.fetchJson<Jurisdiction>(url, ctx);
  }
}

// --- Init/accessor pattern ---

let _service: OpenStatesApiService | undefined;

export function initOpenStatesApiService(
  appConfig: AppConfig,
  storage: StorageService,
  serverConfig: ServerConfig,
): void {
  _service = new OpenStatesApiService(appConfig, storage, serverConfig);
}

export function getOpenStatesApiService(): OpenStatesApiService {
  if (!_service) {
    throw new Error(
      'OpenStatesApiService not initialized — call initOpenStatesApiService() in setup()',
    );
  }
  return _service;
}
