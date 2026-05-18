import { IMPORTANT_ARMOR_DEBUFFS, importantDebuffBySpellId, matchImportantDebuffFromEntry } from "./important-debuffs.mjs";

export { IMPORTANT_ARMOR_DEBUFFS, importantDebuffBySpellId, matchImportantDebuffFromEntry };

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

const DEBUFF_TABLE_BY_ABILITY_QUERY = `
  query WclDebuffTableAbility($code: String!, $fightIds: [Int!]!) {
    reportData {
      report(code: $code) {
        debuffs: table(dataType: Debuffs, fightIDs: $fightIds, viewBy: Ability)
      }
    }
  }
`;

const DEBUFF_TABLE_BY_SOURCE_QUERY = `
  query WclDebuffTableSource($code: String!, $fightIds: [Int!]!, $abilityId: Float!) {
    reportData {
      report(code: $code) {
        debuffs: table(dataType: Debuffs, fightIDs: $fightIds, viewBy: Source, abilityID: $abilityId)
      }
    }
  }
`;

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
    if (parsed?.data && !parsed?.entries) return parsed.data;
    return parsed;
  } catch {
    return null;
  }
}

function entryUptimePct(entry) {
  const raw = entry?.uptime;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= 1 && n > 0 && !String(raw).includes("%")) return Math.round(n * 1000) / 10;
  return Math.round(n * 10) / 10;
}

function nestedSources(entry) {
  const raw = entry?.sources ?? entry?.subentries ?? entry?.entries;
  return Array.isArray(raw) ? raw : [];
}

function topApplierFromAbilityEntry(entry) {
  const sources = nestedSources(entry)
    .map((row) => ({
      name: String(row?.name || "").trim(),
      uptime: entryUptimePct(row),
    }))
    .filter((row) => row.name);
  if (!sources.length) return null;
  sources.sort((a, b) => Number(b.uptime || 0) - Number(a.uptime || 0));
  return sources[0];
}

function topApplierFromSourceTable(table, catalogRow) {
  const entries = Array.isArray(table?.entries) ? table.entries : [];
  const scored = entries
    .map((row) => ({
      name: String(row?.name || "").trim(),
      uptime: entryUptimePct(row),
    }))
    .filter((row) => row.name && row.uptime != null);
  if (!scored.length) return null;
  scored.sort((a, b) => Number(b.uptime || 0) - Number(a.uptime || 0));
  return scored[0];
}

function findAbilityEntryForCatalog(table, catalogRow) {
  const entries = Array.isArray(table?.entries) ? table.entries : [];
  for (const entry of entries) {
    const hit = matchImportantDebuffFromEntry(entry);
    if (hit && Number(hit.spellId) === Number(catalogRow.spellId)) return entry;
  }
  const nameKey = String(catalogRow.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return (
    entries.find((entry) => {
      const ek = String(entry?.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      return ek && (ek === nameKey || ek.includes(nameKey));
    }) || null
  );
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

  const abilityData = await queryWcl(DEBUFF_TABLE_BY_ABILITY_QUERY, { code, fightIds: [fid] });
  const abilityRaw = abilityData?.reportData?.report?.debuffs;
  const abilityTable = parseWclTablePayload(abilityRaw);

  const sourceTables = new Map();
  for (const catalogRow of IMPORTANT_ARMOR_DEBUFFS) {
    const entry = findAbilityEntryForCatalog(abilityTable, catalogRow);
    const needsSource = !entry || !topApplierFromAbilityEntry(entry)?.name;
    if (!needsSource) continue;
    try {
      const sourceData = await queryWcl(DEBUFF_TABLE_BY_SOURCE_QUERY, {
        code,
        fightIds: [fid],
        abilityId: Number(catalogRow.spellId),
      });
      sourceTables.set(
        catalogRow.spellId,
        parseWclTablePayload(sourceData?.reportData?.report?.debuffs)
      );
    } catch {
      sourceTables.set(catalogRow.spellId, null);
    }
  }

  const debuffs = [];
  for (const catalogRow of IMPORTANT_ARMOR_DEBUFFS) {
    const entry = findAbilityEntryForCatalog(abilityTable, catalogRow);
    let uptimePct = entry ? entryUptimePct(entry) : null;
    let applier = entry ? topApplierFromAbilityEntry(entry) : null;
    const sourceTable = sourceTables.get(catalogRow.spellId);
    if ((!applier?.name || uptimePct == null) && sourceTable) {
      const fromSource = topApplierFromSourceTable(sourceTable, catalogRow);
      if (fromSource) {
        if (uptimePct == null && fromSource.uptime != null) uptimePct = fromSource.uptime;
        if (!applier?.name) applier = fromSource;
      }
    }
    debuffs.push({
      spellId: catalogRow.spellId,
      name: catalogRow.name,
      appliedByClass: catalogRow.appliedByClass,
      description: catalogRow.description,
      uptimePct,
      appliedByPlayer: applier?.name || null,
      present: uptimePct != null,
    });
  }

  return { debuffs, abilityTablePresent: Boolean(abilityTable?.entries?.length) };
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
