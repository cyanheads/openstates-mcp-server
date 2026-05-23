#!/usr/bin/env node
/**
 * @fileoverview openstates-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { getServerConfig } from './config/server-config.js';
// Prompts
import { billResearch } from './mcp-server/prompts/definitions/bill-research.prompt.js';
import { legislatorProfile } from './mcp-server/prompts/definitions/legislator-profile.prompt.js';
// Resources
import { jurisdictionResource } from './mcp-server/resources/definitions/jurisdiction.resource.js';
// Tools
import { getBill } from './mcp-server/tools/definitions/get-bill.tool.js';
import { getCommittee } from './mcp-server/tools/definitions/get-committee.tool.js';
import { getEvent } from './mcp-server/tools/definitions/get-event.tool.js';
import { getJurisdiction } from './mcp-server/tools/definitions/get-jurisdiction.tool.js';
import { getLegislatorsByLocation } from './mcp-server/tools/definitions/get-legislators-by-location.tool.js';
import { listJurisdictions } from './mcp-server/tools/definitions/list-jurisdictions.tool.js';
import { searchBills } from './mcp-server/tools/definitions/search-bills.tool.js';
import { searchCommittees } from './mcp-server/tools/definitions/search-committees.tool.js';
import { searchEvents } from './mcp-server/tools/definitions/search-events.tool.js';
import { searchPeople } from './mcp-server/tools/definitions/search-people.tool.js';
import { initOpenStatesApiService } from './services/openstates/openstates-service.js';

await createApp({
  tools: [
    searchBills,
    getBill,
    searchPeople,
    getLegislatorsByLocation,
    searchCommittees,
    getCommittee,
    searchEvents,
    getEvent,
    listJurisdictions,
    getJurisdiction,
  ],
  resources: [jurisdictionResource],
  prompts: [billResearch, legislatorProfile],
  instructions:
    'Open States MCP server — US state legislative data for all 50 states, DC, and Puerto Rico.\n' +
    '- Use openstates_list_jurisdictions or openstates_get_jurisdiction (include=legislative_sessions) to discover valid session identifiers before filtering bill searches.\n' +
    '- Either jurisdiction or q is required for openstates_search_bills.\n' +
    '- Committee and event tools are experimental — not all states have coverage.\n' +
    '- Use include parameter on search and get tools to request related data inline and avoid N+1 follow-up calls.',
  setup(core) {
    const serverConfig = getServerConfig();
    initOpenStatesApiService(core.config, core.storage, serverConfig);
  },
});
