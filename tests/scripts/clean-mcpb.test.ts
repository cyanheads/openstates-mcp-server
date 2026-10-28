/**
 * @fileoverview Tests for the agent-doc matcher `scripts/clean-mcpb.ts` strips from a packed
 * `.mcpb` bundle: package-root agent-doc trees and stray `SKILL.md` files go, while runtime
 * directories that merely share a name — the MCP SDK's `dist/ext/skills/` — stay.
 * @module tests/scripts/clean-mcpb.test
 */

import { describe, expect, it } from 'vitest';
import { AGENT_DOC_ENTRY, filterAgentDocEntries } from '../../scripts/clean-mcpb.js';

/**
 * Runtime code the bundle must keep. The bare `/(?:framework-skills|skills|\.claude|\.agents)\//`
 * form matched every one of these, deleting the SDK's skills extension and the server's own
 * published `skills/` tree.
 */
const KEPT = [
  'node_modules/@modelcontextprotocol/core/dist/ext/skills/index.mjs',
  'node_modules/@modelcontextprotocol/core/dist/ext/skills/index.cjs',
  'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.mjs',
  'node_modules/@cyanheads/mcp-ts-core/node_modules/@modelcontextprotocol/core/dist/ext/skills/index.mjs',
  'skills/openstates-guide/SKILL.md',
];

/**
 * Agent docs a dependency ships at its package root. The `SKILL.md` rows outside the four trees
 * fail the bare directory-only form; the `@scope/` rows fail a matcher without scoped-package
 * support; the nested non-`SKILL.md` rows fail one that anchors only on the outermost
 * `node_modules/<pkg>/`.
 */
const STRIPPED = [
  'node_modules/@cyanheads/mcp-ts-core/framework-skills/add-tool/SKILL.md',
  'node_modules/some-pkg/skills/guide/SKILL.md',
  'node_modules/some-pkg/skills/guide/references/syntax.md',
  'node_modules/some-pkg/.claude/settings.json',
  'node_modules/@scope/pkg/.agents/skills/helper.md',
  'node_modules/some-pkg/SKILL.md',
  'node_modules/some-pkg/docs/agents/SKILL.md',
  'node_modules/outer/node_modules/inner/skills/guide/SKILL.md',
  'node_modules/outer/node_modules/inner/skills/guide/references/syntax.md',
  'node_modules/@scope/outer/node_modules/@scope/inner/framework-skills/setup/SKILL.md',
  'node_modules/outer/node_modules/@scope/inner/.claude/commands/run.md',
];

describe('AGENT_DOC_ENTRY', () => {
  it.each(KEPT)('keeps %s', (entry) => {
    expect(AGENT_DOC_ENTRY.test(entry)).toBe(false);
  });

  it.each(STRIPPED)('strips %s', (entry) => {
    expect(AGENT_DOC_ENTRY.test(entry)).toBe(true);
  });
});

describe('filterAgentDocEntries', () => {
  it('selects exactly the package-root agent docs from a mixed bundle listing', () => {
    const listing = [
      'manifest.json',
      'dist/index.js',
      'node_modules/some-pkg/package.json',
      'node_modules/some-pkg/lib/skills-registry.js',
      ...KEPT,
      ...STRIPPED,
    ];
    expect(filterAgentDocEntries(listing)).toEqual(STRIPPED);
  });
});
