// Mirrors docs/CONTRACT.md v4, section 3. Change only with the team, in its own commit.

export type SiteId = string;

interface Base {
  siteId: SiteId;
  createdAt: Date;
}

export type RequestSource = 'fallback' | 'capability' | 'direct';

export interface RequestDoc extends Base {
  requestId: string;
  sessionId: string | null; // null = human traffic, not an agent visit
  episodeId: string | null;
  source: RequestSource;
  method: string;
  path: string;
  query: Record<string, string>;
  bodyShape: Record<string, string>; // field -> type, no values
  body: unknown; // redacted: no passwords, cards, tokens
  status: number;
  durationMs: number;
  timestamp: Date;
}

export type Outcome = 'open' | 'success' | 'abandoned' | 'error' | 'blocked';
export type FailureKind = 'unknown_site' | 'unknown_steps' | 'capability_failed' | 'wrong_answer' | 'blocked';

export interface EpisodeDoc extends Base {
  episodeId: string;
  sessionId: string;
  agentFamily: string;
  goal: string | null;
  intents: string[];
  turns: { role: 'agent' | 'desk'; text: string; capability?: string; at: Date }[];
  requestIds: string[];
  outcome: Outcome;
  goalSuccess: boolean | null; // the agent's word: a hypothesis
  doneNote: string | null; // checked by Loop against the tapped requests
  siteSuccess: boolean | null; // the site's evidence, set by Loop at close (section 4)
  steps: number;
  durationMs: number;
  priorFailureId: string | null; // last failed episode with the same intent
  reflection: {
    failure: FailureKind | null;
    why: string;
    diff: string | null; // what the success did that the prior failure did not (section 4b)
    learned: { kind: 'knowledge' | 'capability' | 'rule'; id: string }[];
  } | null;
}

export type CapabilityStage = 'observed' | 'proposed' | 'verified' | 'approved' | 'blocked';

export interface CapabilityDoc extends Base {
  capabilityId: string;
  name: string;
  description: string;
  kind: 'read' | 'write';
  inputSchema: object;
  // In order. A later step may use an earlier response: "{{steps[0].body.quoteId}}".
  mappedRequests: { method: string; path: string; bodyTemplate: unknown }[];
  stage: CapabilityStage;
  sourceEpisodeId: string;
  sourceRequestId: string;
  verifiedByEpisodeId: string | null;
  stats: { calls: number; successes: number };
  examples: { input: unknown; requestId: string }[];
  embedding: number[];
  updatedAt: Date;
}

export interface KnowledgeDoc extends Base {
  knowledgeId: string;
  text: string;
  source: 'site_read' | 'episode' | 'failure' | 'developer'; // failure = lesson from a failed episode
  sourceRef: string | null;
  intent: string | null;
  confidence: number;
  embedding: number[];
}

export interface IntentDoc extends Base {
  name: string;
  examples: string[];
  embedding: number[];
  capabilityIds: string[];
}

export interface RuleDoc extends Base {
  ruleId: string;
  text: string;
  compiled: {
    action: 'block' | 'require_review';
    capabilities?: string[];
    match?: { method?: string; path?: string; bodyField?: string };
  };
  source: 'developer' | 'reflector'; // reflector = proposed from failures by Loop
  status: 'proposed' | 'active' | 'rejected';
  evidence: string[]; // episodeIds behind a reflector proposal
  enabled: boolean; // true only when status is "active"; Door enforces in `do` and in the tap
}

export interface FeedbackDoc extends Base {
  feedbackId: string;
  type: 'correction' | 'approve' | 'block';
  target: { collection: string; id: string };
  text: string | null;
}

// Section 2: the session join.
export const SESSION_HEADER = 'x-agentdesk-session';
export const SESSION_COOKIE = 'agentdesk_session';
export const ID_PREFIX = { session: 'ses_', episode: 'ep_', request: 'req_' } as const;

export interface SettingsDoc {
  _id: 'settings';
  siteId: SiteId;
  adminTokenHash: string;
  installedAt: Date;
  embedding: { provider: 'voyage' | 'gemini'; model: string; dims: number }; // locked at first start
}

// Section 4: the five fixed agent tools. Capabilities are data, never new tools.
export const AGENT_TOOLS = ['about', 'ask', 'list_actions', 'do', 'done'] as const;
export type AgentTool = (typeof AGENT_TOOLS)[number];

// Section 5: an episode with no agent call and no tapped request for this long is abandoned.
export const ABANDON_AFTER_MS = 60_000;
