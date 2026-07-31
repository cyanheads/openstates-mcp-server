# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.2.2](changelog/0.2.x/0.2.2.md) — 2026-07-31

openstates_search_people can now fetch specific people by OCD person ID, and every output field Open States can send as an empty string now documents that in its .describe().

## [0.2.1](changelog/0.2.x/0.2.1.md) — 2026-07-31

Bill and legislative-session renderers no longer show orphaned punctuation for upstream fields sent as empty strings; the search_people description no longer claims a party filter that doesn't exist upstream.

## [0.2.0](changelog/0.2.x/0.2.0.md) — 2026-07-31 · ⚠️ Breaking

jurisdiction is now a required input field (not just handler-enforced) on search_people/search_committees/search_events — a breaking schema change; bill other_identifiers no longer fails output validation; search_bills names every filter behind a zero-result answer; get_legislators_by_location discloses the federal delegation it already returned.

## [0.1.17](changelog/0.1.x/0.1.17.md) — 2026-07-31

Upstream 4xx detail now surfaces to callers with an invalid_page error contract on paginated tools, a configurable total-retry wall-clock budget bounds the retry ladder, and empty upstream notes no longer render as stray punctuation in link/media/document lists.

## [0.1.16](changelog/0.1.x/0.1.16.md) — 2026-07-26

CLAUDE.md reconciled with the framework template: adds the missing What's Next? and Server identity and instructions sections, replaces stale ctx.sample references with ctx.enrich/ctx.content, and documents ctx.state.getMany, z.stringbool(), and the retryable/ctx.recoveryFor() error flow.

## [0.1.15](changelog/0.1.x/0.1.15.md) — 2026-07-26

A caller-owned deadline stops upstream timeouts from retrying into a ~4x wait; the daily budget and per-attempt timeout are now configurable; search_people/search_committees require jurisdiction to avoid the same timeout; several tools surface sponsor links, URLs, timestamps, headshots, and OCD division IDs the output schemas previously dropped.

## [0.1.14](changelog/0.1.x/0.1.14.md) — 2026-07-16

Response caching and a fail-fast daily request-budget guard protect the shared free-tier Open States key; 429 and HTML rate-limit responses now fail fast instead of retrying; the search_committees description and README correct a stale coverage_note reference to the coverageNote field.

## [0.1.13](changelog/0.1.x/0.1.13.md) — 2026-07-16

Every include-capable tool surfaces enrichment fields previously dropped (other_titles, sources, organizations, votes, and more); event participant role is now optional to match upstream sparsity; coverage copy corrected to 5 US territories across all metadata surfaces.

## [0.1.12](changelog/0.1.x/0.1.12.md) — 2026-07-16

Committee search normalizes jurisdiction names to avoid an upstream 500; jurisdiction listing merges pages internally for the complete 56-jurisdiction inventory; the jurisdiction resource adopts a typed not-found contract.

## [0.1.11](changelog/0.1.x/0.1.11.md) — 2026-07-16

Search tools correct session, jurisdiction, and name-length error handling; org_classification=legislature now resolves via a chamber union; adds a created_since bill filter. Adopts mcp-ts-core ^0.10.14 with a new supply-chain guard.

## [0.1.10](changelog/0.1.x/0.1.10.md) — 2026-06-21

Search tools echo their applied filters in the enrichment block, and date filters validate ISO 8601 format before the API call.

## [0.1.9](changelog/0.1.x/0.1.9.md) — 2026-06-20

Adopt @cyanheads/mcp-ts-core ^0.10.9: floating-specifier and plugin-manifest devcheck guards, fresh-scaffold check resilience, .codex-plugin long description

## [0.1.8](changelog/0.1.x/0.1.8.md) — 2026-06-12

Adopt @cyanheads/mcp-ts-core ^0.10.6: canonical enrichment total, explicit display identity, MCPB bundle cleaner, anchored .mcpbignore

## [0.1.7](changelog/0.1.x/0.1.7.md) — 2026-06-04

Structured errors for invalid session identifier and single-character name filter in search tools

## [0.1.6](changelog/0.1.x/0.1.6.md) — 2026-06-02

Adopt @cyanheads/mcp-ts-core 0.9.21 — per-request log context fix, secret-safe fetchWithTimeout, withRetry fail-fast; README client-config key normalization; release:github script

## [0.1.5](changelog/0.1.x/0.1.5.md) — 2026-05-30

Enrichment adoption — search/list tools surface true result totals, pagination, and coverage/empty-result guidance via a typed enrichment block in both structuredContent and content[]

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-05-28

@cyanheads/mcp-ts-core ^0.9.7 → ^0.9.13; HTTP body cap, session-init gate, quieter auth error logging, ValidationError codes, dep refresh

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-05-23

Add hosted server endpoint — streamable-http remote and public URL

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-05-23

Remove meta-coaching from tool descriptions, manifest fixes, package.json standardization

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-05-23

Initial public release — 10 tools, 1 resource, 2 prompts for US state legislature data via the Open States API v3.

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-05-23

Initial release — full Open States v3 API coverage: bills, legislators, committees, events, and jurisdictions for all 50 US states, DC, and Puerto Rico.
