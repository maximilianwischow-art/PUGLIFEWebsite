/**
 * Probe WCL cast/applybuff events for guild usage consumables.
 * Usage: node scripts/probe-consumables-usage.mjs <reportCode> [fightId|all]
 */
import dotenv from "dotenv";

dotenv.config({ override: true });

const TARGETS = [
  { name: "Haste Potion", itemId: 22838, spellHints: ["haste"] },
  { name: "Destruction Potion", itemId: 22839, spellHints: ["destruction"] },
  { name: "Fel Mana Potion", itemId: 22832, spellHints: ["fel mana"] },
  { name: "Scroll of Agility V", itemId: 27498, spellHints: ["agility v", "scroll of agility"] },
  { name: "Scroll of Strength V", itemId: 27503, spellHints: ["strength v", "scroll of strength"] },
  { name: "Scroll of Spirit V", itemId: 27501, spellHints: ["spirit v", "scroll of spirit"] },
  { name: "Flask of Pure Death", itemId: 22866, spellHints: ["pure death"] },
  { name: "Flask of Relentless Assault", itemId: 22854, spellHints: ["relentless assault"] },
  { name: "Flask of Blinding Light", itemId: 22861, spellHints: ["blinding light"] },
  { name: "Dark Rune", itemId: 20520, spellHints: ["dark rune"] },
  { name: "Demonic Rune", itemId: 12662, spellHints: ["demonic rune"] },
  { name: "Flame Cap", itemId: 22788, spellHints: ["flame cap"] },
];

const id = process.env.WCL_CLIENT_ID;
const secret = process.env.WCL_CLIENT_SECRET;
const code = process.argv[2] || "BDKHQNwdbmz2Af1v";
const fightArg = process.argv[3] || "all";

const tokenRes = await fetch("https://www.warcraftlogs.com/oauth/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
  },
  body: "grant_type=client_credentials",
});
const { access_token } = await tokenRes.json();

async function gql(query, variables) {
  const r = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ query, variables }),
  });
  const p = await r.json();
  if (p.errors) throw new Error(JSON.stringify(p.errors));
  return p.data;
}

const meta = await gql(
  `query($code:String!){ reportData { report(code:$code) {
    title
    fights { id name kill encounterID startTime endTime }
    masterData { actors { id name type } abilities { gameID name type } }
  } } }`,
  { code }
);
const report = meta.reportData.report;
const actors = new Map(
  report.masterData.actors.filter((a) => String(a.type).toLowerCase() === "player").map((a) => [a.id, a.name])
);
const abilities = report.masterData.abilities || [];

console.log("Report:", report.title);

const matchedAbilities = [];
for (const t of TARGETS) {
  const hits = abilities.filter((a) => {
    const n = String(a.name || "").toLowerCase();
    return t.spellHints.some((h) => n.includes(h)) || n === t.name.toLowerCase();
  });
  console.log(`\n${t.name} (item ${t.itemId}):`, hits.map((a) => `${a.gameID}=${a.name}`).join(", ") || "NOT FOUND");
  for (const h of hits) matchedAbilities.push({ ...t, gameID: h.gameID, wclName: h.name });
}

const spellIds = [...new Set(matchedAbilities.map((a) => a.gameID))];
const idFilter = spellIds.map((id) => `ability.id=${id}`).join(" OR ");
const filterCast = `type='cast' and (${idFilter})`;
const filterBuff = `type in ('applybuff','refreshbuff') and (${idFilter})`;

const killFights =
  fightArg === "all"
    ? report.fights.filter((f) => f.kill && Number(f.encounterID) > 0)
    : report.fights.filter((f) => Number(f.id) === Number(fightArg));

const fightIds = killFights.map((f) => f.id);
console.log("\nScanning fights:", fightIds.length, killFights.map((f) => f.name).slice(0, 5).join(", "));

async function fetchEvents(filterExpression, fightIDs) {
  /** @type {object[]} */
  const all = [];
  let start = 0;
  const end = 999999999;
  for (let page = 0; page < 20; page++) {
    const ev = await gql(
      `query($code:String!,$fid:[Int!],$st:Float,$en:Float,$filter:String!) {
        reportData { report(code:$code) {
          events(fightIDs:$fid, startTime:$st, endTime:$en, limit:10000, filterExpression:$filter) {
            data nextPageTimestamp
          }
        } } }`,
      { code, fid: fightIDs, st: start, en: end, filter: filterExpression }
    );
    const data = ev.reportData.report.events.data || [];
    all.push(...data);
    const next = ev.reportData.report.events.nextPageTimestamp;
    if (!Number.isFinite(Number(next)) || data.length < 10000) break;
    start = Number(next);
  }
  return all;
}

const casts = await fetchEvents(filterCast, fightIds);
const buffs = await fetchEvents(filterBuff, fightIds);
console.log("\nCast events:", casts.length, "Buff events:", buffs.length);

// Also scan ALL casts for scroll / fel mana names not in masterData filter
const allCasts = await fetchEvents("type='cast'", fightIds);
const castNameCounts = new Map();
for (const e of allCasts) {
  const gid = Number(e.abilityGameID || 0);
  const n = abilities.find((a) => a.gameID === gid)?.name || `gid:${gid}`;
  if (/scroll|fel mana|super mana|restoration/i.test(n)) {
    castNameCounts.set(`${gid}=${n}`, (castNameCounts.get(`${gid}=${n}`) || 0) + 1);
  }
}
if (castNameCounts.size) {
  console.log("\nScroll/mana-like casts in log:");
  for (const [k, v] of [...castNameCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x ${k}`);
}

/** @type {Map<string, Map<string, number>>} */
const byPlayer = new Map();
function bump(player, consumable, n = 1) {
  if (!byPlayer.has(player)) byPlayer.set(player, new Map());
  const row = byPlayer.get(player);
  row.set(consumable, (row.get(consumable) || 0) + n);
}

function resolveConsumable(gameId, abilityName) {
  const hit = matchedAbilities.find((a) => a.gameID === gameId);
  if (hit) return hit.name;
  const n = String(abilityName || "").toLowerCase();
  for (const t of TARGETS) {
    if (t.spellHints.some((h) => n.includes(h))) return t.name;
  }
  return null;
}

for (const e of [...casts, ...buffs]) {
  const gid = Number(e.abilityGameID || e.ability?.gameID || 0);
  const player = actors.get(Number(e.sourceID)) || actors.get(Number(e.targetID)) || `id:${e.sourceID || e.targetID}`;
  const label = resolveConsumable(gid, abilities.find((a) => a.gameID === gid)?.name);
  if (!label) continue;
  bump(player, label);
}

console.log("\nPer-player usage (casts + buff applies):");
for (const [player, counts] of [...byPlayer.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const parts = [...counts.entries()].map(([k, v]) => `${k}:${v}`).join(", ");
  console.log(`  ${player}: ${parts}`);
}
