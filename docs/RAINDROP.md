# Raindrop AI: documentation summary

Source: https://www.raindrop.ai/docs/introduction/ and pages linked from https://raindrop.ai/docs/llms.txt. Fetched 2026-10-11. Only facts stated in the docs are listed. "Unclear in docs" marks gaps. Not fetched in detail: Go, Rust, Java SDK pages, the Vercel AI SDK page and the individual integration pages other than Claude Agent SDK, Datasets, Memory and the Support page.

## 1. What Raindrop is

Raindrop is a monitoring platform for AI agents. The docs compare it to Sentry for web apps. It aims to "discover silent agent failures in production", such as wrong answers, forgotten context and poor task paths that normal monitoring misses. It visualizes agent trajectories, detects issues automatically, searches production interactions in natural language, tracks custom signals and A/B tests agent changes. Setup uses a CLI installer that signs you in, writes a write key to `.env`, and installs coding-agent skills and an MCP server.

Source: https://raindrop.ai/docs/introduction

## 2. Capabilities by area

### 2.1 Ingestion SDKs and APIs

SDKs listed: TypeScript, Python, Go, Rust (Beta), Java (Beta), Browser (JavaScript), HTTP API, OpenTelemetry.

**TypeScript** (`raindrop-ai`)

```typescript
import { Raindrop } from "raindrop-ai";
const raindrop = new Raindrop({ writeKey: process.env.RAINDROP_WRITE_KEY });

const interaction = raindrop.begin({
  eventId, event: "chat_message", userId: "user_123",
  input: message, model: "gpt-4o", convoId: "convo_123",
  properties: { experiment: "experiment_a" },
});
interaction.setProperty("stage", "embedding");
interaction.finish({ output: text });

raindrop.trackAi({ event, userId, model, input, output, properties }); // single shot; docs recommend begin/finish
raindrop.setUserDetails({ userId, traits: { plan: "paid" } });
await raindrop.close(); // flush before exit
```

- Tracing: `interaction.withSpan({name}, fn)`, `interaction.withTool({name}, fn)`, `interaction.trackTool({name, input, output, durationMs})`, `startToolSpan()` (must call `span.end()`).
- Attachments: `interaction.addAttachments([{type: "text"|"code"|"image"|"iframe", value, role: "input"|"output"}])`.
- Feature flags: `featureFlags: { "prompt-version": "v2" }`, `interaction.setFeatureFlag(k, v)`.
- Self diagnostics: `raindrop.selfDiagnose({eventId, description})` and a tool via `createSelfDiagnosticsTool` with adapters for Vercel AI, OpenAI, Anthropic.
- Options: `projectId` (default `"default"`), `redactPii`, `disabled`, `debugLogs`, `appGit`, `instrumentModules`.
- Limits: 1 MB per event, larger payloads truncated. One tracing write key per process. Next.js needs `raindrop-ai` in `serverExternalPackages`. On Cloudflare Workers `begin()` cannot do ambient span routing; use `asCurrent()` or `interaction.withSpan`.

**Python** (`raindrop-ai`)

```python
import raindrop.analytics as raindrop
raindrop.init(os.getenv("RAINDROP_WRITE_KEY"), tracing_enabled=True)

i = raindrop.begin(user_id="u1", event="chat", input="Hi")
i.set_properties({"k": "v"})
i.finish(output="...")
raindrop.track_ai(user_id="u1", event="user_message", model="gpt_4", input="...", output="...", convo_id="c1", properties={})
raindrop.identify(user_id="u1", traits={"plan": "paid"})

@raindrop.interaction("flow")
@raindrop.tool("get_weather")
with raindrop.tool_span("search") as t: ...
i.track_tool(name="db", input={}, output={}, duration_ms=150)
raindrop.flush(); raindrop.shutdown()
```

- Detached sub-agents (Beta, `raindrop-ai>=0.0.65`): `interaction.subagent(name, input)` and `rd.resume_subagent(headers=...)`.
- Limits: 1 MB per event; up to 3 retries per failed request; default queue 10,000 events, upload 10 events per request, interval 1.0 s; `max_text_field_chars` 1,000,000 per field. `tracing_enabled=True` alone yields spans, not Events-page entries; wrap requests in `begin()`/`finish()`. Multiple projects need one client per project (`raindrop-ai>=0.0.56`).

