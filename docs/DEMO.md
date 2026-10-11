# Demo

## Stage demo (3 minutes)

**0:00 Hook.** "dots and Muse now shop for people. They land on sites built for humans and give up. Here is a desk that learns to serve them, starting from nothing."

**0:20 Drop it in.** Show the demo store. Install AgentDesk (three lines). Panel shows: 0 knowledge, 0 capabilities.

**0:40 Visit 1.** A visitor agent asks "what can I do here?". No answer, agent leaves. The panel shows the episode turn red, with the desk's reflection: "unanswered: site purpose". Knowledge appears a few seconds later.

**1:00 Visit 2.** Next agent gets a real answer, then tries "add the blue mug to my cart" and fails at the desk. It falls back to clicking the site; the tap catches `POST /cart/items`. A new capability shows up as observed, then proposed.

**1:30 Visits 3 to 10, sped up.** Agents arrive with different requests. Capabilities turn verified. The learning curve climbs: success up, steps and seconds down. Checkout waits in "needs approval".

**2:00 Developer steers.** Approve checkout. Type a rule: "agents may not apply discount codes". The next agent asks for a discount and is refused, by the guardrail, not by luck.

**2:30 Same package, different site.** Drop AgentDesk into an insurance quote form. Empty again. Two visits later it knows how to request a quote.

**2:50 Close.** "Visit 1: no answer. Visit 10: purchase in 3 calls and 5 seconds. No one wrote an agent API."

## Video (1 minute, required for submission)

1. 0 to 10 s: the hook line over the empty panel.
2. 10 to 30 s: visit 1 fails, visit 2 learns, visit 3 succeeds in one call (sped up).
3. 30 to 45 s: learning curve, developer blocks discount codes, next agent refused.
4. 45 to 60 s: second site learns from zero, closing numbers on screen.

Record only what was built today.

## Numbers to show

- Task success rate: visit 1 vs visit 10
- Steps per task and seconds per task
- Unanswered questions per visit
- Capabilities learned, verified, approved, blocked
