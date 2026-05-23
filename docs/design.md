# openstates-mcp-server — Design

## MCP Surface

All tools are read-only, idempotent, and query an external API.
Annotations on every tool: `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: true`.

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `openstates_search_bills` | Search bills by full-text query or jurisdiction/session/filter combination. | `jurisdiction`, `q`, `session`, `chamber`, `subject`, `sponsor`, `sort`, `include` | readOnly, idempotent, openWorld |
| `openstates_get_bill` | Fetch full bill detail including actions, sponsorships, votes, documents, and versions. | `jurisdiction`, `session`, `bill_id` (or `openstates_id`) | readOnly, idempotent, openWorld |
| `openstates_search_people` | Search legislators by name, jurisdiction, chamber, district, or party. | `jurisdiction`, `name`, `org_classification`, `district`, `include` | readOnly, idempotent, openWorld |
| `openstates_get_legislators_by_location` | Find legislators representing a given lat/lng coordinate. | `lat`, `lng`, `include` | readOnly, idempotent, openWorld |
| `openstates_search_committees` | List committees for a jurisdiction, optionally filtered by chamber or parent. **Experimental — not all states have committee data.** | `jurisdiction`, `classification`, `chamber`, `include` | readOnly, idempotent, openWorld |
| `openstates_get_committee` | Fetch committee detail including membership roster. **Experimental — not all states have committee data.** | `committee_id` | readOnly, idempotent, openWorld |
| `openstates_search_events` | Search hearings, floor sessions, and committee meetings in a jurisdiction. **Experimental — most states lack event data.** | `jurisdiction`, `after`, `before`, `require_bills`, `include` | readOnly, idempotent, openWorld |
| `openstates_get_event` | Fetch event detail including agenda, participants, and associated bills. **Experimental — most states lack event data.** | `event_id` | readOnly, idempotent, openWorld |
| `openstates_list_jurisdictions` | List all covered jurisdictions with session metadata and coverage dates. | `classification`, `include` | readOnly, idempotent, openWorld |
| `openstates_get_jurisdiction` | Fetch full jurisdiction detail including all legislative sessions and their identifiers. | `jurisdiction_id` | readOnly, idempotent, openWorld |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `openstates://jurisdiction/{jurisdiction_id}` | Jurisdiction metadata including current sessions, coverage dates, and bill/people update timestamps. Useful as stable reference context before querying bills or people. | No |

### Prompts

| Name | Description | Args |
|:-----|:------------|:-----|
| `openstates_bill_research` | Structured framework for analyzing a state bill: summary, sponsors, committee referrals, action timeline, vote record, and related legislation. | `jurisdiction`, `session`, `bill_id` |
| `openstates_legislator_profile` | Research framework for profiling a legislator: sponsored bills, committee assignments, voting record, and contact details. | `name`, `jurisdiction` |

---

## Overview

