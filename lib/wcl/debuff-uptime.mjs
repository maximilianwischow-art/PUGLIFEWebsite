import {
  DEBUFF_CATEGORIES,
  IMPORTANT_ARMOR_DEBUFFS,
  IMPORTANT_DEBUFFS,
  catalogRowSpellIds,
  debuffAbilityNames,
  importantDebuffBySpellId,
  matchImportantDebuffFromEntry,
} from "./important-debuffs.mjs";

/** WCL filter literals: apostrophes in single-quoted strings do not match (use double quotes or ability.id). */
function wclFilterStringLiteral(value) {
  const s = String(value || "").trim();
  if (!s) return "''";
  if (s.includes("'")) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export {
  DEBUFF_CATEGORIES,
  IMPORTANT_ARMOR_DEBUFFS,
  IMPORTANT_DEBUFFS,
  importantDebuffBySpellId,
  matchImportantDebuffFromEntry,
};

const REPORT_FIGHTS_QUERY = `
  query WclDebuffReportFights($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
        archiveStatus {
          isArchived
          isAccessible
          archiveDate
        }
        fights {
          id
          encounterID
          name
          kill
          bossPercentage
          startTime
          endTime
          difficulty
        }
      }
    }
  }
`;

const DEBUFF_TABLE_BY_TARGET_QUERY = `
  query WclDebuffTableTarget($code: String!, $fightIds: [Int!]!, $filter: String!) {
    reportData {
      report(code: $code) {
        debuffs: table(dataType: Debuffs, fightIDs: $fightIds, viewBy: Target, filterExpression: $filter)
      }
    }
  }
`;

const DEBUFF_APPLIER_EVENTS_QUERY = `
  query WclDebuffApplierEvents($code: String!, $fightIds: [Int!]!, $filter: String!) {
    reportData {
      report(code: $code) {
        masterData {
          actors {
            id
            name
          }
        }
        events(fightIDs: $fightIds, filterExpression: $filter) {
          data
        }
      }
    }
  }
`;

function escapeWclFilterString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** WCL ability names for filters/events (includes British/American judgment variants). */
export function catalogWclAbilityNames(catalogRow) {
  const names = new Set();
  const primary = String(catalogRow?.name || "").trim();
  if (primary) {
    names.add(primary);
    if (/\bjudgment\b/i.test(primary)) {
      names.add(primary.replace(/\bJudgment\b/gi, "Judgement"));
    } else if (/\bjudgement\b/i.test(primary)) {
      names.add(primary.replace(/\bJudgement\b/gi, "Judgment"));
    }
  }
  for (const alt of catalogRow?.wclNames || catalogRow?.abilityNames || []) {
    const s = String(alt || "").trim();
    if (s) names.add(s);
  }
  return [...names];
}

export function buildDebuffEventsFilter() {
  const ids = new Set();
  const names = new Set();
  for (const row of IMPORTANT_DEBUFFS) {
    for (const id of catalogRowSpellIds(row)) ids.add(id);
    if (!catalogRowSpellIds(row).length) {
      for (const name of catalogWclAbilityNames(row)) names.add(name);
    }
  }
  const abilityParts = [];
  if (ids.size) abilityParts.push(`ability.id in (${[...ids].join(", ")})`);
  if (names.size) {
    const quoted = [...names].map((name) => wclFilterStringLiteral(name));
    abilityParts.push(`ability.name in (${quoted.join(", ")})`);
  }
  const abilityExpr =
    abilityParts.length === 1 ? abilityParts[0] : `(${abilityParts.join(" or ")})`;
  return `type in ('applydebuff','refreshdebuff') and ${abilityExpr}`;
}

export function normalizeWclArchiveStatus(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    isArchived: Boolean(raw.isArchived),
    isAccessible: raw.isAccessible !== false,
    archiveDate: raw.archiveDate != null ? String(raw.archiveDate) : null,
  };
}

export function wclArchiveStatusNote(archiveStatus) {
  const row = normalizeWclArchiveStatus(archiveStatus);
  if (!row) return "";
  if (row.isArchived && !row.isAccessible) {
    return " Report is archived and not accessible — debuff tables may be blocked without WCL archive access.";
  }
  if (row.isArchived) {
    const when = row.archiveDate ? ` (${row.archiveDate})` : "";
    return ` Report is archived${when}.`;
  }
  return "";
}