**HTTP API** (base `https://api.raindrop.ai/v1`, header `Authorization: Bearer <WRITE_KEY>`, optional `X-Raindrop-Project-Id`)

| Endpoint | Body |
|---|---|
| `POST /events/track` | array of `{user_id, event, event_id, properties, attachments, ai_data: {model, input, output, convo_id, tool_calls: [{name, arguments, result, status, error, call_id}]}}` |
| `POST /signals/track` | array of `{event_id, signal_name, signal_type, sentiment, properties, timestamp}` |
| `POST /users/identify` | `{user_id, traits}` |

- Success returns HTTP 204. Batch max size: unclear in docs. Rate limits for these endpoints: unclear in docs.

**Browser SDK** (`@raindrop-ai/browser-sdk`): `trackAi`, `trackAiPartial` (streamed events), `identify`, `trackSignal`. Covers only `/v1/events`.

**OpenTelemetry**: `POST https://api.raindrop.ai/v1/traces`, OTLP/HTTP only (JSON or protobuf; no gRPC, metrics or logs). Uses `gen_ai.*` span attributes (`gen_ai.system` required on LLM spans, token usage, input/output messages) and `ai.prompt.tools`. Limits: 1,000 requests per 60 s per write key by default (429 with `Retry-After: 60`), only gzip/deflate, body max 32 MiB after decompression (413).

Sources: https://raindrop.ai/docs/sdk/typescript , /sdk/python , /sdk/http-api , /sdk/browser , /sdk/opentelemetry

### 2.2 Events, conversations and users

- An event is a single logged interaction: a user turn, an agent response or a tool call; events group into conversations. The Events page offers full-text search, paste-an-ID lookup, filters (user, conversation, date, property, model, tool, signal) and drill-down to traces. Event schema details live in the SDK pages; limits unclear in this page.
- Users: catalog keyed by `user_id`, with traits and triggered signals, filters, CSV export on paid plans, User Exclusions to hide users. Traits via `identify` (suggested plan values `free`, `paid`, `trial`).
- Event views show only finalized events (relevant to `trackAiPartial`).

Sources: https://raindrop.ai/docs/platform/events , /platform/users , /platform/projects

### 2.3 Signals

Signals label events as Positive, Negative or Other. Sources:
- Created signals: describe a behavior in plain language; Raindrop drafts a classifier, you mark Match/Not Match, then it labels new events and backfills the last 90 days (sampled). Counts against custom slots.
- Presets: User Frustration, Task Failure, Forgetting, Refusals, Jailbreaking, NSFW, User Praise.
- Regex signals (count against slots).
- Instrumented from the SDK: thumbs up/down, regenerations, shares, edits.
- Tool errors derived automatically from traces.
- Self Diagnostics reported by your own agent.

```typescript
await raindrop.trackSignal({ eventId, name: "thumbs_down", comment: "..." }); // optional type, after (edit), sentiment (default NEGATIVE)
```
```python
raindrop.track_signal(event_id="evt_1", name="edit", signal_type="edit", after="new text")  # types: default, feedback, edit
```

Limits: custom slots 1 on Hobby, 10 on Pro (more needs Enterprise). Presets, SDK signals, tool errors and self diagnostics do not use slots. Signals exist on every plan. Instrumented, preset and tool-error signals count only from when enabled.

Source: https://raindrop.ai/docs/platform/signals

### 2.4 Issues, Stumbles and Triage Agent

- Issues: Raindrop analyzes the event distribution and publishes an issue on a meaningful shift (failure spreading, new breakage, post-deploy regression). Fields: severity (critical to low), status (unresolved, resolved, ignored), affected events and users, report, trend. Actions: resolve, ignore, mark duplicate, edit priority, "Fix with Devin" if connected.
- Stumbles: a catalog of one-off failures, with tags, timeline and a Similar panel.
- Triage Agent: ask questions in Slack, web or MCP. It cites real conversations, runs Agent Briefs (scheduled investigations, cron, at most once every 3 hours), Daily Digest, custom monitors, and can draft signals and dashboards. Through MCP a coding agent can pull a live issue, edit code, run tests and open a PR.
- Limits: Issue Detection and full Stumbles need Pro (Hobby sees previews). Triage messages: 15 per month Hobby, 500 per month Pro. Messages starting with `aside:` are skipped.

