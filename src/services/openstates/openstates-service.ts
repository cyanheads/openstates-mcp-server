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
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import {
  httpErrorFromResponse,
  logger,
  RateLimiter,
  withRetry,
} from '@cyanheads/mcp-ts-core/utils';
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

/**
 * Fail-fast daily request budget for the shared Open States API key. The v3 free tier caps at
 * ~10 req/min and 250 req/day; on the hosted deployment every caller shares one key, so the daily
 * cap is the binding constraint. The guard rejects before `fetch()` once the budget is spent —
 * costing zero upstream requests — rather than waiting on a slow-refilling daily window.
 * Overridable per instance (tests, a paid tier); defaults to the documented free-tier cap.
 */
const FREE_TIER_DAILY_BUDGET = 250;

/** Rolling window the daily budget is measured over. */
const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One shared-key budget bucket — the hosted deployment rations a single upstream key across all callers. */
const RATE_LIMIT_KEY = 'openstates:shared-key';

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

  constructor(
    appConfig: AppConfig,
    _storage: StorageService,
    serverConfig: ServerConfig,
    dailyRequestBudget: number = FREE_TIER_DAILY_BUDGET,
  ) {
    this.baseUrl = serverConfig.apiBaseUrl.replace(/\/$/, '');
    this.apiKey = serverConfig.apiKey;
    this.rateLimiter = new RateLimiter(appConfig, logger);
    this.rateLimiter.configure({ maxRequests: dailyRequestBudget, windowMs: BUDGET_WINDOW_MS });
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

    const result = await withRetry(
      async () => {
        // Fail-fast daily-budget guard, inside the retry boundary so every real upstream attempt
        // counts and a rejection costs zero requests (it throws before fetch). Reached only on a
        // cache miss, so cache hits never consume the budget.
        this.checkRateBudget();

        const response = await fetch(url, {
          headers: {
            'X-API-KEY': this.apiKey,
            Accept: 'application/json',
          },
          signal: ctx.signal,
        });

        if (!response.ok) {
          // A 429 is the shared key's rate cap — deterministic, not a transient blip — so mark it
          // non-retryable and let withRetry fail fast instead of burning the rest of the budget on
          // a capped endpoint. Every other status keeps its default classification (5xx transient).
          throw await httpErrorFromResponse(response, {
            service: 'OpenStates',
            data: { url, ...(response.status === 429 ? { retryable: false } : {}) },
          });
        }

        const text = await response.text();
        // HTML from a JSON API is a block / rate-limit page, not a recoverable transient — fail
        // fast so withRetry doesn't retry the block page four times.
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable(
            'Open States API returned HTML instead of JSON — likely rate-limited or unavailable.',
            { url, retryable: false },
          );
        }

        return JSON.parse(text) as T;
      },
      {
        operation: 'OpenStatesApiService.fetchJson',
        baseDelayMs: 1500,
        signal: ctx.signal,
      },
    );

    // Only a successful 2xx JSON response reaches here — every error path threw above, so nothing
    // but a good response is ever cached.
    await ctx.state.set(cacheKey, result, { ttl: cacheTtlForUrl(url) });
    return result;
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
    ctx.log.debug('Searching bills', { url: url.replace(this.apiKey, '[redacted]') });
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