export function parseWclTablePayload(tableValue) {
  if (!tableValue) return null;
  try {
    const parsed = typeof tableValue === "string" ? JSON.parse(tableValue) : tableValue;
    if (parsed?.data && !parsed?.entries && !parsed?.auras) return parsed.data;
    return parsed;
  } catch {
    return null;
  }
}

export function wclTableRows(table) {
  const parsed = parseWclTablePayload(table);
  if (!parsed) return { rows: [], totalTime: 0, parsed: null };
  const rows = Array.isArray(parsed.auras)
    ? parsed.auras
    : Array.isArray(parsed.entries)
      ? parsed.entries
      : [];
  return {
    rows,
    totalTime: Number(parsed.totalTime || 0),
    parsed,
  };
}

function auraUptimePct(aura, totalTime) {
  const fightMs = Number(totalTime || 0);
  const upMs = Number(aura?.totalUptime ?? aura?.uptime ?? 0);
  if (!fightMs || !Number.isFinite(upMs) || upMs < 0) return null;
  return Math.round((upMs / fightMs) * 1000) / 10;
}

function debuffTargetFilter(catalogRow) {
  const ids = catalogRowSpellIds(catalogRow);
  if (ids.length === 1) return `ability.id = ${ids[0]}`;
  if (ids.length > 1) return `ability.id in (${ids.join(", ")})`;
  const names = catalogWclAbilityNames(catalogRow);
  if (!names.length) return "ability.id = 0";
  if (names.length === 1) return `ability.name = ${wclFilterStringLiteral(names[0])}`;
  const quoted = names.map((name) => wclFilterStringLiteral(name)).join(", ");
  return `ability.name in (${quoted})`;
}

function catalogNameKeys(catalogRow) {
  const keys = new Set();
  for (const label of catalogWclAbilityNames(catalogRow)) {
    const key = String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    if (key) keys.add(key);
  }
  return keys;
}

