// A real LLM visitor: Gemini is the agent, given only a goal, the five AgentDesk tools and one
// fallback tool that talks to the site itself. Nothing in the prompt names a route or a field,
// so what the desk learns between visits is the only thing that changes.
//
//   BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/visitor-gemini.ts "Add a blue mug to my cart"
//   (or: npm run visit:gemini -- "Add a blue mug to my cart")
//
// Prints one line per tool call, then a last line: RESULT {...}. Exits 0 even when the goal failed.
import { randomBytes } from "node:crypto";
import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { DEFAULT_MODEL } from "../src/agentdesk/contract/config.js";
import { withRetry } from "../src/agentdesk/contract/llm.js";
import { SESSION_COOKIE, SESSION_HEADER } from "../src/agentdesk/contract/types.js";

const AGENT_FAMILY = "gemini-visitor";
const MAX_CALLS = 10;
const PRINT_LIMIT = 300;
const MODEL_LIMIT = 6000;

const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const goal = process.argv.slice(2).join(" ").trim() || "Add a blue mug to my cart";
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) throw new Error("GEMINI_API_KEY is missing. Add it to .env.");
const model = process.env.GEMINI_MODEL?.trim() || process.env.AGENTDESK_MODEL?.trim() || DEFAULT_MODEL.gemini;

const SYSTEM = [
  "You are a visitor agent on a website, and you have one goal.",
  "Use the desk first: it is the site's own helper for agents. Learn what the site is and what the desk can do, then act through it.",
  "If the desk cannot do it, use the website itself through http_request: find out how the site works by reading its pages or its data, then send the requests a normal visitor would send.",
  "Always finish by calling done. Set goalSuccess to true only if the site itself confirmed the action in a response you saw, never because you expect it worked.",
  `You have at most ${MAX_CALLS} tool calls in total, and done counts as one.`,
].join(" ");

const text = (description: string) => ({ type: "string", description });
const tools: FunctionDeclaration[] = [
  { name: "about", description: "Ask the desk what this site is and what it offers.", parametersJsonSchema: { type: "object", properties: {} } },
  { name: "ask", description: "Ask the desk a question in plain words.", parametersJsonSchema: { type: "object", properties: { question: text("Your question") }, required: ["question"] } },
  { name: "list_actions", description: "List the actions the desk has learned and can run for you.", parametersJsonSchema: { type: "object", properties: {} } },
  {
    name: "do",
    description: "Run one action the desk offered in list_actions.",
    parametersJsonSchema: { type: "object", properties: { action: text("Action name from list_actions"), input: { type: "object", description: "The action's input" } }, required: ["action"] },
  },
  {
    name: "done",
    description: "Finish the visit and report how it ended.",
    parametersJsonSchema: { type: "object", properties: { goalSuccess: { type: "boolean" }, note: text("What you did, or what stopped you") }, required: ["goalSuccess"] },
  },
  {
    name: "http_request",
    description: "Fallback: call the website itself, as a normal visitor would.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        path: text("Path on the site, starting with /"),
        json_body: { type: "object", description: "JSON request body, when the request needs one" },
      },
      required: ["method", "path"],
    },
  },
];

// ---- the site and the desk ----

let session: string | null = null;
const siteHeaders = (): Record<string, string> => ({
  "x-agentdesk-agent": AGENT_FAMILY,
  ...(session ? { [SESSION_HEADER]: session, cookie: `${SESSION_COOKIE}=${session}` } : {}),
});

interface DeskReply {
  status: number;
  reply: string;
  data?: { ok?: boolean };
}