An MCP server wrapping the [Open States API v3](https://v3.openstates.org/) — a comprehensive source for US state legislative data maintained by Open States (formerly Sunlight Labs). Covers all 50 states, DC, and Puerto Rico: bills, legislators, committees, events, and jurisdictions.

**Target users:** Agents performing state-level policy research, civic technology, constituent-to-legislator matching, legislative tracking, journalism, and advocacy.

**State-level complement to `congressgov-mcp-server`:** This server covers state legislatures; congressgov covers the US Congress. Tool naming follows the same `{server}_{verb}_{noun}` pattern. Both are read-only, browse-and-filter APIs with no destructive surface.

**Key API characteristics:**
- API key required via `X-API-KEY` header (free registration at open.pluralpolicy.com)
- Full-text search (`q`) available on bills — this distinguishes it from the Congress.gov API
- Bills search requires either a `jurisdiction` or a full-text `q` parameter
- Data sourced from legislative scrapers — may lag official source by hours/days
- Committees and events support is described as "experimental" in docs; not all states have coverage
- Pagination: page/per_page (1-indexed), API default per_page=10, max per_page=20; response includes `max_page` and `total_items`
- Jurisdiction IDs follow the OCD-ID format: `ocd-jurisdiction/country:us/state:wa/government`
- Session identifiers vary by state: `2025`, `2025-2026`, `2025rs`, `2025s1`, etc.

---

## Requirements

- Read-only access to all Open States endpoints
- API key authentication via `X-API-KEY` header (free, rate limits undocumented but enforced)
- Page/per_page pagination (1-indexed; responses return `max_page` and `total_items`)
- `include` parameter support to request related data inline (avoid N+1 patterns)
- Geo-to-legislator lookup (`/people.geo`) — high-value constituent feature
- Jurisdiction and session ID handling — guide agents toward valid identifiers via `openstates_list_jurisdictions` / `openstates_get_jurisdiction`
- Graceful handling of experimental committee/event coverage — note in descriptions that not all states have data
- Committees and events: flag in tool descriptions that state coverage is partial

---

## Domain Mapping

| Noun | Operations Available | API Endpoint |
|:-----|:--------------------|:-------------|
| Bill | search (full-text + filters), get-by-path, get-by-ocd-id | `GET /bills`, `GET /bills/{jur}/{session}/{id}`, `GET /bills/ocd-bill/{id}` |
| Person | search (name/jurisdiction/chamber/district), geo-lookup | `GET /people`, `GET /people.geo` |
| Committee | list/search, get-by-id | `GET /committees`, `GET /committees/{id}` |
| Event | list/search (jurisdiction + date range), get-by-id | `GET /events`, `GET /events/{id}` |
| Jurisdiction | list, get-by-id | `GET /jurisdictions`, `GET /jurisdictions/{id}` |

---

## User Goals → Tool Mapping

| User Goal | Primary Tools |
|:----------|:-------------|
| "What bills are moving in WA this session?" | `openstates_search_bills` (jurisdiction + action_since + sort=latest_action_desc) |
| "Find all housing bills in California" | `openstates_search_bills` (jurisdiction + q="housing" OR subject) |
| "Who represents my address?" | `openstates_get_legislators_by_location` (lat/lng → legislators) |
| "How did my legislator vote on HB 1000?" | `openstates_get_bill` (with include=votes) → scan PersonVote |
| "What committees is Senator Smith on?" | `openstates_search_people` (name + jurisdiction) → `openstates_search_committees` |
| "What's on the committee agenda this week?" | `openstates_search_events` (jurisdiction + after=today + require_bills=true) |
| "Track bills mentioning 'climate' in WA" | `openstates_search_bills` (jurisdiction=wa + q="climate") |
| "What sessions does Oregon have?" | `openstates_get_jurisdiction` (ocd-id for Oregon) → legislative_sessions |
| "Who are the senators in Texas?" | `openstates_search_people` (jurisdiction=tx + org_classification=upper) |
| "What committees exist in the WA House?" | `openstates_search_committees` (jurisdiction=wa + chamber=lower) |

---

## Tool Designs

### 1. `openstates_search_bills`

The primary entry point. Supports both full-text and structured filtering.

**Description:** Search state legislative bills across all covered US jurisdictions. Supports full-text search, jurisdiction/session filtering, subject tags, sponsor lookups, and sort order. Either `jurisdiction` or `q` (full-text) is required — combining both is common and recommended for precision. Include `actions`, `sponsorships`, or `votes` via the `include` parameter to avoid follow-up calls for the most common enrichments.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `jurisdiction` | `string` optional | State name or OCD-ID (e.g., `"Washington"`, `"wa"`, or `"ocd-jurisdiction/country:us/state:wa/government"`). Required unless `q` is provided. |
| `q` | `string` optional | Full-text search across bill titles, abstracts, and text. Required unless `jurisdiction` is provided. |
| `session` | `string` optional | Session identifier (e.g., `"2025"`, `"2025-2026"`). Use `openstates_get_jurisdiction` to discover valid session identifiers for a state. Omit for all sessions. |
| `chamber` | `z.enum(['upper', 'lower'])` optional | Filter by originating chamber. |
| `classification` | `string` optional | Bill classification: `"bill"`, `"resolution"`, `"constitutional amendment"`, etc. |
| `subject` | `array(string)` optional | Filter to bills tagged with one or more subject categories. |
| `sponsor` | `string` optional | Filter by sponsor name or OCD person ID. |
| `sponsor_classification` | `string` optional | Filter sponsor type: `"primary"`, `"cosponsor"`. |
| `sort` | `z.enum(['updated_asc', 'updated_desc', 'first_action_asc', 'first_action_desc', 'latest_action_asc', 'latest_action_desc'])` default `updated_desc` | Sort order. Use `latest_action_desc` for "what's moving now." |
| `action_since` | `string` optional | ISO 8601 date — only bills with an action after this date. |
| `updated_since` | `string` optional | ISO 8601 date — only bills updated after this date. |
| `include` | `array(z.enum(['sponsorships', 'abstracts', 'other_titles', 'other_identifiers', 'actions', 'sources', 'documents', 'versions', 'votes', 'related_bills']))` optional | Related data to inline. `sponsorships` and `actions` cover most research needs without a separate `openstates_get_bill` call. |
| `page` | `number` default 1 | Page number (1-indexed). |
| `per_page` | `number` default 10 max 20 | Results per page. API default is 10; set to 20 for maximum per-request coverage. |

**Output:**
```ts
{
  results: Array<{
    id: string;            // OCD bill ID for openstates_get_bill follow-up
    identifier: string;    // e.g., "HB 1000"
    title: string;
    session: string;
    jurisdiction: { id, name };
    from_organization: { name, classification };  // chamber
    classification: string[];
    subject: string[];
    first_action_date: string | null;
    latest_action_date: string | null;
    latest_action_description: string | null;
    latest_passage_date: string | null;
    // When requested via include:
    sponsorships?: BillSponsorship[];
    actions?: BillAction[];
    votes?: CompactVoteEvent[];
    abstracts?: BillAbstract[];
    versions?: BillDocumentOrVersion[];
    documents?: BillDocumentOrVersion[];
    related_bills?: RelatedBill[];
  }>;
  pagination: {
    page: number;
    per_page: number;
    max_page: number;
    total_items: number;
  };
}
```

**Errors:**
```ts
errors: [
  { reason: 'missing_scope', code: InvalidParams,
    when: 'Neither jurisdiction nor q provided',
    recovery: 'Provide a jurisdiction (state name or OCD-ID) or a full-text search term q, or both.' },
  { reason: 'invalid_session', code: InvalidParams,
    when: 'Session identifier not recognized by the API',
    recovery: 'Use openstates_get_jurisdiction to list valid session identifiers for this jurisdiction.' },
]
// Empty results are NOT an error — return results: [] with pagination so the agent can paginate or
// adjust filters. Only throw for invalid inputs or upstream failures.
```

---

### 2. `openstates_get_bill`

**Description:** Fetch full detail for a specific state bill. Accepts either the three-part path (`jurisdiction` + `session` + `bill_id`) or a direct OCD bill ID. Use `include` to request votes, actions, sponsorships, documents, and versions in one call rather than searching again.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `jurisdiction` | `string` optional | State name or OCD-ID. Required when using path-based lookup (with `session` + `bill_id`). |
| `session` | `string` optional | Session identifier. Required with `jurisdiction` + `bill_id`. |
| `bill_id` | `string` optional | Bill identifier as used in the legislature (e.g., `"HB 1000"`, `"SB 42"`). Required with `jurisdiction` + `session`. |
| `openstates_id` | `string` optional | OCD bill ID (e.g., from `openstates_search_bills` results). Alternative to the three-part path. Provide either `openstates_id` OR the (`jurisdiction` + `session` + `bill_id`) triple. |
| `include` | `array(enum)` optional | Same options as search: `sponsorships`, `actions`, `votes`, `abstracts`, `other_titles`, `other_identifiers`, `documents`, `versions`, `related_bills`. Default behavior returns core bill fields only. |

**Output:**
```ts
{
  id: string;
  identifier: string;
  title: string;
  session: string;
  jurisdiction: { id, name };
  from_organization: { name, classification };
  classification: string[];
  subject: string[];
  first_action_date: string | null;
  latest_action_date: string | null;
  latest_action_description: string | null;
  latest_passage_date: string | null;
  openstates_url: string;
  // When included:
  sponsorships?: Array<{
    id: string; name: string; entity_type: string;
    primary: boolean; classification: string;
    person?: CompactPerson;
  }>;
  actions?: Array<{
    id: string; description: string; date: string;
    classification: string[]; order: number;
    organization: { name, classification };
  }>;
  votes?: Array<{
    id: string; motion_text: string; start_date: string;
    result: string; identifier: string;
    counts: Array<{ option: string; value: number }>;
    votes: Array<{ id: string; option: string; voter_name: string; voter?: CompactPerson }>;
  }>;
  abstracts?: Array<{ abstract: string; note: string }>;
  versions?: Array<{ id: string; note: string; date: string; links: Array<{ url, media_type }> }>;
  documents?: Array<{ id: string; note: string; date: string; links: Array<{ url, media_type }> }>;
  related_bills?: Array<{ identifier: string; legislative_session: string; relation_type: string }>;
}
```

**Errors:**
```ts
errors: [
  { reason: 'missing_lookup_params', code: InvalidParams,
    when: 'Neither openstates_id nor the jurisdiction+session+bill_id triple is complete',
    recovery: 'Provide either openstates_id (from search results) or all three of: jurisdiction, session, and bill_id.' },
  { reason: 'not_found', code: NotFound,
    when: 'Bill does not exist at the given path',
    recovery: 'Verify the session identifier with openstates_get_jurisdiction and confirm the bill_id format matches the legislature\'s convention (e.g., "HB 1000" not "HB1000").' },
]
```

---

### 3. `openstates_search_people`

**Description:** Search state legislators and officials by name, jurisdiction, chamber, district, or party. Supports name substring matching. Use `org_classification` to target a specific chamber. Returns compact person records; use `include=offices` to get contact information, `include=links` for social/website links.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `jurisdiction` | `string` optional | State name or OCD-ID. Strongly recommended — results without a jurisdiction filter span all states. |
| `name` | `string` optional | Name or partial name to match (case-insensitive substring). |
| `org_classification` | `z.enum(['legislature', 'executive', 'lower', 'upper', 'government'])` optional | Filter by role type. `upper` = Senate/upper chamber; `lower` = House/lower chamber; `legislature` = all legislators; `executive` = governors and executive officials. |
| `district` | `string` optional | District label (e.g., `"1"`, `"37"`, `"At-Large"`). District formats vary by state. |
| `include` | `array(z.enum(['other_names', 'other_identifiers', 'links', 'sources', 'offices']))` optional | `offices` includes phone, fax, and address. `links` includes website and social links. |
| `page` | `number` default 1 | Page number. |
| `per_page` | `number` default 10 max 20 | Results per page. API default is 10; set to 20 for maximum per-request coverage. |

**Output:**
```ts
{
  results: Array<{
    id: string;           // OCD person ID
    name: string;
    party: string;        // Primary party label. NOTE: verify against actual API response — upstream
                          // may return a `party` array; normalize to string (primary entry) in service layer.
    current_role: {
      title: string;
      org_classification: string;
      district: string | null;
    } | null;
    jurisdiction: { id, name };
    given_name: string;
    family_name: string;
    email: string;
    openstates_url: string;
    // When included:
    offices?: Array<{ name, classification, voice?, fax?, address? }>;
    links?: Array<{ url, note }>;
  }>;
  pagination: { page, per_page, max_page, total_items };
}
```

**Errors:**
```ts
// Empty results are NOT an error — return results: [] with pagination.
// Only throw for invalid inputs or upstream failures.
```

---

### 4. `openstates_get_legislators_by_location`

High-value constituent lookup — no equivalent in congressgov-mcp-server (which uses state/district instead).

**Description:** Find the legislators representing a geographic coordinate. Pass a latitude and longitude to get all state legislators (and potentially governor/executive officials) for that location. Useful for constituent-to-representative matching, address-based policy research, and electoral boundary analysis.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `lat` | `number` required | Latitude in decimal degrees (e.g., `47.6062` for Seattle). |
| `lng` | `number` required | Longitude in decimal degrees (e.g., `-122.3321` for Seattle). |
| `include` | `array(z.enum(['other_names', 'other_identifiers', 'links', 'sources', 'offices']))` optional | Same include options as people search. Use `offices` to get contact information. |

**Output:**
```ts
{
  legislators: Array<{
    id: string;
    name: string;
    party: string;        // Normalized from upstream (see people search output note on party array)
    current_role: { title, org_classification, district } | null;
    jurisdiction: { id, name };
    email: string;
    openstates_url: string;
    offices?: Array<{ name, classification, voice?, fax?, address? }>;
    links?: Array<{ url, note }>;
  }>;
  count: number;
  coverage_note?: string;  // Present when results are empty — explains why (e.g., outside US boundaries)
}
```

**Output note:** When no legislators are found for a valid coordinate (ocean, outside US), return `legislators: [], count: 0` — not an error. Add a `coverage_note` string field to the output to carry context when results are empty (e.g., "No legislators found for this coordinate. Verify the location is within a US state, DC, or Puerto Rico.").

**Errors:**
```ts
errors: [
  { reason: 'invalid_coordinate', code: InvalidParams,
    when: 'Lat/lng outside valid range or clearly non-US',
    recovery: 'Latitude must be between 24-50 (continental US), longitude between -125 and -66. For Alaska: lat 51-72, lng -180 to -130.' },
]
```

---

### 5. `openstates_search_committees`

**Description:** List committees for a jurisdiction. Coverage varies — not all states have committee data in Open States. Use `chamber` to scope to upper (senate) or lower (house) committees. Use `classification=subcommittee` to find subcommittees of a parent. Returns membership when `include=memberships` is requested.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `jurisdiction` | `string` optional | State name or OCD-ID. Strongly recommended. |
| `classification` | `z.enum(['committee', 'subcommittee'])` optional | Filter to parent committees or subcommittees. Omit for all. |
| `chamber` | `z.enum(['upper', 'lower'])` optional | Filter by chamber. |
| `parent` | `string` optional | OCD organization ID of a parent committee, to retrieve its subcommittees. |
| `include` | `array(z.enum(['memberships', 'links', 'sources']))` optional | `memberships` includes the full roster with member roles. |
| `page` | `number` default 1 | |
| `per_page` | `number` default 10 max 20 | |

**Output:**
```ts
{
  results: Array<{
    id: string;            // OCD organization ID
    name: string;
    classification: 'committee' | 'subcommittee';
    parent_id: string | null;
    memberships?: Array<{
      person_id: string;
      person_name: string;
      role: string;
      person?: CompactPerson;
    }>;
  }>;
  pagination: { page, per_page, max_page, total_items };
  coverage_note?: string;  // "Committee data is experimental — not all states have coverage."
}
```

**Errors:**
```ts
// Empty results are NOT an error — return results: [] with pagination.
// The coverage_note field in output communicates the experimental coverage gap to the agent.
```

---

### 6. `openstates_get_committee`

**Description:** Fetch full committee detail by OCD organization ID. Returns name, classification, and membership roster when `include=memberships` is requested. Obtain the `committee_id` from `openstates_search_committees`.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `committee_id` | `string` required | OCD organization ID (e.g., from `openstates_search_committees` results). |
| `include` | `array(z.enum(['memberships', 'links', 'sources']))` optional | `memberships` includes the full member roster with roles. |

**Output:** Single committee record matching the Committee schema above.

**Errors:**
```ts
errors: [
  { reason: 'not_found', code: NotFound,
    when: 'Committee ID does not exist',
    recovery: 'Use openstates_search_committees to discover valid committee IDs for a jurisdiction.' },
]
```

---

### 7. `openstates_search_events`

**Description:** Search hearings, floor sessions, and committee meetings. Event coverage is experimental — not all states publish event data to Open States. Use `after` and `before` to scope to a date range. Set `require_bills=true` to filter to events with bills on the agenda, which is the most useful filter for tracking legislation through committee.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `jurisdiction` | `string` optional | State name or OCD-ID. Strongly recommended. |
| `after` | `string` optional | ISO 8601 datetime — events starting after this time. Use to find upcoming hearings. |
| `before` | `string` optional | ISO 8601 datetime — events starting before this time. |
| `require_bills` | `boolean` default false | When true, only return events with at least one bill on the agenda. Most useful for tracking legislation. |
| `include` | `array(z.enum(['links', 'sources', 'media', 'documents', 'participants', 'agenda']))` optional | `agenda` includes the meeting agenda with bill references. `participants` includes the committee/chamber hosting the event. |
| `page` | `number` default 1 | |
| `per_page` | `number` default 10 max 20 | |

**Output:**
```ts
{
  results: Array<{
    id: string;
    name: string;
    description: string;
    classification: string;
    start_date: string;
    end_date: string;
    status: string;
    jurisdiction: { id, name };
    location?: { name, url, coordinates };
    participants?: Array<{ name, entity_type, role, organization?, person? }>;
    agenda?: Array<{
      description: string;
      classification: string[];
      subjects: string[];
      related_entities: Array<{ name, entity_type, bill?, organization?, person? }>;
    }>;
  }>;
  pagination: { page, per_page, max_page, total_items };
}
```

**Errors:**
```ts
// Empty results are NOT an error — return results: [] with pagination.
// The experimental coverage note belongs in the tool description, not as an error condition.
```

---

### 8. `openstates_get_event`

**Description:** Fetch full event detail by OCD event ID. Returns agenda, participants, media links, and associated documents when requested via `include`. Obtain the `event_id` from `openstates_search_events`.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `event_id` | `string` required | OCD event ID (e.g., from `openstates_search_events` results). |
| `include` | `array(z.enum(['links', 'sources', 'media', 'documents', 'participants', 'agenda']))` optional | `agenda` and `participants` are most useful. |

**Output:** Single event record matching the Event schema from `openstates_search_events`:
```ts
{
  id: string;
  name: string;
  description: string;
  classification: string;
  start_date: string;
  end_date: string;
  status: string;
  jurisdiction: { id: string; name: string };
  location?: { name: string; url?: string; coordinates?: unknown };
  links?: Array<{ url: string; note: string }>;
  media?: Array<{ url: string; note: string }>;
  documents?: Array<{ url: string; note: string }>;
  participants?: Array<{ name: string; entity_type: string; role: string; organization?: unknown; person?: unknown }>;
  agenda?: Array<{
    description: string;
    classification: string[];
    subjects: string[];
    related_entities: Array<{ name: string; entity_type: string; bill?: unknown; organization?: unknown; person?: unknown }>;
  }>;
}
```

**Errors:**
```ts
errors: [
  { reason: 'not_found', code: NotFound,
    when: 'Event ID does not exist',
    recovery: 'Use openstates_search_events to discover valid event IDs for a jurisdiction and date range.' },
]
```

---

### 9. `openstates_list_jurisdictions`

**Description:** List all jurisdictions covered by Open States — all 50 states, DC, and Puerto Rico. Returns coverage metadata: latest bill update time, latest people update time, and optionally all legislative sessions with their identifiers. Use this when you need to discover valid session identifiers for a state before calling `openstates_search_bills` with a `session` filter.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `classification` | `z.enum(['state', 'municipality', 'country'])` default `state` | Filter to states only (default), municipalities, or all. Most users want `state`. |
| `include` | `array(z.enum(['organizations', 'legislative_sessions', 'latest_runs']))` optional | `legislative_sessions` includes all session identifiers and date ranges — use this to discover valid `session` values for bill searches. |
| `page` | `number` default 1 | |
| `per_page` | `number` default 52 | Defaults to cover all states + DC + PR in one request. |

**Output:**
```ts
{
  results: Array<{
    id: string;             // OCD-ID — use as jurisdiction filter in other tools
    name: string;           // e.g., "Washington"
    classification: string;
    url: string;
    latest_bill_update: string;
    latest_people_update: string;
    legislative_sessions?: Array<{
      identifier: string;   // Use as session= in bill searches
      name: string;
      classification: string;
      start_date: string;
      end_date: string;
    }>;
  }>;
  pagination: { page, per_page, max_page, total_items };
}
```

---

### 10. `openstates_get_jurisdiction`

**Description:** Fetch full metadata for a specific jurisdiction including all legislative sessions, their identifiers, and data export download links. Use when you need to know the exact `session` identifier for a state before filtering bill searches. Jurisdiction IDs follow OCD format: `ocd-jurisdiction/country:us/state:{abbr}/government` (e.g., `ocd-jurisdiction/country:us/state:wa/government`). State names and two-letter abbreviations are also accepted.

**Input schema:**
| Param | Type | Description |
|:------|:-----|:------------|
| `jurisdiction_id` | `string` required | OCD jurisdiction ID, state name (e.g., `"Washington"`), or two-letter abbreviation (e.g., `"wa"`). |
| `include` | `array(z.enum(['organizations', 'legislative_sessions', 'latest_runs']))` optional | `legislative_sessions` returns all historical and current sessions with identifiers and date ranges. `latest_runs` shows last scraper run metadata. |

**Output:**
```ts
{
  id: string;
  name: string;
  classification: string;
  url: string;
  latest_bill_update: string;
  latest_people_update: string;
  organizations?: Organization[];
  legislative_sessions?: LegislativeSession[];
  latest_runs?: RunPlan[];
}
```

**Errors:**
```ts
errors: [
  { reason: 'not_found', code: NotFound,
    when: 'Jurisdiction ID does not exist',
    recovery: 'Use openstates_list_jurisdictions to discover valid jurisdiction IDs. States use the pattern: ocd-jurisdiction/country:us/state:{2-letter-abbr}/government.' },
]
```

---

## Resources

### `openstates://jurisdiction/{jurisdiction_id}`

Exposes jurisdiction metadata as injectable context. Stable URI per jurisdiction — agents can preload session identifiers and coverage dates once per conversation rather than calling `openstates_get_jurisdiction` on every turn.

Tool coverage: `openstates_get_jurisdiction` covers the same data for tool-only clients.

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `OpenStatesApiService` | Open States REST API v3 — auth, pagination, response normalization, retry | All tools and the jurisdiction resource |

Single service. The API is one coherent REST API with consistent auth, pagination, and error patterns.

### OpenStatesApiService Design

**Key methods:**
```ts
// Bills
searchBills(params: BillSearchParams): Promise<BillListResponse>
getBillByPath(jurisdiction: string, session: string, billId: string, include?: string[]): Promise<BillDetail>
getBillById(openstatesId: string, include?: string[]): Promise<BillDetail>

// People
searchPeople(params: PeopleSearchParams): Promise<PersonListResponse>
getPeopleByGeo(lat: number, lng: number, include?: string[]): Promise<PersonListResponse>

// Committees
searchCommittees(params: CommitteeSearchParams): Promise<CommitteeListResponse>
getCommittee(committeeId: string, include?: string[]): Promise<CommitteeDetail>

// Events
searchEvents(params: EventSearchParams): Promise<EventListResponse>
getEvent(eventId: string, include?: string[]): Promise<EventDetail>

// Jurisdictions
listJurisdictions(params: JurisdictionListParams): Promise<JurisdictionListResponse>
getJurisdiction(jurisdictionId: string, include?: string[]): Promise<JurisdictionDetail>
```

**Internal concerns:**
- API key injected via `X-API-KEY` header — never logged
- Pagination uses page/per_page (1-indexed), not offset
- `include` arrays passed as repeated query parameters: `?include=sponsorships&include=actions`
- Use native `fetch` with `withRetry` from `@cyanheads/mcp-ts-core/utils`
- Retry boundary wraps full fetch + parse pipeline
- Backoff: 1–2s base (rate-limited upstream, undocumented limits)
- Non-OK responses trigger `ServiceUnavailable`; HTML error responses detected and thrown as transient
- **429 handling:** Rate limits are enforced but undocumented. Detect HTTP 429 explicitly and throw `ServiceUnavailable` with a retryable flag and a message indicating rate limiting. Do NOT treat 429 the same as 403 (auth failure — not retryable).

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `OPENSTATES_API_KEY` | Yes | API key from [open.pluralpolicy.com](https://open.pluralpolicy.com/accounts/profile/) (free registration) |
| `OPENSTATES_API_BASE_URL` | No | API base URL. Defaults to `https://v3.openstates.org` |

---

## Implementation Order

1. **Config** — `server-config.ts` with Zod schema for `OPENSTATES_API_KEY`, base URL
2. **OpenStatesApiService** — API client with auth, pagination, typed methods, retry
3. **`openstates_list_jurisdictions`** — Simple list; useful to validate API key during dev
4. **`openstates_get_jurisdiction`** — Jurisdiction detail; needed to discover session IDs
5. **`openstates_search_bills`** — Core workflow; covers the 80% use case
6. **`openstates_get_bill`** — Bill detail with full include support
7. **`openstates_search_people`** — Legislator discovery
8. **`openstates_get_legislators_by_location`** — Geo lookup; different endpoint shape
9. **`openstates_search_committees`** — Experimental coverage; implement after core is solid
10. **`openstates_get_committee`** — Committee detail
11. **`openstates_search_events`** — Experimental; lowest coverage across states
12. **`openstates_get_event`** — Event detail
13. **Resource** — `openstates://jurisdiction/{jurisdiction_id}`
14. **Prompts** — `openstates_bill_research`, `openstates_legislator_profile`

Each step is independently testable after the service layer is in place.

**`format()` requirement:** Every tool must implement `format()` returning a markdown twin of `structuredContent`. Different MCP clients forward different surfaces to the model (Claude Code reads `structuredContent`; Claude Desktop reads `content[]` from `format()`). Both must carry the same data — `format()` is not optional and must render all fields the agent needs, not just a count or title.

---

## Workflow Analysis

### `openstates_search_bills` — include pipeline

The `include` parameter fundamentally changes the response shape. A search with `include=sponsorships,actions,votes` replaces 1 search + N detail calls with a single request.

| Include value | Adds to response | When to use |
|:-------------|:-----------------|:------------|
| `sponsorships` | Full sponsor list with person links | "Who sponsored this bill?" |
| `actions` | Full action history | "What stage is this bill at?" |
| `votes` | Vote events with tallies and per-legislator positions | "How did it vote?" |
| `abstracts` | Plain-language bill summaries (when available) | "What does this bill do?" |
| `versions` | Document links for bill text | "Where can I read the full text?" |
| `documents` | Fiscal notes and other documents | "Are there fiscal estimates?" |
| `related_bills` | Companion/identical bills | "Is there a Senate companion?" |
| `other_titles` | Alternative and short titles | "What's the short name?" |

Default behavior (no includes): returns compact bill records only — identifier, title, session, jurisdiction, latest action. Sufficient for listing/browsing.

### Geo-to-legislator flow

```
user: "who represents 123 Main St, Seattle?"
  → geocode to (47.6062, -122.3321) [external — not in this server]
  → openstates_get_legislators_by_location(lat, lng, include=offices)
  → returns: state senators and representatives + contact info
```

Note: This server does not geocode addresses. The caller must provide lat/lng. In practice, Claude can geocode using NWS or other geo tools before calling this endpoint.

### Session identifier discovery flow

```
user: "bills in Oregon 2025 session"
  → if session identifier is unknown:
    openstates_get_jurisdiction("Oregon", include=legislative_sessions)
    → reveals: "2025 Regular Session" has identifier "2025rs"
  → openstates_search_bills(jurisdiction="Oregon", session="2025rs")
```

Session identifiers vary significantly: some states use `"2025"`, others `"2025-2026"`, `"2025rs"`, `"2025s1"` (special session). Agents should not guess — always validate via `openstates_get_jurisdiction` first when the session identifier is uncertain.

---

## Design Decisions

### Bill search: full-text + structured filters in one tool

Unlike the Congress.gov API (browse-only), Open States supports full-text search via `q`. The 80% case is `openstates_search_bills(jurisdiction="WA", q="housing")`. The full-power case adds session, subject, sponsor, date filters. One tool covers both — no need for a separate keyword-search shortcut because `q` is already the convenience parameter.

The one constraint: either `jurisdiction` or `q` must be provided. Cross-state keyword search (`q` only) is valid and useful for tracking legislation across all states.

### `include` as inline enrichment instead of separate detail tools

The Open States API's `include` mechanism lets callers request related data inline on search results. For the most common patterns (bills + sponsorships, bills + actions, bills + votes), this eliminates a follow-up `get_bill` call. The design exposes `include` on both search and detail tools, guided by documentation about what each value adds.

This is a different architecture than congressgov-mcp-server's `operation` enum. With Open States, the base bill detail endpoint returns the same object as search — there's no separate "sub-resource" endpoint per relationship. The `include` pattern is more efficient.

### Separate tools for list and detail across all nouns

Each noun gets a search/list tool and a get-by-id tool rather than a single tool with an `operation` enum. Rationale: the parameters diverge significantly (search has 10+ filters; get-by-id has 1 required param), descriptions differ, and the tools are called in distinct agent contexts. The operation-enum pattern is better when parameter sets significantly overlap (as in congressgov where list + sub-resources share congress/billType/billNumber).

### Jurisdictions as first-class tools (not just reference data)

`openstates_list_jurisdictions` and `openstates_get_jurisdiction` are full tools, not just reference resources. They serve a real agent workflow need: discovering valid session identifiers before filtering bill searches. The jurisdiction resource at `openstates://jurisdiction/{id}` also exposes this for injectable context.

### No `people.geo` disambiguation tool needed

A separate "what's my district?" tool was considered but declined — `openstates_get_legislators_by_location` already returns the district as part of `current_role.district` on each legislator. The caller gets all legislators + their districts in one response.

### Committees and events: implement but warn about coverage

Both are described as "experimental" in the official docs ("We are currently working to restore experimental support for committees & events"). The API endpoints exist and work for supported states. Rather than omitting them, tool descriptions and `coverage_note` fields in output explicitly flag the coverage gap so agents can communicate limitations accurately.

### Alignment with congressgov-mcp-server patterns

- Same `{server}_{verb}_{noun}` naming convention
- Same annotation set (`readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: true`) on all tools
- Resources expose the same data as tool `get` operations — complementary access paths
- Prompts for structured research workflows
- Single service class wrapping the full API

Key differences reflect genuine API differences:
- Full-text search exists here (not in Congress.gov) — exposed as `q` parameter
- Geo-lookup (`people.geo`) has no federal equivalent
- OCD-IDs as the identifier system instead of bioguideId/congress/billType
- `include` instead of separate sub-resource operations
- Page/per_page instead of offset/limit pagination

### Field testing blocker

The API requires a valid key — the `test` key is rejected with a 401. Field testing requires a real key registered at open.pluralpolicy.com. Note this as a blocker for the `field-test` skill run; the server must be deployed with a real `OPENSTATES_API_KEY` to exercise live behavior.

---

## Known Limitations

- **Scraper lag:** Data sourced from scrapers, not live legislative feeds. May be hours to days behind the official source depending on state.
- **Committee coverage gaps:** Not all states have committee data. Some states have committee structure but no membership data.
- **Event coverage gaps:** Even fewer states have event/hearing data than committee data.
- **Session identifier variation:** Each state uses its own session identifier scheme. There is no universal "current session" shorthand — agents must look up valid identifiers via `openstates_get_jurisdiction`.
- **Rate limits undocumented:** The API enforces rate limits but doesn't publish them. The 403 response returned without a valid key is distinct from a rate-limit response; the server should watch for 429 responses and handle accordingly.
- **per_page max is 20:** The API's per_page maximum is 20 (default 10). High-volume result sets will require multiple pages; the design surfaces `max_page` and `total_items` so callers can plan pagination.
- **No vote rollup tool:** Individual vote events are accessible via `include=votes` on bill detail. There is no separate endpoint to search votes by legislator across all bills — constituent vote-tracking queries require fetching bill lists and inspecting vote arrays.

---

## API Reference

### Auth

API key via `X-API-KEY` header (preferred) or `?apikey=` query parameter. Key must be obtained at open.pluralpolicy.com — free registration, key is emailed after account approval.

### Pagination

Page/per_page (1-indexed). Default per_page is 10 for most endpoints. Maximum is 20. Responses include:
```json
{ "per_page": 20, "page": 1, "max_page": 5, "total_items": 87 }
```

### Jurisdiction IDs (OCD-IDs)

States use the pattern `ocd-jurisdiction/country:us/state:{abbr}/government` where `{abbr}` is the lowercase two-letter USPS abbreviation (e.g., `wa`, `ca`, `ny`). The API also accepts plain state names and abbreviations as convenience aliases for most endpoints.

### Include Pattern

Multiple includes passed as repeated query parameters:
```
GET /bills?jurisdiction=wa&include=sponsorships&include=actions
```

### `BillSortOption` Values

| Value | Meaning |
|:------|:--------|
| `updated_desc` | Most recently updated (default) |
| `updated_asc` | Least recently updated |
| `first_action_desc` | Most recently introduced |
| `first_action_asc` | Oldest introduction |
| `latest_action_desc` | Most recent floor/committee action |
| `latest_action_asc` | Oldest recent action |

### OrgClassification Values for People

| Value | Covers |
|:------|:-------|
| `upper` | State senate (upper chamber) |
| `lower` | State house/assembly (lower chamber) |
| `legislature` | All legislators regardless of chamber |
| `executive` | Governors, lieutenant governors, other executive officials |
| `government` | All of the above |

---

## Decisions Log

| # | Decision | Rationale | Date |
|:--|:---------|:----------|:-----|
| 1 | One search + one get-by-id per noun (no operation enum) | Parameter sets diverge enough that separate tools are clearer than an operation enum. Search has 10+ filters; get-by-id has 1 required ID. Compare to congressgov where sub-resources share the same congress/billType/billNumber params. | 2026-05-23 |
| 2 | Expose `include` on both search and detail tools | The API's inline enrichment model eliminates N+1 calls for common patterns (bills+sponsorships, bills+actions, bills+votes). More efficient than separate sub-resource tools. | 2026-05-23 |
| 3 | Implement committees and events despite experimental status | Better to expose experimental coverage with explicit warnings than to omit entirely. Agents can communicate limitations accurately when `coverage_note` is in the output. | 2026-05-23 |
| 4 | `openstates_list_jurisdictions` and `openstates_get_jurisdiction` as full tools | Session identifier discovery is a genuine agent workflow need, not just reference data. Tools make this a first-class operation rather than forcing agents to know OCD-IDs upfront. | 2026-05-23 |
| 5 | Separate geo-lookup tool (`openstates_get_legislators_by_location`) | `/people.geo` is a distinct endpoint with lat/lng inputs vs. the text-filter model of `/people`. Combining them into one tool would muddle the input schema significantly. | 2026-05-23 |
| 6 | No built-in address geocoding | Out of scope — this server wraps Open States, which only takes coordinates. Callers can use NWS weather server (already in ecosystem) or other geo tools to get coordinates from an address. | 2026-05-23 |
| 7 | API key required — field testing blocked until key is provisioned | The test key is explicitly rejected. Document as blocker in design rather than discovering it during field-test phase. | 2026-05-23 |
| 8 | No SDK dependency | No official JS/TS SDK exists for Open States v3. The API is straightforward REST — native fetch with typed wrappers is sufficient and avoids adding an unmaintained dependency. | 2026-05-23 |
| 9 | `jurisdiction` resource at `openstates://jurisdiction/{id}` | Stable, injectable context for jurisdiction metadata. Session identifiers and coverage dates are useful pre-conversation context that clients can inject without a tool call. Same pattern as `congressgov`'s `congress://current`. | 2026-05-23 |
| 10 | Naming aligned with congressgov-mcp-server conventions | `openstates_` prefix, `{server}_{verb}_{noun}` pattern, same annotation set. The two servers are domain peers — consistent naming reduces cognitive load when both are active. | 2026-05-23 |