Sources: https://raindrop.ai/docs/platform/issues , /platform/triage-agent

### 2.5 Alerts

Signal Alerts (real time, per signal, user/event threshold or every match; snooze/disable), Daily Digest (Slack), Agent Brief (scheduled Triage investigation to Slack). Slack is the only channel mentioned. No stated limits.

Source: https://raindrop.ai/docs/platform/alerts

### 2.6 Experiments

Compares a Baseline cohort and an Experiment cohort of already-logged events. It does not run or replay the agent. Cohorts are defined by date range plus conditions on model, feature flag, property or tool. Outcomes are signals. Metrics: Events % (default) or Users %, percentage-point change, 95% confidence interval, p-value, verdicts "likely better", "likely worse" or "mixed", and median cost per event. Create via UI, Triage or MCP (`create_experiment`, `get_experiment`).

Limits: creating and editing needs Pro; one project per experiment; no verdict if cohorts are filtered by signals or issues; small or uneven cohorts are inconclusive. How to tag versions in code: the Experiments page has no snippet. The SDK pages show `properties` and `featureFlags` fields that can serve as cohort keys (the Experiments page does not say this explicitly).

Source: https://raindrop.ai/docs/platform/experiments

### 2.7 Dashboards, cost tracking, projects

- Dashboards: up to 24 panels, RQL query panels or text panels, time range last hour to 30 days, built-in Usage dashboard (latency, tokens, tool health, model mix, cache hit rate). All plans. Private or org-shared.
- Cost tracking: computed from model usage with a versioned public rate catalog; provider-reported cost is used if given. TypeScript: pass `model` and `usage {provider, inputTokens, outputTokens, ...}` to `finish()`/`trackAi()` (`raindrop-ai` 0.3.1+). Python needs tracing with `raindrop-ai` 0.0.66+. No backfill of historical calls. Model coverage of the catalog: unclear in docs.
- Projects: default slug `default` (Production). Select with `X-Raindrop-Project-Id` or SDK `projectId`/`project_id`. Slug max 63 chars, lowercase letters, digits, hyphens. Projects are isolated for signals, dashboards and AI features; archiving is permanent (no hard delete). Per-org limit on uncreated slugs: number not stated.

Sources: https://raindrop.ai/docs/platform/dashboards , /platform/cost-tracking , /platform/projects

### 2.8 Query API, MCP and RQL

- Query API (`https://query.raindrop.ai`, Bearer Query API key, separate from the write key): `GET /v1/events`, `/events/search`, `/events/count`, `/events/timeseries`, `/events/facets`, `/events/error-span-facets`, `/events/{id}`, `/traces`, `/signals`, `/users`, `/conversations`, and user deletions. SDKs: `npm install @raindrop-ai/query`, `pip install raindrop-query` (methods `events.search`, `signals.list`, `events.count`, `events.list`, `events.timeseries`). Rate limits: 400 RPM for most endpoints, 50 RPM for `/events/search`, 40 RPS combined. Pagination: cursor with `has_more` in the SDK; endpoint parameters unclear in docs.
- MCP server: `https://mcp.raindrop.ai/mcp` (Streamable HTTP). OAuth 2.1 or API key. Claude Code: `claude mcp add raindrop --transport http <URL>`. Tools include `search_events`, `get_trace`, `run_rql`, `list_signals`, `list_issues`, `get_issue`, signal-creation sessions, `create_experiment`, `get_experiment`, datasets, memory, dashboards, `query_cost`. Write scopes: `write:issues`, `write:datasets`, `write:memories`, `write:signals`, `write:experiments`.
- RQL: read-only single `SELECT` over virtual tables `events`, `traces`, `users`, `conversations`. Events and traces limited to a 7-day window; 100 rows by default, up to 1,000; 30 s timeout; 8 concurrent queries per org; no joins or unions.