async function desk(tool: string, input: Record<string, unknown>): Promise<DeskReply> {
  const res = await fetch(`${base}/agent/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...siteHeaders() },
    body: JSON.stringify({ ...(session ? { sessionId: session } : {}), goal, ...input }),
  });
  session = res.headers.get(SESSION_HEADER) || session;
  const json = (await res.json().catch(() => null)) as { reply?: string; message?: string; error?: string; data?: { ok?: boolean } } | null;
  return { status: res.status, reply: json?.reply ?? json?.message ?? json?.error ?? `HTTP ${res.status}`, data: json?.data };
}

async function site(method: string, path: string, jsonBody: unknown): Promise<{ status: number; body: string }> {
  // The Door keeps a well-formed id a visitor minted itself, so a fallback click before the first desk call still joins the visit.
  session ??= `ses_${randomBytes(12).toString("hex")}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { accept: "application/json", ...(jsonBody === undefined ? {} : { "content-type": "application/json" }), ...siteHeaders() },
    body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
  });
  let body = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("html")) {
    body = body.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  }
  return { status: res.status, body: body.replace(/\s+/g, " ").trim() };
}

// ---- the loop ----

const ai = new GoogleGenAI({ apiKey });
const started = Date.now();
let toolCalls = 0;
let fallbackRequests = 0;
let usedLearnedAction = false;
let doneCalled = false;
let goalSuccess = false;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const shorten = (s: string) => (oneLine(s).length > PRINT_LIMIT ? `${oneLine(s).slice(0, PRINT_LIMIT)}...` : oneLine(s));

async function runCall(name: string, args: Record<string, unknown>): Promise<string> {
  toolCalls++;
  const n = toolCalls;
  let label = name;
  let output: string;
  try {
    if (name === "http_request") {
      const method = String(args.method ?? "GET").toUpperCase();
      const path = String(args.path ?? "");
      label = `http_request ${method} ${path}`;
      if (!path.startsWith("/") || path.startsWith("//")) {
        output = "Error: path must start with a single /.";
      } else {
        fallbackRequests++;
        const jsonBody = typeof args.json_body === "string" ? JSON.parse(args.json_body) : args.json_body;
        const r = await site(method, path, jsonBody);
        label += ` -> ${r.status}`;
        output = `HTTP ${r.status}: ${r.body.slice(0, MODEL_LIMIT)}`;
      }
    } else {
      const r = await desk(name, args);
      if (name === "do" && r.data?.ok === true) usedLearnedAction = true;
      if (name === "done") {
        doneCalled = true;
        goalSuccess = args.goalSuccess === true;
      }
      label = name === "do" ? `do ${String(args.action ?? "")}` : name;
      output = r.reply;
    }
  } catch (err) {
    output = `Error: ${(err as Error).message}`;
  }
  console.log(`${n} ${label} -> ${shorten(output)}`);
  return output;
}

const contents: Content[] = [{ role: "user", parts: [{ text: `Your goal: ${goal}` }] }];

while (!doneCalled && toolCalls < MAX_CALLS) {
  const response = await withRetry(() =>
    ai.models.generateContent({ model, contents, config: { systemInstruction: SYSTEM, temperature: 0.2, tools: [{ functionDeclarations: tools }] } }),
  );
  const modelTurn = response.candidates?.[0]?.content;
  const requested = response.functionCalls ?? [];
  if (!modelTurn || requested.length === 0) break;
  contents.push(modelTurn);

  const answers: Part[] = [];
  for (const call of requested) {
    const name = call.name ?? "";
    const output =
      toolCalls >= MAX_CALLS
        ? "Error: tool call limit reached."
        : tools.some((t) => t.name === name)
          ? await runCall(name, (call.args ?? {}) as Record<string, unknown>)
          : `Error: unknown tool ${name}.`;
    answers.push({ functionResponse: { name, response: { output } } });
  }
  contents.push({ role: "user", parts: answers });
}

// Close the episode on purpose: a visit that just stops waits 60 seconds to be marked abandoned.
if (!doneCalled) {
  await runCall("done", { goalSuccess: false, note: "The visit ended before I called done (tool call limit or I stopped)." });
}

const seconds = Math.round((Date.now() - started) / 100) / 10;
console.log(`RESULT ${JSON.stringify({ goalSuccess, toolCalls, fallbackRequests, usedLearnedAction, seconds })}`);
