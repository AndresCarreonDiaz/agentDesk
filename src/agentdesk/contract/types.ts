// Mirrors docs/CONTRACT.md section 3. Change both together, in their own commit.

// CONTRACT section 2: the session join between Door calls and fallback clicks.
export const SESSION_HEADER = "x-agentdesk-session";
export const SESSION_COOKIE = "agentdesk_session";

export interface Base {
  siteId: string;
  createdAt: Date;
}

export type RequestSource = "fallback" | "capability" | "direct";

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

export type Outcome = "open" | "success" | "abandoned" | "error" | "blocked";

export type FailureKind =
  | "unknown_site"
  | "unknown_steps"
  | "capability_failed"
  | "wrong_answer"
  | "blocked";

export interface Turn {
  role: "agent" | "desk";
  text: string;
  capability?: string;
  at: Date;
}

export interface Reflection {
  failure: FailureKind | null;
  why: string;
  diff: string | null;
  learned: { kind: "knowledge" | "capability" | "rule"; id: string }[];
}

export interface EpisodeDoc extends Base {
  episodeId: string;
  sessionId: string;
  agentFamily: string; // "dots" | "muse" | "claude" | "script:<name>" ...
  goal: string | null;
  intents: string[];
  turns: Turn[];
  requestIds: string[];
  outcome: Outcome;
  goalSuccess: boolean | null; // the agent's word: a hypothesis
  doneNote: string | null;
  siteSuccess: boolean | null; // the site's evidence, set by Loop at close
  steps: number;
  durationMs: number;
  priorFailureId: string | null;
  reflection: Reflection | null;
}

export type CapabilityKind = "read" | "write";

export type CapabilityStage = "observed" | "proposed" | "verified" | "approved" | "blocked";

export interface MappedRequest {
  method: string;
  path: string;
  bodyTemplate: unknown; // may reference earlier steps: "{{steps[0].body.quoteId}}"
}

export interface CapabilityDoc extends Base {
  capabilityId: string;
  name: string;
  description: string;
  kind: CapabilityKind;
  inputSchema: object; // JSON Schema
  mappedRequests: MappedRequest[];
  stage: CapabilityStage;
  sourceEpisodeId: string;
  sourceRequestId: string;
  verifiedByEpisodeId: string | null;
  stats: { calls: number; successes: number };
  examples: { input: unknown; requestId: string }[];
  embedding: number[];
  updatedAt: Date;
}

export type KnowledgeSource = "site_read" | "episode" | "failure" | "developer";

export interface KnowledgeDoc extends Base {
  knowledgeId: string;
  text: string;
  source: KnowledgeSource;
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

export interface RuleMatch {
  method?: string;
  path?: string;
  bodyField?: string;
}

export interface RuleDoc extends Base {
  ruleId: string;
  text: string;
  compiled: {
    action: "block" | "require_review";
    capabilities?: string[];
    match?: RuleMatch;
  };
  source: "developer" | "reflector";
  status: "proposed" | "active" | "rejected";
  evidence: string[];
  enabled: boolean; // true only when status is "active"
}

export interface FeedbackDoc extends Base {
  feedbackId: string;
  type: "correction" | "approve" | "block";
  target: { collection: string; id: string };
  text: string | null;
}

export interface EmbeddingSettings {
  provider: "voyage" | "gemini";
  model: string;
  dims: number;
}

export interface SettingsDoc {
  _id: "settings";
  siteId: string;
  adminTokenHash: string;
  installedAt: Date;
  embedding: EmbeddingSettings; // locked at first start
  createdAt: Date;
}

// What the Door offers to agents (CONTRACT section 4).
export function isOffered(cap: Pick<CapabilityDoc, "kind" | "stage">): boolean {
  if (cap.kind === "write") return cap.stage === "approved";
  return cap.stage === "proposed" || cap.stage === "verified" || cap.stage === "approved";
}