Sources: https://raindrop.ai/docs/query-api/sdk , /query-api/api-reference , /mcp/overview , /mcp/rql

### 2.9 Workshop and Skills

- Workshop: open-source local debugger. Install `curl -fsSL https://raindrop.sh/install | bash`. SDKs mirror traces locally when `RAINDROP_LOCAL_DEBUGGER` is set. Optional replay with a changed last user message, model, system prompt or code. Supports TypeScript, Python, Go, Rust. Production use and retention: unclear in docs.
- Skills: `raindrop-setup` (instruments your AI call sites) and `raindrop-investigate` (triage through MCP). Install: `curl -fsSL https://raindrop.sh/install | bash -s -- --cloud` or `npx skills add raindrop-ai/skills --skill raindrop-setup`.

Sources: https://raindrop.ai/docs/workshop/overview , /integrations/skills

### 2.10 Security and privacy

- SOC 2 Type II; data on dedicated AWS infrastructure, encrypted at rest and in transit; US subprocessors; "We do not train models on your data" (except custom models for your company). Retention period: unclear in docs.
- PII Guard (server-side, redacts at ingestion): starts at $80/month plus usage tiers (first 10,000 events free, then $0.0002 per event, falling with volume). Local regex redaction exists in the TypeScript SDK only (`redactPii`).
- Edge PII redaction is listed as an Enterprise feature.

Sources: https://raindrop.ai/docs/security/pii-redaction , /security/data-security-and-privacy

### 2.11 Plans and limits

| Plan | Price | Events | Custom signals | Triage messages per month |
|---|---|---|---|---|
| Hobby | Free | 1,000 per month (ingest stops for the month when reached) | 1 | 15 |
| Pro | $299 per month, 14-day trial | Metered: $0.003 per event up to 1M, then $0.002 | 10 | 500 |
| Enterprise | Custom | Custom | Custom | Custom |

Hobby includes tracing, search, alerts, signal presets, MCP and Query SDK; Issues and Experiments are previews only. Pro adds Issue Detection, full Stumbles, Experiments, conversation summaries, Memory and data export. Enterprise adds SSO/SAML, edge PII redaction, audit logs, warehouse exports, SLAs. Retention: not stated.

Source: https://raindrop.ai/docs/platform/plans

## 3. Integrations

From https://raindrop.ai/docs/integrations/overview (base `https://raindrop.ai/docs/integrations/<name>`; beta tags appear in the intro index, not the overview):
- AI SDKs: Vercel AI SDK, TanStack AI, Claude Agent SDK, Cursor Agent SDK, Claude Managed Agents, OpenAI Agents SDK, OpenAI Agents API, OpenRouter Agent SDK.
- Agent frameworks: Eve, LangChain, Mastra, Deep Agents, DSPy, Pydantic AI, Pi Agent, Agno, Strands Agents, Google ADK, CrewAI.
- Cloud providers: AWS Bedrock, Azure OpenAI, Vertex AI.
- Orchestration: Temporal.
- Developer tools: Claude Code CLI, Cursor, OpenCode.
- Also: OpenTelemetry (`/v1/traces`), Anthropic module instrumentation in the TypeScript SDK (`instrumentModules`), MCP clients (Claude Code, Codex, Devin, Cursor, VS Code, Windsurf), Slack (Triage, alerts), Devin ("Fix with Devin").
- Claude Agent SDK example (`@raindrop-ai/claude-agent-sdk`): `createRaindropClaudeAgentSDK({writeKey})`, `raindrop.wrap(claudeAgentSDK)`, `eventMetadata({userId, eventName})` on each `query()`, `raindrop.flush()`; `raindrop.signals.track({eventId, name, sentiment})`. `userId` is required.

## 4. Relevant to AgentDesk