function findAuraForCatalog(rows, catalogRow) {
  const list = Array.isArray(rows) ? rows : [];
  for (const aura of list) {
    const hit = matchImportantDebuffFromEntry(aura);
    if (hit && hit.key === catalogRow.key) return aura;
  }
  const nameKeys = catalogNameKeys(catalogRow);
  if (!nameKeys.size) return null;
  return (
    list.find((aura) => {
      const ek = String(aura?.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      if (!ek) return false;
      for (const nameKey of nameKeys) {
        if (ek === nameKey || ek.includes(nameKey) || nameKey.includes(ek)) return true;
      }
      return false;
    }) || null
  );
}

function topAppliersFromEvents(events, actors, catalogRows) {
  const actorName = new Map(
    (Array.isArray(actors) ? actors : []).map((a) => [Number(a.id), String(a.name || "").trim()])
  );
  const byKey = new Map();
  for (const row of catalogRows) byKey.set(row.key, new Map());

  for (const ev of Array.isArray(events) ? events : []) {
    const gameId = Number(ev?.abilityGameID || ev?.ability?.gameID || 0);
    const catalog = importantDebuffBySpellId(gameId);
    if (!catalog) continue;
    const bucket = byKey.get(catalog.key);
    if (!bucket) continue;
    const sourceId = Number(ev?.sourceID || 0);
    const name = actorName.get(sourceId) || "";
    if (!name) continue;
    bucket.set(name, (bucket.get(name) || 0) + 1);
  }

  const out = new Map();
  for (const [key, bucket] of byKey) {
    const ranked = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
    out.set(key, ranked[0]?.[0] || null);
  }
  return out;
}

export async function fetchDebuffUptimeForFight(reportCode, fightId, { queryWcl } = {}) {
  if (typeof queryWcl !== "function") {
    throw new Error("queryWcl is required");
  }
  const code = String(reportCode || "").trim();
  const fid = Math.floor(Number(fightId));
  if (!code || !Number.isFinite(fid) || fid <= 0) {
    throw new Error("reportCode and fightId are required");
  }

  let applierByKey = new Map();
  try {
    const eventData = await queryWcl(DEBUFF_APPLIER_EVENTS_QUERY, {
      code,
      fightIds: [fid],
      filter: buildDebuffEventsFilter(),
    });
    const report = eventData?.reportData?.report;
    applierByKey = topAppliersFromEvents(
      report?.events?.data,
      report?.masterData?.actors,
      IMPORTANT_DEBUFFS
    );
  } catch {
    applierByKey = new Map();
  }

  const debuffs = [];
  let anyTable = false;

  for (const catalogRow of IMPORTANT_DEBUFFS) {
    let uptimePct = null;
    let present = false;
    try {
      const data = await queryWcl(DEBUFF_TABLE_BY_TARGET_QUERY, {
        code,
        fightIds: [fid],
        filter: debuffTargetFilter(catalogRow),
      });
      const { rows, totalTime } = wclTableRows(data?.reportData?.report?.debuffs);
      if (rows.length) anyTable = true;
      const aura = findAuraForCatalog(rows, catalogRow);
      if (aura) {
        uptimePct = auraUptimePct(aura, totalTime);
        present = uptimePct != null;
      }
    } catch {
      // keep null uptime for this debuff
    }

    debuffs.push({
      key: catalogRow.key,
      spellId: catalogRow.spellId,
      spellIds: catalogRowSpellIds(catalogRow),
      name: catalogRow.name,
      appliedBy: catalogRow.appliedBy,
      appliedByClass: catalogRow.appliedBy,
      category: catalogRow.category,
      description: catalogRow.description,
      uptimePct,
      appliedByPlayer: applierByKey.get(catalogRow.key) || null,
      present,
    });
  }

  return { debuffs, abilityTablePresent: anyTable };
}

export async function loadWclReportFightsForDebuffs(reportCode, { queryWcl } = {}) {
  if (typeof queryWcl !== "function") throw new Error("queryWcl is required");
  const code = String(reportCode || "").trim();
  if (!code) throw new Error("reportCode is required");
  const data = await queryWcl(REPORT_FIGHTS_QUERY, { code });
  const report = data?.reportData?.report;
  if (!report) return null;
  const fights = (Array.isArray(report.fights) ? report.fights : []).map((f) => ({
    id: Number(f.id),
    encounterID: Number(f.encounterID || 0),
    name: String(f.name || "").trim() || `Fight ${f.id}`,
    kill: Boolean(f.kill),
    bossPercentage: Number(f.bossPercentage ?? 0),
    startTime: Number(f.startTime || 0),
    endTime: Number(f.endTime || 0),
    difficulty: Number(f.difficulty || 0),
  }));
  return {
    title: String(report.title || "").trim(),
    archiveStatus: normalizeWclArchiveStatus(report.archiveStatus),
    fights,
  };
}

export function listBossEncountersFromFights(fights) {
  const byEncounter = new Map();
  for (const fight of Array.isArray(fights) ? fights : []) {
    const encounterID = Number(fight.encounterID || 0);
    if (!encounterID) continue;
    const key = String(encounterID);
    if (!byEncounter.has(key)) {
      byEncounter.set(key, {
        encounterId: encounterID,
        name: fight.name,
        killCount: 0,
        wipeCount: 0,
      });
    }
    const row = byEncounter.get(key);
    if (fight.kill) row.killCount += 1;
    else row.wipeCount += 1;
    if (!row.name && fight.name) row.name = fight.name;
  }
  return [...byEncounter.values()].sort((a, b) => a.encounterId - b.encounterId);
}

export function killFightsForEncounter(fights, encounterId, { maxFights = 12 } = {}) {
  const eid = Number(encounterId);
  return (Array.isArray(fights) ? fights : [])
    .filter((f) => Number(f.encounterID) === eid && f.kill && Number(f.id) > 0)
    .sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0))
    .slice(0, Math.max(1, Math.min(24, Math.floor(Number(maxFights) || 12))));
}

export function latestKillFightForEncounter(fights, encounterId) {
  const kills = killFightsForEncounter(fights, encounterId, { maxFights: 24 });
  return kills.length ? kills[kills.length - 1] : null;
}

export function uptimeTier(uptimePct) {
  const n = Number(uptimePct);
  if (!Number.isFinite(n)) return "none";
  if (n >= 90) return "good";
  if (n >= 70) return "warn";
  return "bad";
}

export function wclFightUrl(reportCode, fightId) {
  const code = String(reportCode || "").trim();
  const fid = Math.floor(Number(fightId));
  if (!code || !fid) return null;
  return `https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}#fight=${fid}`;
}
