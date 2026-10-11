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
  // Door owns stats. consecutiveFailures and lastFailureAt drive the breaker (isPaused).
  stats: { calls: number; successes: number; consecutiveFailures?: number; lastFailureAt?: Date | null; pausedFor?: string | null };
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
  /** Collections and indexes are created once per schema version, so later starts are fast. */
  schemaVersion?: number;
  /** Autopilot: learned everyday writes go live without approval (money still asks). The panel toggles it. */
  autopilot?: boolean;
}

export type AuditAction =
  | "ran_unreviewed" // autopilot ran a write nobody has approved yet
  | "autopilot_on"
  | "autopilot_off"
  | "paused_failing"; // the breaker stopped offering a capability after 2 failed runs in a row

/** What autopilot did, for the developer to review later (CONTRACT section 4, "Autopilot"). */
export interface AuditDoc extends Base {
  auditId: string;
  actor: "autopilot" | "developer";
  action: AuditAction;
  capabilityId: string | null;
  capabilityName: string | null;
  episodeId: string | null;
  sessionId: string | null;
  ok: boolean | null;
  detail: string;
}

// What the Door offers to agents (CONTRACT section 4).
// Reads: proposed, verified, approved. Writes: approved; on autopilot also proposed and verified,
// unless the write moves money (checkout, payment, order, refund), which always waits for the developer.
export function isOffered(
  cap: Pick<CapabilityDoc, "kind" | "stage"> & Partial<Pick<CapabilityDoc, "name" | "description" | "mappedRequests">>,
  mode: { autopilot?: boolean } = {},
): boolean {
  if (cap.stage === "observed" || cap.stage === "blocked") return false;
  if (cap.kind === "read") return true;
  if (cap.stage === "approved") return true;
  return Boolean(mode.autopilot) && !isSensitive(cap);
}

// The breaker (CONTRACT section 4, "Autopilot"): 2 failed runs in a row pause a capability, whatever
// its kind or stage. It comes back on its own when the Loop repairs it (what it sends changed since it
// failed), after a 10 minute cooldown for one trial run (success resets it, failure pauses it again),
// or when the panel's approve resets consecutiveFailures to 0. It does not trust updatedAt: the Loop
// touches that on every visit that used the capability, repaired or not.
export const PAUSE_COOLDOWN_MS = 10 * 60_000;

/** What a capability sends: its requests and inputs. A Loop repair changes it. */
export function capabilitySignature(cap: Partial<Pick<CapabilityDoc, "mappedRequests" | "inputSchema">>): string {
  return JSON.stringify([cap.mappedRequests ?? [], cap.inputSchema ?? {}]);
}

export function isPaused(
  cap: Partial<Pick<CapabilityDoc, "stats" | "mappedRequests" | "inputSchema">>,
  now: number = Date.now(),
): boolean {
  const failures = cap.stats?.consecutiveFailures ?? 0;
  if (failures < 2) return false;
  // Compared as times: fixtures and JSON imports carry dates as strings.
  const last = cap.stats?.lastFailureAt ? new Date(cap.stats.lastFailureAt).getTime() : 0;
  if (now - last >= PAUSE_COOLDOWN_MS) return false; // half-open: one trial run
  const pausedFor = cap.stats?.pausedFor;
  if (pausedFor && pausedFor !== capabilitySignature(cap)) return false; // repaired by the Loop
  return true;
}

/** A write that needs the developer even on autopilot: it looks like it spends money or places an order. */
const SENSITIVE_WORDS = /checkout|payment|\bpay\b|purchase|\border(s)?\b|billing|invoice|subscri|refund|transfer|withdraw|donat|charge/i;
const SENSITIVE_FIELDS = /card|cvv|cvc|iban|payment|billing|amount/i;
export function isSensitive(cap: Partial<Pick<CapabilityDoc, "name" | "description" | "mappedRequests">>): boolean {
  if (cap.name && SENSITIVE_WORDS.test(cap.name.replace(/_/g, " "))) return true;
  for (const step of cap.mappedRequests ?? []) {
    if (SENSITIVE_WORDS.test(step.path)) return true;
    const body = step.bodyTemplate;
    if (body && typeof body === "object" && Object.keys(body).some((k) => SENSITIVE_FIELDS.test(k))) return true;
  }
  return false;
}
