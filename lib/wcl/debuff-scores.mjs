/** Server-side debuff uptime scoring (mirrors public/debuff-uptime.js tier logic). */

export function debuffUptimeTier(uptimePct) {
  const n = Number(uptimePct);
  if (!Number.isFinite(n)) return "none";
  if (n >= 95) return "excellent";
  if (n >= 85) return "good";
  if (n >= 70) return "average";
  if (n >= 50) return "poor";
  return "critical";
}

function findDebuff(debuffs, def) {
  const list = Array.isArray(debuffs) ? debuffs : [];
  return (
    list.find(
      (row) =>
        (def?.key && row?.key === def.key) || Number(row?.spellId) === Number(def?.spellId)
    ) || null
  );
}

function catalogDefsForOrGroup(catalog, orGroupId) {
  const id = String(orGroupId || "").trim();
  if (!id) return [];
  return (Array.isArray(catalog) ? catalog : []).filter((row) => row.orGroup === id);
}

/** Either/or debuffs: sum individual uptimes capped at 100% (they do not stack). */
export function combineOrGroupUptime(debuffs, memberDefs) {
  const pcts = [];
  for (const def of Array.isArray(memberDefs) ? memberDefs : []) {
    const row = findDebuff(debuffs, def);
    const n = Number(row?.uptimePct);
    if (Number.isFinite(n) && n >= 0) pcts.push(n);
  }
  if (!pcts.length) return null;
  if (pcts.every((n) => n === 0)) return 0;
  return Math.min(100, pcts.reduce((sum, n) => sum + n, 0));
}

function collectCatalogUptimeValues(debuffs, catalog, { categoryIds = null } = {}) {
  const values = [];
  const seenOr = new Set();
  const catSet =
    categoryIds == null
      ? null
      : new Set((Array.isArray(categoryIds) ? categoryIds : [categoryIds]).map(String));
  for (const def of Array.isArray(catalog) ? catalog : []) {
    if (catSet && !catSet.has(String(def?.category || ""))) continue;
    const og = String(def?.orGroup || "").trim();
    if (og) {
      if (seenOr.has(og)) continue;
      seenOr.add(og);
      const combined = combineOrGroupUptime(debuffs, catalogDefsForOrGroup(catalog, og));
      if (combined != null && Number.isFinite(combined)) values.push(combined);
      continue;
    }
    const row = findDebuff(debuffs, def);
    if (row?.uptimePct != null && Number.isFinite(Number(row.uptimePct))) {
      values.push(Number(row.uptimePct));
    }
  }
  return values;
}

function averageValues(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** @returns {{ overallPct: number|null, overallTier: string, categoryPct: Record<string, number|null> }} */
export function scoreDebuffBossRow(bossRow, catalog, categoryIds = ["armor", "spell", "attack"]) {
  const debuffs = bossRow?.debuffs;
  const overallValues = collectCatalogUptimeValues(debuffs, catalog);
  const overallPct = averageValues(overallValues);
  const categoryPct = {};
  for (const catId of categoryIds) {
    const vals = collectCatalogUptimeValues(debuffs, catalog, { categoryIds: [catId] });
    categoryPct[catId] = averageValues(vals);
  }
  return {
    overallPct,
    overallTier: overallPct == null ? "none" : debuffUptimeTier(overallPct),
    categoryPct,
  };
}

/**
 * Score a full overview payload (`mode: overview` with `bossRows`).
 * @returns {{
 *   overallPct: number|null,
 *   overallTier: string,
 *   categoryPct: Record<string, number|null>,
 *   bossesScored: number,
 *   bossesTotal: number,
 * }}
 */
export function scoreDebuffOverview(payload, categoryIds = ["armor", "spell", "attack"]) {
  const catalog = Array.isArray(payload?.catalog) ? payload.catalog : [];
  const bossRows = Array.isArray(payload?.bossRows) ? payload.bossRows : [];
  const scoredBosses = [];
  const categorySums = Object.fromEntries(categoryIds.map((id) => [id, []]));

  for (const boss of bossRows) {
    if (boss?.noKills || !boss?.killCount) continue;
    const rowScore = scoreDebuffBossRow(boss, catalog, categoryIds);
    if (rowScore.overallPct == null) continue;
    scoredBosses.push(rowScore.overallPct);
    for (const catId of categoryIds) {
      const v = rowScore.categoryPct[catId];
      if (v != null && Number.isFinite(v)) categorySums[catId].push(v);
    }
  }

  const overallPct = averageValues(scoredBosses);
  const categoryPct = {};
  for (const catId of categoryIds) {
    categoryPct[catId] = averageValues(categorySums[catId]);
  }

  return {
    overallPct,
    overallTier: overallPct == null ? "none" : debuffUptimeTier(overallPct),
    categoryPct,
    bossesScored: scoredBosses.length,
    bossesTotal: bossRows.length,
  };
}
