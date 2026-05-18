/**
 * Probe WCL Debuffs table shape for armor debuffs on a kill fight.
 * Usage: node scripts/probe-wcl-debuff-uptime.mjs <reportCode> [fightId]
 */
import dotenv from "dotenv";
import {
  IMPORTANT_DEBUFFS,
  fetchDebuffUptimeForFight,
  loadWclReportFightsForDebuffs,
  killFightsForEncounter,
  listBossEncountersFromFights,
  parseWclTablePayload,
} from "../lib/wcl/debuff-uptime.mjs";

dotenv.config({ override: true });

const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const API_URL = "https://www.warcraftlogs.com/api/v2/client";

const id = process.env.WCL_CLIENT_ID;
const secret = process.env.WCL_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set WCL_CLIENT_ID + WCL_CLIENT_SECRET in .env");
  process.exit(1);
}

let accessToken = null;
async function getToken() {
  if (accessToken) return accessToken;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });
  const body = await res.json();
  accessToken = body.access_token;
  if (!accessToken) {
    console.error("Token failed", body);
    process.exit(2);
  }
  return accessToken;
}

async function queryWcl(query, variables) {
  const token = await getToken();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await res.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }
  return payload.data;
}

const reportCode = String(process.argv[2] || "").trim();
const fightIdArg = process.argv[3] ? Math.floor(Number(process.argv[3])) : null;

if (!reportCode) {
  console.error("Usage: node scripts/probe-wcl-debuff-uptime.mjs <reportCode> [fightId]");
  process.exit(1);
}

const report = await loadWclReportFightsForDebuffs(reportCode, { queryWcl });
if (!report) {
  console.error("Report not found:", reportCode);
  process.exit(3);
}

console.log("Report:", report.title, "| archive:", report.archiveStatus ?? "n/a");
const encounters = listBossEncountersFromFights(report.fights);
console.log("Boss encounters:", encounters);

let fight = null;
if (fightIdArg) {
  fight = report.fights.find((f) => Number(f.id) === fightIdArg) || null;
} else {
  fight =
    report.fights.find((f) => f.kill && f.encounterID > 0) ||
    report.fights.find((f) => f.encounterID > 0) ||
    null;
}

if (!fight) {
  console.error("No suitable fight found");
  process.exit(4);
}

console.log("\nUsing fight:", fight.id, fight.name, fight.kill ? "kill" : "wipe", `enc=${fight.encounterID}`);

console.log("\n=== Per-debuff Target table (production path) ===");
for (const def of IMPORTANT_DEBUFFS) {
  const filter = `ability.name = '${String(def.name).replace(/'/g, "\\'")}'`;
  const raw = await queryWcl(
    `query ($code: String!, $fightIds: [Int!]!, $filter: String!) {
      reportData { report(code: $code) {
        t: table(dataType: Debuffs, fightIDs: $fightIds, viewBy: Target, filterExpression: $filter)
      } }
    }`,
    { code: reportCode, fightIds: [fight.id], filter }
  );
  const parsed = parseWclTablePayload(raw?.reportData?.report?.t);
  const aura = (parsed?.auras || parsed?.entries || [])[0];
  const pct =
    parsed?.totalTime && aura?.totalUptime != null
      ? Math.round((aura.totalUptime / parsed.totalTime) * 1000) / 10
      : null;
  console.log(def.name, aura ? { guid: aura.guid, totalUptime: aura.totalUptime, uptimePct: pct } : "not found");
}

console.log("\n=== Normalized fetchDebuffUptimeForFight ===");
const normalized = await fetchDebuffUptimeForFight(reportCode, fight.id, { queryWcl });
console.log(JSON.stringify(normalized, null, 2));

if (fight.encounterID) {
  const kills = killFightsForEncounter(report.fights, fight.encounterID, { maxFights: 2 });
  console.log("\nKill fights for same encounter:", kills.map((f) => f.id));
}
