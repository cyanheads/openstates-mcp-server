<div align="center">
  <h1>@cyanheads/openstates-mcp-server</h1>
  <p><b>Search bills, legislators, committees, and events across all 50 US states, DC, and Puerto Rico via MCP. STDIO or Streamable HTTP.</b>
  <div>10 Tools • 1 Resource • 2 Prompts</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.2-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/openstates-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/openstates-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/openstates-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^5.9.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.0-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/openstates-mcp-server/releases/latest/download/openstates-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=openstates-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvb3BlbnN0YXRlcy1tY3Atc2VydmVyIl0sImVudiI6eyJPUEVOU1RBVEVTX0FQSV9LRVkiOiJ5b3VyLWFwaS1rZXkifX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22openstates-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fopenstates-mcp-server%22%5D%2C%22env%22%3A%7B%22OPENSTATES_API_KEY%22%3A%22your-api-key%22%7D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Tools

10 tools covering the full Open States v3 API surface — bills, legislators, committees, events, and jurisdictions:

| Tool | Description |
|:---|:---|
| `openstates_search_bills` | Search state legislative bills across all covered US jurisdictions with full-text search, jurisdiction/session filtering, subject tags, and sponsor lookups |
| `openstates_get_bill` | Fetch full detail for a specific bill by OCD ID or three-part path (jurisdiction + session + bill_id) |
| `openstates_search_people` | Search state legislators and officials by name, jurisdiction, chamber, district, or party |
| `openstates_get_legislators_by_location` | Find all legislators representing a geographic coordinate (latitude/longitude) |
| `openstates_search_committees` | List committees for a jurisdiction (experimental — not all states have coverage) |
| `openstates_get_committee` | Fetch committee detail by OCD organization ID, with optional membership roster |
| `openstates_search_events` | Search hearings, floor sessions, and committee meetings (experimental) |
| `openstates_get_event` | Fetch full event detail including agenda, participants, and media links |
| `openstates_list_jurisdictions` | List all 52 jurisdictions covered by Open States with session identifiers and coverage metadata |
| `openstates_get_jurisdiction` | Fetch full metadata for a specific jurisdiction including all legislative sessions and their identifiers |

### `openstates_search_bills`

Search state legislative bills with rich filtering and inline related data.

- Full-text search across bill titles, abstracts, and text (`q`)
- Filter by jurisdiction (state name, two-letter abbreviation, or OCD-ID), session, chamber, classification, subject tags, and sponsor
- Sort by latest action, first action, or update time — use `sort=latest_action_desc` for bills currently moving through the legislature
- `include` parameter requests sponsorships, actions, votes, abstracts, versions, and related bills inline — eliminates follow-up `openstates_get_bill` calls for most research workflows
- `action_since` and `updated_since` date filters for change-tracking
- Pagination up to 20 results per page
- Empty-result recovery: echoes applied filters and suggests how to broaden

---

### `openstates_get_bill`

Fetch complete bill detail by OCD ID or path lookup.

- Two lookup modes: `openstates_id` (OCD bill ID from search results, preferred) or the three-part path `jurisdiction + session + bill_id`
- Accepts bill identifiers in legislature format (e.g., `HB 1000`, `SB 42`)
- `include=votes` returns full vote tallies and per-legislator positions
- `include=versions,documents` provides links to bill text and fiscal notes
- Sponsors carry linked person records (OCD person ID + name) when available

---

### `openstates_search_people`

Search legislators and officials by name, jurisdiction, chamber, or district.

- Case-insensitive substring matching on name
- `org_classification` targets a specific chamber: `upper` (Senate), `lower` (House/Assembly), `legislature` (all), `executive` (governors and executive officials)
- `include=offices` returns phone, fax, and mailing address
- `include=links` returns website and social media links
- Strongly recommended to provide `jurisdiction` — omitting it returns legislators across all states

---

### `openstates_get_legislators_by_location`

Find all state legislators representing a geographic coordinate.

