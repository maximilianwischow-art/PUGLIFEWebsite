import assert from "node:assert/strict";
import dotenv from "dotenv";
import { fetchConsumablesUsageForReport } from "../lib/wcl/consumables-usage.mjs";
import { loadWclReportFightsForDebuffs } from "../lib/wcl/debuff-uptime.mjs";

dotenv.config({ override: true });

const id = process.env.WCL_CLIENT_ID;
const secret = process.env.WCL_CLIENT_SECRET;
const tokenRes = await fetch("https://www.warcraftlogs.com/oauth/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
  },
  body: "grant_type=client_credentials",
});
const { access_token } = await tokenRes.json();

async function queryWcl(query, variables) {
  const r = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ query, variables }),
  });
  const p = await r.json();
  if (p.errors) throw new Error(JSON.stringify(p.errors));
  return p.data;
}

const code = process.argv[2] || "BDKHQNwdbmz2Af1v";
const report = await loadWclReportFightsForDebuffs(code, { queryWcl });
assert.ok(report, "report loaded");
const usage = await fetchConsumablesUsageForReport(code, report.fights, { queryWcl });
assert.ok(usage.players.length > 0, "has players");
assert.ok(usage.fightsScanned >= 1, "fights scanned");
const withHaste = usage.players.filter((p) => (p.counts["haste-potion"] || 0) > 0);
assert.ok(withHaste.length > 0, "expected haste potion users");
console.log("consumables usage test passed", {
  players: usage.players.length,
  fightsScanned: usage.fightsScanned,
  sample: withHaste.slice(0, 3).map((p) => `${p.name}:${p.counts["haste-potion"]}`),
});
