import type { AgentDeskContext } from "../contract/context.js";

// One Raindrop event per processed episode (docs/RAINDROP.md, HTTP API).
// Never throws: telemetry must not break learning. Free tier is 1,000 events a month, so no per-request events.

const ENDPOINT = "https://api.raindrop.ai/v1/events/track";
const TIMEOUT_MS = 5_000;

export type RaindropStatus = "sent" | "skipped" | "failed";

export interface VisitEvent {
  episodeId: string;
  agentFamily: string;
  goal: string | null;
  doneNote: string | null;
  outcome: string;
  siteSuccess: boolean | null;
  goalSuccess: boolean | null;
  steps: number;
  durationMs: number;
  capabilities: string[];
  failureKind: string | null;
}

export async function sendVisitEvent(ctx: AgentDeskContext, visit: VisitEvent): Promise<RaindropStatus> {
  const key = process.env.RAINDROP_WRITE_KEY?.trim();
  if (!key) return "skipped";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify([
        {
          event_id: visit.episodeId,
          event: "agent_visit",
          user_id: visit.agentFamily,
          properties: {
            episodeId: visit.episodeId,
            outcome: visit.outcome,
            goalSuccess: visit.goalSuccess,
            siteSuccess: visit.siteSuccess,
            steps: visit.steps,
            durationMs: visit.durationMs,
            capabilities: visit.capabilities.join(","),
            failureKind: visit.failureKind,
          },
          ai_data: {
            input: visit.goal ?? "",
            output: visit.doneNote ?? visit.outcome,
          },
        },
      ]),
    });
    if (!res.ok) {
      ctx.log.warn(`loop: Raindrop answered HTTP ${res.status}; event not recorded`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    ctx.log.warn(`loop: Raindrop event failed (${(err as Error).name === "AbortError" ? "timeout" : (err as Error).message})`);
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
