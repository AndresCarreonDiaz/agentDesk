import express, { Router } from "express";
import type { AgentDeskContext } from "../contract/context.js";
import { setAutopilot, autopilotOn } from "../contract/autopilot.js";
import { verifyAdminToken } from "../contract/db.js";
import { newId } from "../contract/ids.js";
import { isSensitive, type FeedbackDoc, type RuleDoc } from "../contract/types.js";
import { loopMetrics } from "../loop/index.js";
import { PANEL_HTML } from "./page.js";

// The developer panel (CONTRACT sections 3 to 5): a thin page and a JSON API under one router.
// Auth: the admin token from the first-start link, passed as the `token` query parameter on every route.

const NO_EMBEDDING = { projection: { embedding: 0 } } as const;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function startPanel(ctx: AgentDeskContext): Router {
  const router = Router();

  router.use((req, res, next) => {
    const token = typeof req.query.token === "string" ? req.query.token : null;
    if (!verifyAdminToken(token, ctx.settings)) {
      res.status(401).send("AgentDesk panel: open the private link printed in your server log at first start.");
      return;
    }
    next();
  });
  router.use(express.json());

  router.get("/", (_req, res) => {
    res.type("html").send(PANEL_HTML);
  });

  router.get("/api/state", async (_req, res, next) => {
    try {
      const { cols } = ctx;
      const [episodes, capabilities, proposedRules, rules, audit, autopilot, metrics] = await Promise.all([
        cols.episodes.find({}, NO_EMBEDDING).sort({ createdAt: -1 }).limit(50).toArray(),
        cols.capabilities.find({}, NO_EMBEDDING).sort({ updatedAt: -1 }).toArray(),
        cols.rules.find({ source: "reflector", status: "proposed" }).sort({ createdAt: -1 }).toArray(),
        cols.rules.find({}).sort({ createdAt: -1 }).toArray(),
        cols.audit.find({}).sort({ createdAt: -1 }).limit(50).toArray(),
        autopilotOn(ctx),
        loopMetrics(ctx),
      ]);
      res.json({
        episodes,
        capabilities: capabilities.map((c) => ({ ...c, waiting: c.kind === "write" && c.stage !== "approved" && isSensitive(c) })),
        proposedRules,
        rules,
        audit,
        autopilot,
        metrics,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/capabilities/:capabilityId", async (req, res, next) => {
    try {
      const stage = req.body?.stage;
      if (stage !== "approved" && stage !== "blocked") {
        res.status(400).json({ error: 'stage must be "approved" or "blocked"' });
        return;
      }
      const capabilityId = req.params.capabilityId;
      const now = new Date();
      const done = await ctx.cols.capabilities.updateOne({ capabilityId }, { $set: { stage, updatedAt: now } });
      if (done.matchedCount === 0) {
        res.status(404).json({ error: "unknown capability" });
        return;
      }
      const feedback: FeedbackDoc = {
        feedbackId: newId("fb"),
        siteId: ctx.config.siteId,
        type: stage === "approved" ? "approve" : "block",
        target: { collection: "capabilities", id: capabilityId },
        text: null,
        createdAt: now,
      };
      await ctx.cols.feedback.insertOne(feedback);
      res.json({ ok: true, capabilityId, stage });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/rules/:ruleId", async (req, res, next) => {
    try {
      const status = req.body?.status;
      if (status !== "active" && status !== "rejected") {
        res.status(400).json({ error: 'status must be "active" or "rejected"' });
        return;
      }
      const done = await ctx.cols.rules.updateOne(
        { ruleId: req.params.ruleId },
        { $set: { status, enabled: status === "active" } },
      );
      if (done.matchedCount === 0) {
        res.status(404).json({ error: "unknown rule" });
        return;
      }
      res.json({ ok: true, ruleId: req.params.ruleId, status });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/rules", async (req, res, next) => {
    try {
      const ruleText = text(req.body?.text);
      const method = text(req.body?.method);
      const path = text(req.body?.path);
      if (!ruleText || !method || !path) {
        res.status(400).json({ error: "text, method and path are required" });
        return;
      }
      const rule: RuleDoc = {
        ruleId: newId("rule"),
        siteId: ctx.config.siteId,
        text: ruleText,
        source: "developer",
        status: "active",
        enabled: true,
        evidence: [],
        compiled: { action: "block", match: { method: method.toUpperCase(), path } },
        createdAt: new Date(),
      };
      await ctx.cols.rules.insertOne(rule);
      res.status(201).json({ ok: true, rule });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/autopilot", async (req, res, next) => {
    try {
      const on = req.body?.on;
      if (typeof on !== "boolean") {
        res.status(400).json({ error: "on must be a boolean" });
        return;
      }
      await setAutopilot(ctx, on);
      res.json({ ok: true, autopilot: on });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
