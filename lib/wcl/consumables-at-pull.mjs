import {
  CONSUMABLE_CATEGORIES,
  consumableCatalogForApi,
  consumableSlotFromRow,
  emptyConsumableSlot,
  matchConsumableFromEvent,
} from "./tbc-consumables.mjs";
import { wclFightUrl } from "./debuff-uptime.mjs";

export { CONSUMABLE_CATEGORIES, consumableCatalogForApi, wclFightUrl };

const CONSUMABLE_PULL_QUERY = `
  query WclConsumablesAtPull(
    $code: String!
    $fightId: Int!
    $startTime: Float!
    $endTime: Float!
  ) {
    reportData {
      report(code: $code) {
        masterData {
          actors {
            id
            name
            type
          }
          abilities {
            gameID
            name
          }
        }
        damageDone: table(dataType: DamageDone, fightIDs: [$fightId], viewBy: Source)
        events(
          fightIDs: [$fightId]
          startTime: $startTime
          endTime: $endTime
          limit: 120
          filterExpression: "type='combatantinfo'"
        ) {
          data
        }
      }
    }
  }
`;

/** Window around fight start for combatantinfo snapshots (ms). */
export const CONSUMABLE_COMBATANTINFO_WINDOW_MS = 5_000;

function parseWclTableEntries(tableValue) {
  if (!tableValue) return [];
  try {
    const parsed = typeof tableValue === "string" ? JSON.parse(tableValue) : tableValue;
    const data = parsed?.data && !parsed?.entries && !parsed?.auras ? parsed.data : parsed;
    if (Array.isArray(data?.entries)) return data.entries;
    if (Array.isArray(data?.auras)) return data.auras;
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

function rosterFromDamageTable(tableValue, actorNames) {
  const entries = parseWclTableEntries(tableValue);
  const names = new Set();
  const ids = new Set();
  for (const entry of entries) {
    const name = String(entry?.name || "").trim();
    if (!name) continue;
    const total = Number(entry?.total || 0);
    if (!Number.isFinite(total) || total <= 0) continue;
    names.add(name);
    const id = Number(entry?.id);
    if (id > 0) ids.add(id);
  }
  if (!names.size && actorNames?.size) {
    for (const [id, name] of actorNames) {
      names.add(name);
      ids.add(id);
    }
  }
  return { names, ids };
}

/** Everyone in the combatantinfo snapshot at pull (full raid) plus anyone on damage meter. */
function rosterForFightPull(damageDone, ciEvents, actorNames) {
  const fromDamage = rosterFromDamageTable(damageDone, actorNames);
  const names = new Set(fromDamage.names);
  const ids = new Set(fromDamage.ids);
  for (const ev of Array.isArray(ciEvents) ? ciEvents : []) {
    const actorId = Number(ev?.sourceID ?? 0);
    if (!actorId) continue;
    const name = actorNames.get(actorId);
    if (!name) continue;
    ids.add(actorId);
    names.add(name);
  }
  return { names, ids };
}

function applyFlaskCoversElixirs(slots) {
  if (!slots.flask?.ok) return slots;
  if (!slots.battleElixir?.ok) {
    slots.battleElixir = {
      ok: true,
      label: slots.flask.label,
      spellId: slots.flask.spellId,
      key: slots.flask.key,
      viaFlask: true,
    };
  }
  if (!slots.guardianElixir?.ok) {
    slots.guardianElixir = {
      ok: true,
      label: slots.flask.label,
      spellId: slots.flask.spellId,
      key: slots.flask.key,
      viaFlask: true,
    };
  }
  return slots;
}

function deriveMissing(slots) {
  const missing = [];
  if (!slots.flask?.ok) missing.push("flask");
  if (!slots.battleElixir?.ok) missing.push("battle");
  if (!slots.guardianElixir?.ok) missing.push("guardian");
  if (!slots.food?.ok) missing.push("food");
  return missing;
}

function foodRowPickPriority(row) {
  if (!row?.key || row.key === "food-well-fed-generic") return 0;
  return 1;
}

function abilityNameMap(abilities) {
  return new Map(
    (Array.isArray(abilities) ? abilities : [])
      .map((a) => [Number(a.gameID), String(a.name || "").trim()])
      .filter(([id, name]) => id > 0 && name)
  );
}

function consumableSlotFromHit(hit, auraLabel) {
  const slot = consumableSlotFromRow(hit.row);
  if (!slot.ok) return slot;
  const label = String(auraLabel || "").trim();
  const catalog = String(hit.row.name || "").trim();
  // WCL Fresh mislabels some IDs (e.g. 28509 shown as "Greater Versatility"); prefer catalog name.
  if (
    hit.row.key === "guardian-greater-mana-regen" ||
    hit.row.key === "potion-mageblood" ||
    hit.row.key === "elixir-major-mageblood"
  ) {
    return { ...slot, label: catalog, spellId: slot.spellId || hit.row.spellId };
  }
  if (label && !/^well fed$/i.test(label)) {
    if (hit.category === "food" && catalog && label.toLowerCase() !== catalog.toLowerCase()) {
      return { ...slot, label, spellId: slot.spellId || hit.row.spellId };
    }
    if (hit.category !== "food") {
      return { ...slot, label, spellId: slot.spellId || hit.row.spellId };
    }
  }
  if (hit.row.key !== "food-well-fed-generic" && catalog) {
    return { ...slot, label: catalog, spellId: slot.spellId || hit.row.spellId };
  }
  return slot;
}

/**
 * Build flask / elixir / food slots from combatantinfo auras at boss pull.
 * WCL records the full aura list on each player at encounter start — far more
 * reliable than replaying applybuff events (many flasks never emit events).
 */
function slotsFromCombatantInfo(ev, abilityNameByGameId) {
  const slots = {
    flask: emptyConsumableSlot(),
    battleElixir: emptyConsumableSlot(),
    guardianElixir: emptyConsumableSlot(),
    food: emptyConsumableSlot(),
  };
  let foodHit = null;
  let foodLabel = "";

  for (const aura of Array.isArray(ev?.auras) ? ev.auras : []) {
    const gameId = Number(aura?.ability ?? aura?.id ?? 0);
    const auraName =
      String(aura?.name || "").trim() || (gameId > 0 ? abilityNameByGameId.get(gameId) || "" : "");
    const hit = matchConsumableFromEvent(
      { abilityGameID: gameId, ability: { name: auraName } },
      abilityNameByGameId
    );
    if (!hit) continue;

    if (hit.category === "food") {
      const priority = foodRowPickPriority(hit.row);
      if (!foodHit || priority > foodRowPickPriority(foodHit.row)) {
        foodHit = hit;
        foodLabel = auraName || hit.row.name;
      }
      continue;
    }

    const slotKey =
      hit.category === "flask"
        ? "flask"
        : hit.category === "battle"
          ? "battleElixir"
          : hit.category === "guardian"
            ? "guardianElixir"
            : null;
    if (!slotKey || slots[slotKey]?.ok) continue;
    slots[slotKey] = consumableSlotFromHit(hit, auraName);
  }

  if (foodHit) {
    slots.food = consumableSlotFromHit(foodHit, foodLabel);
  }

  applyFlaskCoversElixirs(slots);
  return slots;
}

export async function fetchConsumablesForFight(
  reportCode,
  fight,
  { queryWcl, combatantInfoWindowMs = CONSUMABLE_COMBATANTINFO_WINDOW_MS } = {}
) {
  if (typeof queryWcl !== "function") throw new Error("queryWcl is required");
  const code = String(reportCode || "").trim();
  const fightId = Math.floor(Number(fight?.id));
  const pullTime = Number(fight?.startTime);
  if (!code || !Number.isFinite(fightId) || fightId <= 0 || !Number.isFinite(pullTime)) {
    throw new Error("reportCode and fight with startTime are required");
  }

  const windowPad = Math.max(1000, Number(combatantInfoWindowMs) || CONSUMABLE_COMBATANTINFO_WINDOW_MS);
  const windowStart = Math.max(0, pullTime - windowPad);
  const windowEnd = pullTime + windowPad;

  const data = await queryWcl(CONSUMABLE_PULL_QUERY, {
    code,
    fightId,
    startTime: windowStart,
    endTime: windowEnd,
  });
  const report = data?.reportData?.report;
  const actors = report?.masterData?.actors || [];
  const abilities = report?.masterData?.abilities || [];
  const ciEvents = report?.events?.data || [];
  const abilityNameByGameId = abilityNameMap(abilities);
  const actorNames = actorNameMap(actors);
  const roster = rosterForFightPull(report?.damageDone, ciEvents, actorNames);

  const slotsByActorId = new Map();
  for (const ev of ciEvents) {
    const actorId = Number(ev?.sourceID ?? 0);
    if (!actorId) continue;
    slotsByActorId.set(actorId, slotsFromCombatantInfo(ev, abilityNameByGameId));
  }

  const players = [];
  const seenNames = new Set();

  const targetIds = roster.ids.size ? [...roster.ids] : [...slotsByActorId.keys()];
  for (const targetId of targetIds) {
    const name = actorNames.get(targetId) || "";
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());
    const slots = slotsByActorId.get(targetId) || {
      flask: emptyConsumableSlot(),
      battleElixir: emptyConsumableSlot(),
      guardianElixir: emptyConsumableSlot(),
      food: emptyConsumableSlot(),
    };
    const missing = deriveMissing(slots);
    players.push({
      name,
      actorId: targetId,
      flask: slots.flask,
      battleElixir: slots.battleElixir,
      guardianElixir: slots.guardianElixir,
      food: slots.food,
      missing,
      ready: missing.length === 0,
    });
  }

  for (const name of roster.names) {
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    let actorId = 0;
    for (const [id, n] of actorNames) {
      if (n.toLowerCase() === key) {
        actorId = id;
        break;
      }
    }
    seenNames.add(key);
    const slots =
      actorId && slotsByActorId.has(actorId)
        ? slotsByActorId.get(actorId)
        : {
            flask: emptyConsumableSlot(),
            battleElixir: emptyConsumableSlot(),
            guardianElixir: emptyConsumableSlot(),
            food: emptyConsumableSlot(),
          };
    const missing = deriveMissing(slots);
    players.push({
      name,
      actorId,
      flask: slots.flask,
      battleElixir: slots.battleElixir,
      guardianElixir: slots.guardianElixir,
      food: slots.food,
      missing,
      ready: missing.length === 0,
    });
  }

  players.sort((a, b) => {
    const am = a.missing.length;
    const bm = b.missing.length;
    if (am !== bm) return am - bm;
    return String(a.name).localeCompare(String(b.name));
  });

  const fullyBuffedCount = players.filter((p) => p.ready).length;

  return {
    players,
    rosterCount: players.length,
    fullyBuffedCount,
    windowStart,
    windowEnd,
    pullTime,
    combatantInfoCount: ciEvents.length,
    source: "combatantinfo",
  };
}
