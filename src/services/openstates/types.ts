/**
 * @fileoverview Domain types for the Open States API v3.
 * @module services/openstates/types
 */

// --- Pagination ---

export interface PaginationMeta {
  max_page: number;
  page: number;
  per_page: number;
  total_items: number;
}

// --- Compact / embedded sub-types ---

export interface CompactJurisdiction {
  id: string;
  name: string;
}

export interface CompactOrganization {
  classification: string;
  name: string;
}

export interface CompactPerson {
  id: string;
  name: string;
}

// --- Bill types ---

export interface BillAbstract {
  abstract: string;
  note: string;
}

export interface BillDocumentLink {
  media_type: string;
  url: string;
}

export interface BillDocument {
  date: string;
  id: string;
  links: BillDocumentLink[];
  note: string;
}

export interface BillAction {
  classification: string[];
  date: string;
  description: string;
  id: string;
  order: number;
  organization: CompactOrganization;
}

export interface BillSponsorship {
  classification: string;
  entity_type: string;
  id: string;
  name: string;
  person?: CompactPerson;
  primary: boolean;
}

export interface VoteCount {
  option: string;
  value: number;
}

export interface PersonVote {
  id: string;
  option: string;
  voter?: CompactPerson;
  voter_name: string;
}

export interface VoteEvent {
  counts: VoteCount[];
  id: string;
  identifier: string;
  motion_text: string;
  result: string;
  start_date: string;
  votes: PersonVote[];
}

export interface RelatedBill {
  identifier: string;
  legislative_session: string;
  relation_type: string;
}

export interface Bill {
  abstracts?: BillAbstract[];
  actions?: BillAction[];
  classification: string[];
  documents?: BillDocument[];
  first_action_date: string | null;
  from_organization: CompactOrganization;
  id: string;
  identifier: string;
  jurisdiction: CompactJurisdiction;
  latest_action_date: string | null;
  latest_action_description: string | null;
  latest_passage_date: string | null;
  openstates_url?: string;
  other_identifiers?: Array<{ identifier: string; scheme: string }>;
  other_titles?: Array<{ title: string; note: string }>;
  related_bills?: RelatedBill[];
  session: string;
  sources?: Array<{ url: string; note: string }>;
  sponsorships?: BillSponsorship[];
  subject: string[];
  title: string;
  versions?: BillDocument[];
  votes?: VoteEvent[];
}

export interface BillListResponse {
  pagination: PaginationMeta;
  results: Bill[];
}

// --- Person types ---

export interface PersonRole {
  district: string | null;
  org_classification: string;
  title: string;
}

export interface PersonOffice {
  address?: string;
  classification: string;
  fax?: string;
  name: string;
  voice?: string;
}

export interface PersonLink {
  note: string;
  url: string;
}

export interface RawPerson {
  current_role?: PersonRole | null;
  email?: string;
  family_name?: string;
  given_name?: string;
  id: string;
  jurisdiction?: CompactJurisdiction;
  links?: PersonLink[];
  name: string;
  offices?: PersonOffice[];
  openstates_url?: string;
  other_identifiers?: Array<{ identifier: string; scheme: string }>;
  other_names?: Array<{ name: string; note: string }>;
  party?: string | Array<{ name: string; end_date?: string | null }>;
  sources?: Array<{ url: string; note: string }>;
}

export interface Person {
  current_role: PersonRole | null;
  email: string;
  family_name: string;
  given_name: string;
  id: string;
  jurisdiction: CompactJurisdiction;
  links?: PersonLink[];
  name: string;
  offices?: PersonOffice[];
  openstates_url: string;
  party: string;
}

export interface PersonListResponse {
  pagination: PaginationMeta;
  results: Person[];
}

// --- Committee types ---

export interface CommitteeMembership {
  person?: CompactPerson;
  person_id: string;
  person_name: string;
  role: string;
}

export interface Committee {
  classification: string;
  id: string;
  jurisdiction?: CompactJurisdiction;
  links?: PersonLink[];
  memberships?: CommitteeMembership[];
  name: string;
  parent_id: string | null;
  sources?: Array<{ url: string; note: string }>;
}

export interface CommitteeListResponse {
  pagination: PaginationMeta;
  results: Committee[];
}

// --- Event types ---

export interface EventLocation {
  coordinates?: unknown;
  name: string;
  url?: string;
}

export interface EventParticipant {
  entity_type: string;
  name: string;
  organization?: unknown;
  person?: unknown;
  role: string;
}

export interface AgendaRelatedEntity {
  bill?: unknown;
  entity_type: string;
  name: string;
  organization?: unknown;
  person?: unknown;
}

export interface AgendaItem {
  classification: string[];
  description: string;
  related_entities: AgendaRelatedEntity[];
  subjects: string[];
}

export interface Event {
  agenda?: AgendaItem[];
  classification: string;
  description: string;
  documents?: PersonLink[];
  end_date: string;
  id: string;
  jurisdiction: CompactJurisdiction;
  links?: PersonLink[];
  location?: EventLocation;
  media?: PersonLink[];
  name: string;
  participants?: EventParticipant[];
  sources?: Array<{ url: string; note: string }>;
  start_date: string;
  status: string;
}

export interface EventListResponse {
  pagination: PaginationMeta;
  results: Event[];
}

// --- Jurisdiction types ---

export interface LegislativeSession {
  classification: string;
  end_date: string;
  identifier: string;
  name: string;
  start_date: string;
}

export interface RunPlan {
  end_time?: string;
  start_time: string;
  success?: boolean;
}

export interface Jurisdiction {
  classification: string;
  id: string;
  latest_bill_update: string;
  latest_people_update: string;
  latest_runs?: RunPlan[];
  legislative_sessions?: LegislativeSession[];
  name: string;
  organizations?: unknown[];
  url: string;
}

export interface JurisdictionListResponse {
  pagination: PaginationMeta;
  results: Jurisdiction[];
}

// --- Request param types ---

export interface BillSearchParams {
  action_since?: string | undefined;
  chamber?: string | undefined;
  classification?: string | undefined;
  include?: string[] | undefined;
  jurisdiction?: string | undefined;
  page?: number | undefined;
  per_page?: number | undefined;
  q?: string | undefined;
  session?: string | undefined;
  sort?: string | undefined;
  sponsor?: string | undefined;
  sponsor_classification?: string | undefined;
  subject?: string[] | undefined;
  updated_since?: string | undefined;
}

export interface PeopleSearchParams {
  district?: string | undefined;
  include?: string[] | undefined;
  jurisdiction?: string | undefined;
  name?: string | undefined;
  org_classification?: string | undefined;
  page?: number | undefined;
  per_page?: number | undefined;
}

export interface CommitteeSearchParams {
  chamber?: string | undefined;
  classification?: string | undefined;
  include?: string[] | undefined;
  jurisdiction?: string | undefined;
  page?: number | undefined;
  parent?: string | undefined;
  per_page?: number | undefined;
}

export interface EventSearchParams {
  after?: string | undefined;
  before?: string | undefined;
  include?: string[] | undefined;
  jurisdiction?: string | undefined;
  page?: number | undefined;
  per_page?: number | undefined;
  require_bills?: boolean | undefined;
}

export interface JurisdictionListParams {
  classification?: string | undefined;
  include?: string[] | undefined;
  page?: number | undefined;
  per_page?: number | undefined;
}
