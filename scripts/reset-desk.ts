// Wipes what a desk has learned, so it behaves like a fresh install, without touching its setup.
// Deletes visits, tapped requests, facts, actions, intents, rules, feedback and the audit log.
// Keeps settings (embedding lock, panel token, autopilot) and every index, so the running app keeps working.
//
//   AGENTDESK_DB=agentdesk npm run reset:desk -- --yes
import { COLLECTIONS, connect } from "../src/agentdesk/contract/db.js";

const dbName = process.env.AGENTDESK_DB;
if (!dbName) {
  console.error("Set AGENTDESK_DB to the desk database to reset (for example AGENTDESK_DB=agentdesk).");
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error(`This deletes everything the desk in database "${dbName}" has learned. Run again with --yes to do it.`);
  process.exit(1);
}

const LEARNED = Object.values(COLLECTIONS).filter((name) => name !== COLLECTIONS.settings);
const { client, db } = await connect({ mongoUri: process.env.MONGODB_URI!, dbName });
const settings = await db.collection(COLLECTIONS.settings).findOne({}, { projection: { siteId: 1 } });
if (!settings) {
  console.error(`"${dbName}" has no AgentDesk settings; refusing to touch a database that is not a desk.`);
  await client.close();
  process.exit(1);
}
for (const name of LEARNED) {
  const { deletedCount } = await db.collection(name).deleteMany({});
  console.log(`${name}: deleted ${deletedCount}`);
}
console.log(`Desk "${settings.siteId}" (database "${dbName}") is fresh again. Settings and indexes kept.`);
await client.close();
