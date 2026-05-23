# openstates-mcp-server — Idea

MCP server wrapping the Open States API v3 — comprehensive US state legislative data covering all 50 states, DC, and Puerto Rico. Bills, legislators, committees, votes, events, and sessions.

## Why

- All 50 states + DC/PR in one API — state-level complement to congressgov-mcp-server
- Target users: civic tech devs, policy researchers, journalists, lobbyists, advocacy orgs
- Free API key (registration at open.pluralpolicy.com)
- REST/JSON, modern API with OpenAPI docs
- No existing MCP server for state legislative data
- WA Legislature native API is XML-only and missing roll-call votes — Open States fills both gaps

## API

- **Base URL**: `https://v3.openstates.org/`
- **Auth**: API key via `X-API-KEY` header (free registration required)
- **Format**: JSON
- **Key endpoints**:
  - `GET /bills` — search/filter bills by state, session, subject, sponsor, status
  - `GET /bills/{jurisdiction}/{session}/{identifier}` — bill detail with votes, sponsors, actions
  - `GET /people` — search legislators by name, state, chamber, party, district
  - `GET /people.geo` — find legislators by lat/lng (constituent lookup)
  - `GET /committees` — committee listings
  - `GET /events` — hearings, floor sessions, committee meetings
  - `GET /jurisdictions` — list of covered jurisdictions with metadata
- **Rate limits**: Enforced but not publicly documented; 403 without key
- **Pagination**: cursor-based
- **Bulk data**: CSV/JSON downloads available for full dataset snapshots

## Scope

- Read-only (legislative data queries)
- All jurisdictions: 50 states + DC + PR
- Bills, people, committees, votes, events
- Geo-lookup for constituent-to-legislator matching

## Licensing

- Permissive: no attribution required, no copyright claim on data, commercial use allowed
- Access revocable at Open States' discretion
- No prohibition on proxying
- Data sourced from state legislature scrapers (may lag official source by hours/days)
