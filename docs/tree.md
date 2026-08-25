# openstates-mcp-server - Directory Structure

Generated on: 2026-08-25 05:18:53

```text
openstates-mcp-server/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   ├── mcp.json
│   └── plugin.json
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── config.yml
│   │   └── feature_request.yml
│   ├── FUNDING.yml
│   └── SECURITY.md
├── .vscode/
│   ├── extensions.json
│   └── settings.json
├── changelog/
│   ├── 0.1.x/
│   ├── 0.2.x/
│   ├── 0.3.x/
│   └── template.md
├── docs/
│   ├── design.md
│   └── idea.md
├── scripts/
│   ├── build-changelog.ts
│   ├── build.ts
│   ├── check-dependency-specifiers.ts
│   ├── check-docs-sync.ts
│   ├── check-framework-antipatterns.ts
│   ├── check-skill-versions.ts
│   ├── check-skills-sync.ts
│   ├── clean-mcpb.ts
│   ├── clean.ts
│   ├── devcheck.ts
│   ├── lint-mcp.ts
│   ├── lint-packaging.ts
│   ├── list-skills.ts
│   ├── release-github.ts
│   ├── split-changelog.ts
│   └── tree.ts
├── skills/
│   ├── add-app-tool/
│   │   └── SKILL.md
│   ├── add-prompt/
│   │   └── SKILL.md
│   ├── add-resource/
│   │   └── SKILL.md
│   ├── add-service/
│   │   └── SKILL.md
│   ├── add-test/
│   │   └── SKILL.md
│   ├── add-tool/
│   │   └── SKILL.md
│   ├── api-auth/
│   │   └── SKILL.md
│   ├── api-canvas/
│   │   └── SKILL.md
│   ├── api-config/
│   │   └── SKILL.md
│   ├── api-context/
│   │   └── SKILL.md
│   ├── api-errors/
│   │   └── SKILL.md
│   ├── api-linter/
│   │   └── SKILL.md
│   ├── api-mirror/
│   │   └── SKILL.md
│   ├── api-services/
│   │   ├── references/
│   │   │   ├── graph.md
│   │   │   ├── llm.md
│   │   │   └── speech.md
│   │   └── SKILL.md
│   ├── api-telemetry/
│   │   └── SKILL.md
│   ├── api-testing/
│   │   └── SKILL.md
│   ├── api-utils/
│   │   ├── references/
│   │   │   ├── formatting.md
│   │   │   ├── parsing.md
│   │   │   └── security.md
│   │   └── SKILL.md
│   ├── api-workers/
│   │   └── SKILL.md
│   ├── code-simplifier/
│   │   └── SKILL.md
│   ├── design-mcp-server/
│   │   └── SKILL.md
│   ├── field-test/
│   │   └── SKILL.md
│   ├── git-wrapup/
│   │   └── SKILL.md
│   ├── maintenance/
│   │   └── SKILL.md
│   ├── orchestrations/
│   │   ├── workflows/
│   │   │   ├── field-test-fix.md
│   │   │   ├── fix-wrapup-release.md
│   │   │   ├── greenfield-build.md
│   │   │   └── maintenance-release.md
│   │   └── SKILL.md
│   ├── polish-docs-meta/
│   │   ├── references/
│   │   │   ├── agent-protocol.md
│   │   │   ├── package-meta.md
│   │   │   ├── readme.md
│   │   │   └── server-json.md
│   │   └── SKILL.md
│   ├── release-and-publish/
│   │   └── SKILL.md
│   ├── report-issue-framework/
│   │   └── SKILL.md
│   ├── report-issue-local/
│   │   └── SKILL.md
│   ├── security-pass/
│   │   └── SKILL.md
│   ├── setup/
│   │   └── SKILL.md
│   ├── techniques/
│   │   ├── references/
│   │   │   └── outline-on-overflow.md
│   │   └── SKILL.md
│   └── tool-defs-analysis/
│       └── SKILL.md
├── src/
│   ├── config/
│   │   └── server-config.ts
│   ├── mcp-server/
│   │   ├── prompts/
│   │   │   └── definitions/
│   │   │       ├── bill-research.prompt.ts
│   │   │       └── legislator-profile.prompt.ts
│   │   ├── resources/
│   │   │   └── definitions/
│   │   │       └── jurisdiction.resource.ts
│   │   └── tools/
│   │       └── definitions/
│   │           ├── get-bill.tool.ts
│   │           ├── get-committee.tool.ts
│   │           ├── get-event.tool.ts
│   │           ├── get-jurisdiction.tool.ts
│   │           ├── get-legislators-by-location.tool.ts
│   │           ├── list-jurisdictions.tool.ts
│   │           ├── search-bills.tool.ts
│   │           ├── search-committees.tool.ts
│   │           ├── search-events.tool.ts
│   │           └── search-people.tool.ts
│   ├── services/
│   │   └── openstates/
│   │       ├── jurisdiction-inventory.ts
│   │       ├── openstates-service.ts
│   │       └── types.ts
│   └── index.ts
├── tests/
│   ├── config/
│   │   └── server-config.test.ts
│   ├── prompts/
│   │   ├── bill-research.prompt.test.ts
│   │   └── legislator-profile.prompt.test.ts
│   ├── resources/
│   │   └── jurisdiction.resource.test.ts
│   ├── security/
│   │   └── no-secret-leakage.test.ts
│   ├── services/
│   │   ├── openstates-service.mock-contract.test.ts
│   │   └── openstates-service.test.ts
│   └── tools/
│       ├── get-bill.additional.test.ts
│       ├── get-bill.tool.test.ts
│       ├── get-committee.tool.test.ts
│       ├── get-event.additional.test.ts
│       ├── get-event.tool.test.ts
│       ├── get-jurisdiction.tool.test.ts
│       ├── get-legislators-by-location.additional.test.ts
│       ├── get-legislators-by-location.tool.test.ts
│       ├── list-jurisdictions.additional.test.ts
│       ├── list-jurisdictions.tool.test.ts
│       ├── output-schema-empty-strings.test.ts
│       ├── scope-enforcement.test.ts
│       ├── search-bills.additional.test.ts
│       ├── search-bills.tool.test.ts
│       ├── search-committees.tool.test.ts
│       ├── search-events.tool.test.ts
│       ├── search-people.additional.test.ts
│       └── search-people.tool.test.ts
├── .dockerignore
├── .env.example
├── .gitattributes
├── .gitignore
├── .mcpbignore
├── biome.json
├── bun.lock
├── bunfig.toml
├── CHANGELOG.md
├── CITATION.cff
├── CLAUDE.md
├── devcheck.config.json
├── Dockerfile
├── LICENSE
├── manifest.json
├── package.json
├── README.md
├── server.json
├── tsconfig.build.json
├── tsconfig.json
└── vitest.config.ts
```

_Note: This tree excludes files and directories matched by .gitignore and default patterns._
