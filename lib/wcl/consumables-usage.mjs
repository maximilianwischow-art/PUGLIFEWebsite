import {
  TBC_USAGE_CONSUMABLES,
  usageConsumableCatalogForApi,
  usageConsumableRowFromSpellId,
  buildUsageConsumablesEventsFilter,
} from "./tbc-usage-consumables.mjs";

export { usageConsumableCatalogForApi, TBC_USAGE_CONSUMABLES };

const USAGE_EVENTS_QUERY = `
  query WclConsumablesUsage(
    $code: String!
    $fightIds: [Int!]!
    $startTime: Float!
    $endTime: Float!
    $filter: String!
  ) {
    reportData {
      report(code: $code) {
        masterData {
          actors {
            id
            name
            type
          }
        }
        damageDone: table(dataType: DamageDone, fightIDs: $fightIds, viewBy: Source)
        events(
          fightIDs: $fightIds
          startTime: $startTime
          endTime: $endTime
          limit: 10000
          filterExpression: $filter
        ) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`;

function parseWclTableEntries(tableValue) {
  if (!tableValue) return [];
  try {
    const parsed = typeof tableValue === "string" ? JSON.parse(tableValue) : tableValue;
    const data = parsed?.data && !parsed?.entries ? parsed.data : parsed;
    if (Array.isArray(data?.entries)) return data.entries;
    return [];
  } catch {
    return [];
  }
}

function actorNameMap(actors) {
  return new Map(
    (Array.isArray(actors) ? actors : [])
      .filter((a) => String(a?.type || "").toLowerCase() === "player")
      .map((a) => [Number(a.id), String(a.name || "").trim()])
      .filter(([id, name]) => id > 0 && name)
  );
}

function rosterFromDamageTable(tableValue) {
  const names = new Set();
  for (const entry of parseWclTableEntries(tableValue)) {
    const name = String(entry?.name || "").trim();
    const total = Number(entry?.total || 0);
    if (name && Number.isFinite(total) && total > 0) names.add(name);
  }
  return names;
}

function emptyCounts() {
  return Object.fromEntries(TBC_USAGE_CONSUMABLES.map((r) => [r.key, 0]));
}

function playerFromEvent(ev, actorNames) {
  const sourceId = Number(ev?.sourceID ?? 0);
  const targetId = Number(ev?.targetID ?? 0);
  return actorNames.get(sourceId) || actorNames.get(targetId) || null;
}

function eventCountsForRow(type, row) {
  if (row.countMethod === "cast") return type === "cast";
  if (row.countMethod === "buff") return type === "applybuff" || type === "refreshbuff";
  if (row.countMethod === "cast-or-buff") return type === "cast" || type === "applybuff";
  return false;
}

/**
 * Count consumable uses per raider across boss kill fights in a report.
 * @param {string} reportCode
 * @param {object[]} fights - report fights with id, kill, encounterID
 * @param {{ queryWcl: Function, maxFights?: number }} options
 */
export async function fetchConsumablesUsageForReport(reportCode, fights, { queryWcl, maxFights = 80 } = {}) {
  if (typeof queryWcl !== "function") throw new Error("queryWcl is required");
  const code = String(reportCode || "").trim();
  if (!code) throw new Error("reportCode is required");

  const killFights = (Array.isArray(fights) ? fights : [])
    .filter((f) => f?.kill && Number(f?.encounterID || 0) > 0)
    .slice(0, Math.max(1, Number(maxFights) || 80));
  const fightIds = killFights.map((f) => Math.floor(Number(f.id))).filter((id) => id > 0);
  if (!fightIds.length) {
    return {
      players: [],
      rosterCount: 0,
      fightsScanned: 0,
      catalog: usageConsumableCatalogForApi(),
      totalEvents: 0,
    };
  }

  const filter = buildUsageConsumablesEventsFilter({ includeBuffs: true });
  let allEvents = [];
  let report = null;
  let startAt = 0;
  const endTime = 9_999_999_999;
  for (let page = 0; page < 24; page++) {
    const data = await queryWcl(USAGE_EVENTS_QUERY, {
      code,
      fightIds,
      startTime: startAt,
      endTime,
      filter,
    });
    report = data?.reportData?.report;
    const events = report?.events?.data || [];
    allEvents.push(...events);
    if (!events.length || events.length < 10000) break;
    const next = Number(report?.events?.nextPageTimestamp);
    if (!Number.isFinite(next) || next <= startAt) break;
    startAt = next;
  }

  const actorNames = actorNameMap(report?.masterData?.actors || []);
  const roster = rosterFromDamageTable(report?.damageDone);

  /** @type {Map<string, Record<string, number>>} */
  const byPlayer = new Map();

  function ensurePlayer(name) {
    const key = String(name || "").trim();
    if (!key) return null;
    if (!byPlayer.has(key)) byPlayer.set(key, emptyCounts());
    roster.add(key);
    return byPlayer.get(key);
  }

  for (const ev of allEvents) {
    const type = String(ev?.type || "").toLowerCase();
    const spellId = Number(ev?.abilityGameID ?? ev?.ability?.gameID ?? 0);
    const row = usageConsumableRowFromSpellId(spellId);
    if (!row) continue;
    if (!eventCountsForRow(type, row)) continue;

    const player = playerFromEvent(ev, actorNames);
    if (!player) continue;
    const counts = ensurePlayer(player);
    counts[row.key] = (counts[row.key] || 0) + 1;
  }

  for (const name of roster) ensurePlayer(name);

  const players = [...byPlayer.entries()]
    .map(([name, counts]) => {
      const totalUses = Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
      return { name, counts, totalUses };
    })
    .sort((a, b) => {
      if (b.totalUses !== a.totalUses) return b.totalUses - a.totalUses;
      return String(a.name).localeCompare(String(b.name));
    });

  return {
    players,
    rosterCount: players.length,
    fightsScanned: fightIds.length,
    catalog: usageConsumableCatalogForApi(),
    totalEvents: allEvents.length,
  };
}
