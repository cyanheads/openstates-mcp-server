/**
 * @fileoverview Open States API v3 REST client — auth, pagination, retry, response normalization.
 * @module services/openstates/openstates-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { ServerConfig } from '@/config/server-config.js';
import type {
  Bill,
  BillListResponse,
  BillSearchParams,
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
  return person;
}

export class OpenStatesApiService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(_appConfig: AppConfig, _storage: StorageService, serverConfig: ServerConfig) {
    this.baseUrl = serverConfig.apiBaseUrl.replace(/\/$/, '');
    this.apiKey = serverConfig.apiKey;
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
    return withRetry(
      async () => {
        const response = await fetch(url, {
          headers: {
            'X-API-KEY': this.apiKey,
            Accept: 'application/json',
          },
          signal: ctx.signal,
        });

        if (!response.ok) {
          throw await httpErrorFromResponse(response, {
            service: 'OpenStates',
            data: { url },
          });
        }

        const text = await response.text();
        // HTML error page detection
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          const { serviceUnavailable } = await import('@cyanheads/mcp-ts-core/errors');
          throw serviceUnavailable(
            'Open States API returned HTML instead of JSON — likely rate-limited or unavailable.',
            { url },
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
  }

  // --- Bills ---

  async searchBills(params: BillSearchParams, ctx: Context): Promise<BillListResponse> {
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
      include: params.include,
      page: params.page ?? 1,
      per_page: params.per_page ?? 10,
    };
    const url = this.buildUrl('/bills', queryParams);
    ctx.log.debug('Searching bills', { url: url.replace(this.apiKey, '[redacted]') });
    return this.fetchJson<BillListResponse>(url, ctx);
  }

  async getBillByPath(
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

  async getBillById(
    openstatesId: string,
    include: string[] | undefined,
    ctx: Context,
  ): Promise<Bill> {
    // OCD bill IDs are like "ocd-bill/..." — strip the prefix for URL routing
    // The API accepts the full OCD ID in the path
    const url = this.buildUrl(`/bills/${openstatesId}`, { include });
    ctx.log.debug('Fetching bill by OCD ID', { openstatesId });
    return this.fetchJson<Bill>(url, ctx);
  }

  // --- People ---

  async searchPeople(params: PeopleSearchParams, ctx: Context): Promise<PersonListResponse> {
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
    ctx.log.debug('Searching people', { jurisdiction: params.jurisdiction });
    const raw = await this.fetchJson<{
      results: RawPerson[];
      pagination: PersonListResponse['pagination'];
    }>(url, ctx);
    return {
      results: raw.results.map(normalizePerson),
      pagination: raw.pagination,
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
      jurisdiction: params.jurisdiction,
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

  async searchEvents(params: EventSearchParams, ctx: Context): Promise<EventListResponse> {
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

  async getEvent(eventId: string, include: string[] | undefined, ctx: Context): Promise<Event> {
    const url = this.buildUrl(`/events/${encodeURIComponent(eventId)}`, { include });
    ctx.log.debug('Fetching event', { eventId });
    return this.fetchJson<Event>(url, ctx);
  }

  // --- Jurisdictions ---

  async listJurisdictions(
    params: JurisdictionListParams,
    ctx: Context,
  ): Promise<JurisdictionListResponse> {
    const queryParams: Record<string, unknown> = {
      classification: params.classification ?? 'state',
      include: params.include,
      page: params.page ?? 1,
      per_page: params.per_page ?? 52,
    };
    const url = this.buildUrl('/jurisdictions', queryParams);
    ctx.log.debug('Listing jurisdictions', { classification: params.classification });
    return this.fetchJson<JurisdictionListResponse>(url, ctx);
  }

  async getJurisdiction(
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