Project, per README and docs/*.md: a drop-in "front desk" for AI agents that starts empty and learns capabilities from agent visits ("episodes"), stores memory in MongoDB Atlas, lets a developer approve/block capabilities and set rules, and shows a learning curve (success, steps, seconds per task over visits). The repo already names Raindrop for "hard signals per visit" and "Experiments to A/B desk versions", and lists "Raindrop Experiments" as the second cut line.

| AgentDesk part | How Raindrop could serve it | Raindrop feature |
|---|---|---|
| Episode (one agent visit) | Log each visit as one interaction: `event: "agent_visit"`, `userId` = agent family or session id, `convoId` = session id, `input` = agent request, `output` = desk answer, `properties` = intent, capability name, desk version | `begin()`/`finish()` or `POST /v1/events/track` |
| Door (`POST /agent`, `/mcp`) | Wrap each request in an interaction; wrap each capability call as a tool span with input/output and duration | `withTool`/`trackTool`, `ai_data.tool_calls` |
| Tap (HTTP requests of the host app) | Optional: send as tool spans on the matching visit, so a fallback to the human website shows up on the same trace. Whether this fits is a design choice, not stated in the docs | OTLP `/v1/traces`, `trackTool` with `traceId` |
| Reflector (second agent) | Track as its own event or a sub-span; use `trackAi` with model and usage to see its cost | Cost tracking (`usage`), sub-agents (Python Beta) |
| Success / abandon / error outcome | Send as signals on the episode event: `task_success`, `abandoned`, `policy_denied`, `unanswered_question`. These are SDK signals and do not use custom slots | `trackSignal`, `POST /v1/signals/track` |
| Steps and seconds per task | Put `steps` and `duration_s` in `properties` or derive from tool spans; chart with RQL panels | Dashboards, RQL (7-day window) |
| Unanswered questions (visit 1) | Use a created signal ("agent asked what the site offers and got no answer") or a preset (Task Failure, Refusals). Counts against the 1 Hobby slot if created | Created signals, presets |
| Developer rules / guardrail blocks | Track a denial as a signal plus a property with the rule id; the tool-error signal comes from errors on tool spans | Tool-error signals, `properties` |
| Capability lifecycle (observed to verified) | Tag events with `properties.capability_stage` or a feature flag, so cohorts can be filtered | `featureFlags`, `setProperty` |
| A/B of desk versions (for example two descriptions of one capability) | Set `featureFlags: {"capdesc": "v1"|"v2"}` or a `desk_version` property; create an Experiment with Baseline vs Experiment cohorts and Task Failure or success as the outcome. Needs Pro and enough sample; it reads logged traffic and does not replay it | Experiments (Pro) |
| Developer corrections | Track a correction as an `edit` signal with `after` = the right answer | `trackSignal` with type `edit` |
| Detecting new failure patterns | Issue Detection and Stumbles surface recurring or one-off failures; Triage answers "why did visits fail today" | Issues (Pro), Triage Agent (15 or 500 messages per month) |
| Developer panel "why it happened" | Could read from Raindrop through the Query API or RQL as a second source. The README keeps this in Atlas traces and `episodes`, so this is optional | Query API, MCP |
| Hackathon day debugging | Use Workshop locally to watch traces of visitor agents while building | Workshop |
| Build tooling | Claude Code / Cursor can set up Raindrop with the `raindrop-setup` skill; PLAN.md says "Set up Raindrop with its CLI and write key" | Skills, installer |

Constraints to plan for:
- Hobby (free): 1,000 events per month, then ingest stops for the month. A demo with many scripted visits may reach that. Each tool call inside an event is not stated to count as an event (unclear in docs).
- Experiments and Issue Detection need Pro ($299 per month, 14-day free trial). On Hobby they are previews only, so the A/B part of the demo may need a trial.
- One custom signal on Hobby; use SDK signals and presets for the rest.
- RQL covers only 7 days of events and traces; fine for a one-day hackathon.
- Experiment verdicts need enough samples per cohort; a few demo visits may give "inconclusive".
- Keep the write key in an environment variable. This repo is public and has a secret gate; never commit the key.
- TypeScript stack fits: `raindrop-ai` with `begin()`/`finish()`, `await raindrop.close()` before exit. The demo may run on Modelence; whether the SDK runs there is unclear in docs (Cloudflare Workers has a documented caveat for `begin()`).
- Agent traffic may contain PII from visiting users; `redactPii: true` (TypeScript, regex only) or PII Guard are the documented options.
