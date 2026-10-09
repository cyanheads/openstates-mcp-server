<div align="center">
  <h1>@cyanheads/openstates-mcp-server</h1>
  <p><b>Search bills, legislators, committees, and events across all 50 US states, DC, and 5 US territories via MCP. STDIO or Streamable HTTP.</b>
  <div>10 Tools • 1 Resource • 2 Prompts</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.3.3-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/openstates-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.2.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/openstates-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/openstates-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.2%2B-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/openstates-mcp-server/releases/latest/download/openstates-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=openstates-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvb3BlbnN0YXRlcy1tY3Atc2VydmVyIl0sImVudiI6eyJPUEVOU1RBVEVTX0FQSV9LRVkiOiJ5b3VyLWFwaS1rZXkifX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22openstates-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fopenstates-mcp-server%22%5D%2C%22env%22%3A%7B%22OPENSTATES_API_KEY%22%3A%22your-api-key%22%7D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

**Public Hosted Server:** [https://openstates.caseyjhand.com/mcp](https://openstates.caseyjhand.com/mcp)

</div>

---

## Overview

US state legislative data from the Open States v3 API — all 50 states, DC, and 5 US territories. Search and fetch bills, legislators, committees, events, and jurisdiction coverage metadata from any MCP client. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:---|:---|
| `openstates_search_bills` | Search state legislative bills across all covered US jurisdictions with full-text search, jurisdiction/session filtering, subject tags, and sponsor lookups |
| `openstates_get_bill` | Fetch full detail for a specific bill by OCD ID or three-part path (jurisdiction + session + bill_id) |
| `openstates_search_people` | Search state legislators and officials within a jurisdiction by name, chamber, or district, or fetch specific people by OCD person ID |
| `openstates_get_legislators_by_location` | Find every legislator representing a geographic coordinate (latitude/longitude) — state legislators and the federal delegation |
| `openstates_search_committees` | List committees for a jurisdiction (experimental — not all states have coverage) |
| `openstates_get_committee` | Fetch committee detail by OCD organization ID, with optional membership roster |
| `openstates_search_events` | Search hearings, floor sessions, and committee meetings (experimental) |
| `openstates_get_event` | Fetch full event detail including agenda, participants, and media links |
| `openstates_list_jurisdictions` | List all 56 jurisdictions (50 states, DC, and 5 US territories) covered by Open States with session identifiers and coverage metadata |
| `openstates_get_jurisdiction` | Fetch full metadata for a specific jurisdiction including all legislative sessions and their identifiers |

### Resources

| Resource | Description |
|:---|:---|
| `openstates://jurisdiction/{jurisdiction_id}` | Jurisdiction metadata including current sessions, coverage dates, and bill/people update timestamps |

All resource data is also reachable via tools. Use `openstates_get_jurisdiction` for programmatic jurisdiction lookups; the resource is useful for injecting jurisdiction context as stable reference material.

### Prompts

| Prompt | Description |
|:---|:---|
| `openstates_bill_research` | Structured framework for analyzing a state bill: summary, sponsors, committee referrals, action timeline, vote record, and related legislation |
| `openstates_legislator_profile` | Research framework for profiling a legislator: sponsored bills, committee assignments, voting record, and contact details |

## Capability reference

### `openstates_search_bills` <sub>tool</sub>

- Either `jurisdiction` or `q` is required by the schema — a `q`-only search spans all 56 jurisdictions and exceeds the upstream timeout for a common term, so pairing them is the reliable form
- Filters: `session`, `chamber` (`upper`/`lower`), `classification`, `subject` tags, `sponsor`, `sponsor_classification`, and `action_since`/`updated_since`/`created_since` ISO 8601 date filters
- `include` inlines sponsorships, actions, votes, abstracts, versions, documents, and related bills — avoids follow-up `openstates_get_bill` calls
- `sort` defaults to `updated_desc`; `sort=latest_action_desc` surfaces bills currently moving; pagination up to 20 per page (default 10)
- Empty-result notice echoes every applied filter and names the jurisdiction by name when it isn't recognized

---

### `openstates_get_bill` <sub>tool</sub>

- Lookup by `openstates_id` (preferred, from search results) or the three-part path `jurisdiction` + `session` + `bill_id`; a call missing both fails with `missing_lookup_params`
- Accepts legislature-format bill identifiers (e.g., `HB 1000`, `SB 42`)
- `include` inlines sponsorships, actions, votes, versions, documents, abstracts, other titles/identifiers, and related bills
- `not_found` when the ID or path resolves to nothing

---

### `openstates_search_people` <sub>tool</sub>

- Either `jurisdiction` or `id` (OCD person IDs) is required — an unscoped search exceeds the upstream timeout even for a name-only query
- `id` resolves any number of specific OCD person IDs in one call — the IDs that bill sponsorships and committee memberships hand back — and needs no jurisdiction alongside it
- `org_classification`: `upper`/`lower`/`executive`/`legislature` (both chambers merged, executive officials excluded); omitting it returns every officeholder including executives
- Case-insensitive substring `name` match, plus `district`; `include` adds offices, links, other_names, other_identifiers, sources
- Party is reported on every result but cannot be filtered on
- Pagination up to 20 per page

---

### `openstates_get_legislators_by_location` <sub>tool</sub>

- Pass decimal-degree `latitude`/`longitude`; does not geocode addresses
- Returns both government tiers in one call: state legislators plus the coordinate's two US Senators and one US Representative
- `jurisdiction.classification` (`state` vs `country`) is the tier discriminator — `current_role.org_classification` is not, since it's `upper`/`lower` for a US Senator exactly as for a state senator
- `stateCount`/`federalCount` enrichment fields report the tier split
- Out-of-range coordinates fail as `invalid_coordinate`; a location with no coverage returns an empty-result notice

---

### `openstates_search_committees` <sub>tool</sub>

- `jurisdiction` is required — the schema rejects an all-states request
- Filter by `classification` (`committee`/`subcommittee`) and `chamber`; `parent` scopes to one committee's subcommittees
- `include=memberships` returns the full roster with member roles
- Experimental: Open States is working to restore committee support and not all states have coverage — the output's `coverageNote` field always documents this
- Pagination up to 20 per page

---

### `openstates_get_committee` <sub>tool</sub>

- Fetch by OCD `committee_id` (from `openstates_search_committees`)
- `include=memberships` returns the roster; `include=links`/`sources` add reference URLs
- Experimental — not all states have committee data; `not_found` when the ID doesn't exist

---

### `openstates_search_events` <sub>tool</sub>

- `jurisdiction` is required — the events endpoint has no all-states search
- `after`/`before` scope to an ISO 8601 date range; `require_bills=true` filters to events with a bill on the agenda
- `include=agenda,participants` returns full meeting context
- Experimental: most states don't publish event data — an empty result may mean no coverage, not no events
- Pagination up to 20 per page

---

### `openstates_get_event` <sub>tool</sub>

- Fetch by OCD `event_id` (from `openstates_search_events`)
- `include` adds agenda, participants, links, media, and documents
- Experimental — event coverage is limited; `not_found` when the ID doesn't exist

---

### `openstates_list_jurisdictions` <sub>tool</sub>

- Returns all 56 jurisdictions (50 states, DC, and 5 US territories) in one default call — pages are merged server-side, since the upstream `per_page` ceiling of 52 no longer covers the full set
- `classification` filter defaults to `state`
- `include=legislative_sessions` returns every historical and current session identifier — required before filtering bill searches by session, since formats vary by state (e.g., `2025`, `2025-2026`, `2025rs`, `2025s1`)
- `include=organizations`/`latest_runs` add chamber/executive-body and scraper-run metadata

---

### `openstates_get_jurisdiction` <sub>tool</sub>

- Fetch one jurisdiction by OCD-ID, state name, or two-letter abbreviation
- `include=legislative_sessions` returns all session identifiers with date ranges
- `not_found` when the identifier doesn't resolve

---

### `openstates://jurisdiction/{jurisdiction_id}` <sub>resource</sub>

- `jurisdiction_id` accepts an OCD-ID, state name, or two-letter abbreviation
- Returns jurisdiction metadata as `application/json`: current legislative sessions, coverage dates, bill/people update timestamps
- Always includes `legislative_sessions` — use to prime session identifiers without a tool call
- `not_found` when the identifier doesn't resolve

---

### `openstates_bill_research` <sub>prompt</sub>

- Arguments: `jurisdiction`, `session`, `bill_id` — all required
- Returns one user message directing a structured research brief: overview, sponsors, legislative history, vote record, related legislation, bill text, and a passage assessment

---

### `openstates_legislator_profile` <sub>prompt</sub>

- Arguments: `name`, `jurisdiction` — both required
- Returns one user message directing a structured profile: identity/role, sponsored legislation, committee assignments, voting record, and a summary

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Open States-specific:

- Full Open States v3 API coverage: bills, people, committees, events, and jurisdictions
- Dual lookup modes on bill and committee fetchers (OCD ID or structured path)
- Geo-based legislator lookup via the Open States people-by-geo endpoint, spanning both state and federal tiers
- Server-level instructions prime the agent with session-discovery workflow and `include` parameter strategy before any tool call
- Per-key request budgeting (`OPENSTATES_DAILY_REQUEST_BUDGET`) and a two-tier timeout ladder guard the shared upstream key

Agent-friendly output:

- Empty-result recovery: search tools echo the applied filters and suggest how to broaden when no results are returned
- Experimental coverage notes (`coverageNote`) on committee and event tools — surfaces the limitation instead of a silent empty result
- `include` parameter pattern across all search and get tools — avoids N+1 follow-up calls for common research workflows

## Getting started

### Public Hosted Instance

A public instance is available at `https://openstates.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP:

```json
{
  "mcpServers": {
    "openstates-mcp-server": {
      "type": "streamable-http",
      "url": "https://openstates.caseyjhand.com/mcp"
    }
  }
}
```

### Self-Hosted / Local

Requires an Open States API key — register free at [open.pluralpolicy.com](https://open.pluralpolicy.com/accounts/profile/).

Add the following to your MCP client configuration file:

```json
{
  "mcpServers": {
    "openstates-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/openstates-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "OPENSTATES_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "openstates-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/openstates-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "OPENSTATES_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "openstates-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "-e", "OPENSTATES_API_KEY=your-api-key",
        "ghcr.io/cyanheads/openstates-mcp-server:latest"
      ]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 OPENSTATES_API_KEY=your-key bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
- An Open States API key — register free at [open.pluralpolicy.com](https://open.pluralpolicy.com/accounts/profile/).

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/openstates-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd openstates-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env and set OPENSTATES_API_KEY
```

## Configuration

All configuration is validated at startup via Zod schemas in `src/config/server-config.ts`. Key environment variables:

| Variable | Description | Default |
|:---|:---|:---|
| `OPENSTATES_API_KEY` | **Required.** Open States API key from [open.pluralpolicy.com](https://open.pluralpolicy.com/accounts/profile/). | — |
| `OPENSTATES_API_BASE_URL` | Open States API base URL. | `https://v3.openstates.org` |
| `OPENSTATES_DAILY_REQUEST_BUDGET` | Maximum upstream requests per rolling 24 hours. Once spent, calls are rejected before the request is issued, so an over-budget call costs nothing upstream. The default matches the v3 free-tier daily cap — raise it if your key's tier allows more. | `250` |
| `OPENSTATES_REQUEST_TIMEOUT_MS` | Per-attempt upstream deadline in milliseconds (minimum `1000`). Expiry is non-retryable, so a request that cannot complete costs one wait rather than four. Open States answers a scoped query anywhere from under a second to ~57s and its own gateway gives up near 60s — lower this to fail sooner, raise it to wait out a slow query. | `45000` |
| `OPENSTATES_TOTAL_REQUEST_BUDGET_MS` | Wall-clock ceiling in milliseconds for one call across every retry attempt and the backoff between them. The per-attempt deadline bounds a single request; this bounds the whole ladder, so a slow upstream that keeps failing retryably cannot hold a call open for the full retry sequence. Must be at least `OPENSTATES_REQUEST_TIMEOUT_MS` — startup rejects anything lower, which would abort every attempt before its own deadline applied. At the default of twice the deadline, an attempt that fails just short of its deadline still leaves a retry nearly a full deadline of its own. | `90000` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_SESSION_MODE` | HTTP session mode: `auto`, `stateful`, or `stateless`. `src/index.ts` declares `stateless` via `createApp({ sessionMode })` — no tool suspends for caller input, so no session state is needed. Setting this overrides the declaration; the framework schema default is `auto`, which resolves to stateful. | `stateless` |
| `MCP_HTTP_PORT` | HTTP server port. | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path. | `/mcp` |
| `MCP_PUBLIC_URL` | Public origin override for TLS-terminating reverse-proxy deployments. | none |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `notice`, `warning`, `error`). | `info` |
| `MCP_GC_PRESSURE_INTERVAL_MS` | Opt-in Bun-only forced-GC interval (ms). Try `60000` if heap grows under sustained HTTP load. | `0` (disabled) |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable OpenTelemetry instrumentation. | `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP base URL; traces go to `/v1/traces` and metrics to `/v1/metrics`. | none |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Opt-in OTLP log export (e.g. `http://localhost:4318/v1/logs`); the base endpoint never enables it. | none |
| `LOG_TOOL_FAILURE_PAYLOADS` | Log each failed tool call's arguments and result, redacted by key name only, capped by `LOG_TOOL_FAILURE_PAYLOAD_MAX_BYTES` (default `16384`). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

- **Build and run the production version:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

```sh
docker build -t openstates-mcp-server .
docker run --rm -e OPENSTATES_API_KEY=your-key -e MCP_TRANSPORT_TYPE=http -p 3010:3010 openstates-mcp-server
```

The Dockerfile defaults to HTTP transport, explicitly sets `MCP_SESSION_MODE=stateless`, and logs to `/var/log/openstates-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/index.ts` | `createApp()` entry point — registers tools, resources, prompts, and inits the Open States service. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Ten tools across bills, people, committees, events, and jurisdictions. |
| `src/mcp-server/resources` | Resource definitions. Jurisdiction metadata resource. |
| `src/mcp-server/prompts` | Prompt definitions. Bill research and legislator profile prompts. |
| `src/services/openstates` | Open States API v3 service layer — HTTP client, request handling, domain types. |
| `tests/` | Unit and integration tests mirroring `src/`. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools and resources via the arrays in `src/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
