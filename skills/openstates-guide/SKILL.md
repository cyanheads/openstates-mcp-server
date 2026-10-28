---
name: openstates-guide
description: Identifier chains and gates for the openstates_* tools (US state legislatures via Open States). Use when tracing a state bill's fate, votes, or sponsors; finding who represents a location and their committees; finding hearings; or comparing states. Read before naming a bill, reporting who voted how, or concluding that a record, vote, or hearing does not exist.
license: Apache-2.0
metadata:
  author: cyanheads
  version: "1.0"
---

## Scope

State legislatures through Open States: bills, votes, legislators, committees, and hearings for the 50 states, DC, and the five US territories, scraped from each legislature's site and trailing it by hours to days.

- Congress is out of scope, though openstates_get_legislators_by_location returns a coordinate's members of Congress alongside its state legislators. Federal bills and votes come from a Congress.gov source such as congressgov-mcp-server.
- The server does not geocode. Turn an address into decimal coordinates with a geocoder (openstreetmap-mcp-server composes) before the location lookup.

## Identifiers

| ID | Form | Comes from | Feeds |
|:---|:-----|:-----------|:------|
| Jurisdiction | `ocd-jurisdiction/country:us/state:tx/government`; tools also take `Texas` or `tx` | openstates_list_jurisdictions | every jurisdiction input, including the jurisdiction resource URI |
| Session | `89R`, `892`, `20252026`, `2025-2026` | the `identifier` of each legislative session from openstates_get_jurisdiction | session filters, the openstates_get_bill path lookup |
| Bill (OCD) | `ocd-bill/<uuid>` | `id` on openstates_search_bills results | openstates_get_bill direct lookup, copied verbatim |
| Bill (legislature) | `HB 2`, `SB 1090` | a bill's `identifier`, its related bills, event agenda entries | openstates_get_bill with jurisdiction and session |
| Person | `ocd-person/<uuid>` | legislator results, sponsorships, vote positions, committee memberships | openstates_search_people by id; the bill sponsor filter |
| Committee | `ocd-organization/<uuid>` | openstates_search_committees | openstates_get_committee; the parent filter for subcommittees |
| Event | `ocd-event/<uuid>` | openstates_search_events | openstates_get_event |

A person ID is stable across sessions. A bill's IDs are not: a bill reintroduced next session gets a new identifier and a new OCD ID.

## Gates

**Pin the session before naming a bill.** A bill identifier is unique only within one session of one jurisdiction. `HB 2` is a different bill in every session, special sessions included, and Texas's 2025 alone runs `89R`, `891`, and `892`. Read the sessions from openstates_get_jurisdiction, choose by start and end dates, and pass the exact identifier, never a year or the session's name. When "this session" spans a regular session and called sessions, say which one you answered for.

**Unicameral bodies have no upper or lower chamber.** Nebraska and DC classify their members and bills as `legislature`, so an upper or lower chamber filter matches nothing there. Leave chamber filters off; on openstates_search_people, the `legislature` role filter returns their members.

**Read votes one event at a time.** A bill usually carries several vote events (committee, each reading, concurrence, both chambers), and their motion text can be identical: all five vote events on Texas's `89R` `HB 2` read "passage". Identify each by its date and tally, and match it to the same-date entry in the action history to name the chamber and stage. Never add tallies across events.

- Name who voted no only from the per-legislator positions. Some events carry a tally with no positions, and a tally can disagree with the positions listed; say so rather than reconcile them.
- Absent and not-voting positions are not votes against.
- Voter names are often surnames alone. Resolve a voter through its linked person ID; an unlinked name stays unresolved.

**An empty vote list is not "no vote".** A voice vote leaves no roll call. A bill set aside for its companion carries none of the floor action: when its actions show the companion taken up in its place (Texas: "Companion considered in lieu of"), look up the companion from its related bills with openstates_get_bill, using that bill's listed session and identifier, and read the votes there.

**Read status from the whole action history.** Action descriptions are each legislature's own wording; the classification tags (`introduction`, `referral-committee`, `committee-passage`, `passage`, `executive-receipt`, `executive-signature`) are what compare across states. Read the full sequence, not the last tag or the latest passage date: tags also land on formalities. Texas tags "Signed in the Senate", a step after both chambers pass the bill, as `passage`, and the bill's latest passage date follows it.

**Committee assignments come from roster scans.** No tool looks up a legislator's committees. Page through openstates_search_committees for the jurisdiction with memberships included, 20 to a page, and match on the person ID, not the name.

- Leave the chamber filter off. Joint committees belong to neither chamber: in Washington the upper and lower filters together return 34 of its 51 committees.
- Names repeat across chambers (Washington has two "Agriculture and Natural Resources" committees), so report a committee with its chamber or ID.
- Committee data is experimental. A legislator missing from every roster, or a state with no committees, means Open States lacks the data, not that no assignments exist. A membership whose person ID is empty carries a name only: match those by name, and say the match is unresolved.

**Find hearings by date, then filter the topic yourself.** openstates_search_events takes no keyword. Bound it with dates, include the agenda, and match the topic against agenda descriptions and subjects. Agenda entries name bills by identifier only; resolve each with openstates_get_bill using the jurisdiction, the session in effect on the event date, and that identifier. Most states publish few or no events, and a state's events may link no bills at all, so the bills-on-agenda filter can empty a state that does hold events. Report "no hearings found in Open States", never "no hearings scheduled".

**Compare states with full-text search, one state at a time.** Subject tags are each state's own scraper vocabulary. California's are run-together phrases (`housingdevelopmentapprovals`) and Washington assigns none, so a subject filter does not carry across states. Run the same query per jurisdiction with each state's own session pinned, and compare outcomes through action classifications.

**Spend upstream requests deliberately.** Every uncached call draws on the server's daily request budget (250 by default, shared by every caller of the server) and on Open States' cap of about 10 requests a minute. An identical call you repeat within minutes is served from cache and costs nothing.

- Scan at 20 per page, and fold related data in with include rather than follow-up calls. The default openstates_list_jurisdictions call and a people search with org_classification legislature each cost at least two requests.
- Size a multi-state sweep or a full roster scan before starting it.
- A per-minute rate-limit error from Open States clears within a minute: wait as long as it says, then retry once.
- An Open States hourly or daily cap clears at the next UTC hour or day boundary, and retryAfter says how many seconds remain. Retrying sooner fails: stop and report what you have.
- A daily-budget error is the server's own cap and states when it resets; retrying sooner fails. Stop and report what you have.

## Workflows

**A bill's fate and its votes.** Sessions from openstates_get_jurisdiction → openstates_get_bill by jurisdiction, session, and identifier, with actions, votes, sponsorships, and related bills included → the companion bill when the gate above applies → openstates_search_people with the linked person IDs of the sponsors or dissenters you name.

**Who represents an address.** Geocode → openstates_get_legislators_by_location, keeping the state tier → the committee roster scan above for each legislator's assignments.

**A legislator's bills across sessions.** Pass the person ID as the sponsor filter on openstates_search_bills with no session to cover every session. It matches cosponsorships too, so include sponsorships and check the legislator's own entry when only primary bills count. To follow one bill into a later session, search that session by text and sponsor, since the reintroduced bill carries new IDs.