- Pass decimal-degree latitude/longitude to get state senators and representatives for that location
- Useful for constituent-to-representative matching, address-based policy research, and electoral boundary analysis
- Does not geocode addresses — the caller must provide coordinates
- Returns a coverage note when no legislators are found (e.g., coordinates outside US boundaries)

---

### `openstates_list_jurisdictions` and `openstates_get_jurisdiction`

Discover and look up jurisdiction coverage metadata.

- `openstates_list_jurisdictions` returns all 52 jurisdictions (50 states + DC + Puerto Rico) in a single call with `per_page=52` (the default)
- `include=legislative_sessions` returns all historical and current session identifiers — required before filtering bill searches by session, since formats vary widely by state (e.g., `2025`, `2025-2026`, `2025rs`, `2025s1`)
- `openstates_get_jurisdiction` fetches one jurisdiction by OCD-ID, state name, or two-letter abbreviation

---

### Committee and event tools (experimental)

`openstates_search_committees`, `openstates_get_committee`, `openstates_search_events`, and `openstates_get_event` are experimental — Open States is actively working to restore committee support and most states do not publish event data. Empty results may indicate the state lacks data, not that no committees or events exist. All four tools include a `coverage_note` in their output documenting this limitation.

## Resources and prompts

| Type | Name | Description |
|:---|:---|:---|
| Resource | `openstates://jurisdiction/{jurisdiction_id}` | Jurisdiction metadata including current sessions, coverage dates, and bill/people update timestamps |
| Prompt | `openstates_bill_research` | Structured framework for analyzing a state bill: summary, sponsors, committee referrals, action timeline, vote record, and related legislation |
| Prompt | `openstates_legislator_profile` | Research framework for profiling a legislator: sponsored bills, committee assignments, voting record, and contact details |

All resource data is also reachable via tools. Use `openstates_get_jurisdiction` for programmatic jurisdiction lookups; the resource is useful for injecting jurisdiction context as stable reference material.

## Features

Built on [`@cyanheads/mcp-ts-core`](https://www.npmjs.com/package/@cyanheads/mcp-ts-core):

- Declarative tool, resource, and prompt definitions — single file per primitive, framework handles registration and validation
- Unified error handling — handlers throw, framework catches, classifies, and formats
- Pluggable auth: `none`, `jwt`, `oauth`
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports

Open States-specific:

- Full Open States v3 API coverage: bills, people, committees, events, and jurisdictions
- Dual lookup modes on bill and committee fetchers (OCD ID or structured path)
- Geo-based legislator lookup via the Open States people-by-geo endpoint
- Server-level instructions prime the agent with session discovery workflow and `include` parameter strategy before any tool calls

Agent-friendly output:

- Empty-result recovery: tools echo the applied filters and suggest how to broaden when no results are returned
- Experimental coverage notes on committee and event tools — agents can surface these to users rather than returning silent empty results
- `include` parameter pattern across all search and get tools — avoids N+1 follow-up calls for common research workflows (e.g., `include=sponsorships,actions` on `openstates_search_bills`)

## Getting started

Requires an Open States API key — register free at [open.pluralpolicy.com](https://open.pluralpolicy.com/accounts/profile/).

Add the following to your MCP client configuration file:

```json
{
  "mcpServers": {
    "openstates": {
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
    "openstates": {
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
    "openstates": {
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

- [Bun v1.3.0](https://bun.sh/) or higher (or Node.js v24+).
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
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port. | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path. | `/mcp` |
| `MCP_PUBLIC_URL` | Public origin override for TLS-terminating reverse-proxy deployments. | none |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `notice`, `warning`, `error`). | `info` |
| `MCP_GC_PRESSURE_INTERVAL_MS` | Opt-in Bun-only forced-GC interval (ms). Try `60000` if heap grows under sustained HTTP load. | `0` (disabled) |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable OpenTelemetry instrumentation. | `false` |

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

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/openstates-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

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

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
