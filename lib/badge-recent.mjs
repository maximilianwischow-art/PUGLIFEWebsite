import { DOUBLE_TROUBLE_REPORT_CODE } from "./badge-combos.mjs";
import { reportStartTimeMs } from "./wcl/import-event-report.mjs";
import {
  badgeStateGetByUserId,
  normaliseRaidAppearanceStartedAtMs,
  raidAppearancesAttendanceWindowByUser,
  raidAppearancesReportStartedAtMs,
} from "./item-needs-db.mjs";

const GUILD_ROLE_BADGE_IDS = new Set([
  "guildlead",
  "raidlead",
  "dpslead",
  "heallead",
  "core",
  "veteran",
  "grunt",
  "peon",
  "master-crafter-tailoring",
  "master-crafter-leatherworking",
  "master-crafter-blacksmithing",
  "portal",
]);

/** Badges whose earn time is historical — never pulse from sync `first_earned_at` alone. */
const NEVER_RECENT_BY_FIRST_EARNED = new Set([
  "hall-of-fame",
  "best-time-participant",
  "most-deaths-last-6-raids",
  "iron-attendance",
  "parsing-ceiling-tank",
  "parsing-ceiling-heal",
  "parsing-ceiling-dps",
  "kara-first-time-clear",
  "gruul-first-time-clear",
  "magtheridon-first-time-clear",
]);

/** Hours after the pinned Double Trouble log start that count as the same raid evening. */
const DOUBLE_TROUBLE_EVENING_HOURS = 24;

function parseBadgeEvidence(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function badgeEvidenceReportCode(evidence) {
  if (!evidence || typeof evidence !== "object") return "";
  return String(evidence.reportCode || "").trim();
}

function normalizeRaidStartMs(raw) {
  return normaliseRaidAppearanceStartedAtMs(raw) || Number(raw || 0) || 0;
}

function badgeAchievementAtMs(evidence) {
  if (!evidence || typeof evidence !== "object") return null;
  const startMs = Number(evidence.startMs || 0);
  if (Number.isFinite(startMs) && startMs > 0) return startMs;
  if (evidence.startTime != null) {
    const fromStartTime = reportStartTimeMs(evidence.startTime);
    if (fromStartTime > 0) return fromStartTime;
  }
  const reportCode = badgeEvidenceReportCode(evidence);
  if (reportCode) return raidAppearancesReportStartedAtMs(reportCode);
  return null;
}

function latestRaidWithinEvidenceWindow(evidence, latestRaidStartMs) {
  if (!evidence || typeof evidence !== "object") return false;
  const start = Number(evidence.startMs || 0);
  const end = Number(evidence.endMs || 0);
  if (!Number.isFinite(start) || start <= 0) return false;
  if (!Number.isFinite(end) || end <= 0) return false;
  const latest = normalizeRaidStartMs(latestRaidStartMs);
  if (!latest) return false;
  return latest >= start && latest < end;
}

function resolveDoubleTroubleWindow(evidence) {
  const startMs = Number(evidence?.startMs || 0);
  const endMs = Number(evidence?.endMs || 0);
  if (startMs > 0 && endMs > startMs) {
    return { startMs, endMs };
  }
  const dtStart = raidAppearancesReportStartedAtMs(DOUBLE_TROUBLE_REPORT_CODE);
  if (!dtStart) return null;
  return {
    startMs: dtStart,
    endMs: dtStart + DOUBLE_TROUBLE_EVENING_HOURS * 60 * 60 * 1000,
  };
}

function earliestCuratedRaidStartAfterMs(startMs, orderedReportCodes) {
  const threshold = normalizeRaidStartMs(startMs);
  if (!threshold) return null;
  let earliest = null;
  for (const code of orderedReportCodes || []) {
    const reportStart = raidAppearancesReportStartedAtMs(code);
    if (!reportStart || reportStart < threshold) continue;
    if (earliest == null || reportStart < earliest) earliest = reportStart;
  }
  return earliest;
}

function isDoubleTroubleCelebrationActive(latestRaidStartMs, orderedReportCodes) {
  const window = resolveDoubleTroubleWindow(null);
  if (!window) return false;
  const latest = normalizeRaidStartMs(latestRaidStartMs);
  if (!latest) return false;

  if (latestRaidWithinEvidenceWindow(window, latest)) return true;

  // Keep pulsing through the first curated raid after the pinned evening ends.
  const firstRaidAfterEvening = earliestCuratedRaidStartAfterMs(window.endMs, orderedReportCodes);
  if (firstRaidAfterEvening != null && Math.abs(latest - firstRaidAfterEvening) < 60_000) {
    return true;
  }

  return false;
}

function isNeverRecentBadgeId(badgeId) {
  const id = String(badgeId || "").trim();
  if (!id || GUILD_ROLE_BADGE_IDS.has(id)) return true;
  if (NEVER_RECENT_BY_FIRST_EARNED.has(id)) return true;
  if (id.startsWith("raids-with-guild-")) return true;
  return false;
}

function isRecentDoubleTroubleRow(evidence, firstEarnedAt, latestReportCode, latestRaidStartMs, orderedReportCodes) {
  const evidenceCode = badgeEvidenceReportCode(evidence);
  const latest = normalizeRaidStartMs(latestRaidStartMs);

  if (latestReportCode && evidenceCode && evidenceCode === latestReportCode) {
    return true;
  }

  if (isDoubleTroubleCelebrationActive(latest, orderedReportCodes)) {
    return true;
  }

  if (latest > 0 && firstEarnedAt >= latest) {
    return true;
  }

  return false;
}

function isRecentBadgeRow(row, latestReportCode, latestRaidStartMs, orderedReportCodes) {
  const badgeId = String(row?.badgeId || "").trim();
  if (!badgeId || isNeverRecentBadgeId(badgeId)) return false;

  const evidence = parseBadgeEvidence(row?.evidenceJson);
  const evidenceCode = badgeEvidenceReportCode(evidence);
  const evidenceType = String(evidence?.type || "").trim();
  const firstEarnedAt = Number(row?.firstEarnedAt || 0) || 0;
  const latest = normalizeRaidStartMs(latestRaidStartMs);

  if (latestReportCode && evidenceCode && evidenceCode === latestReportCode) {
    return true;
  }

  if (evidenceType === "double-trouble") {
    return isRecentDoubleTroubleRow(
      evidence,
      firstEarnedAt,
      latestReportCode,
      latest,
      orderedReportCodes
    );
  }

  if (latest <= 0 || firstEarnedAt < latest) {
    return false;
  }

  if (evidenceType === "specific-raid-attendance") {
    return latestRaidWithinEvidenceWindow(evidence, latest);
  }

  if (evidenceType === "raid-milestone") {
    return false;
  }

  // First-clear evidence (no `type` field): only pulse when that clear happened on the latest raid.
  if (Array.isArray(evidence?.participants)) {
    const achievementAt = badgeAchievementAtMs(evidence);
    return (
      Boolean(latestReportCode && evidenceCode && evidenceCode === latestReportCode) &&
      achievementAt != null &&
      achievementAt >= latest
    );
  }

  const achievementAt = badgeAchievementAtMs(evidence);
  if (achievementAt == null || achievementAt < latest) {
    return false;
  }

  return Boolean(latestReportCode && evidenceCode && evidenceCode === latestReportCode);
}

/**
 * Resolve the newest curated guild raid report (same scope as leaderboard Events).
 * @param {{ reportCodes?: string[] }} [opts]
 */
export function resolveLatestRaidContext({ reportCodes } = {}) {
  const filter = Array.isArray(reportCodes)
    ? reportCodes.map((x) => String(x || "").trim()).filter(Boolean)
    : null;
  const window = raidAppearancesAttendanceWindowByUser({
    reportCodes: filter && filter.length ? filter : undefined,
    recentLimit: 40,
  });
  const latest = window?.latestReport || null;
  const reportCode = String(latest?.reportCode || "").trim();
  const startMs = normalizeRaidStartMs(latest?.reportStartedAt) || null;
  if (!reportCode) return null;
  return {
    reportCode,
    startMs,
    orderedReportCodes: Array.isArray(window?.orderedReportCodes) ? window.orderedReportCodes : [],
  };
}

/**
 * Achievement badge ids newly earned by the player since the latest curated raid night.
 * @param {number} userId
 * @param {{ reportCode: string, startMs?: number|null, orderedReportCodes?: string[] } | null} latestRaidContext
 */
export function recentBadgeIdsForUser(userId, latestRaidContext) {
  /** @type {Set<string>} */
  const out = new Set();
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return out;
  const ctx = latestRaidContext && typeof latestRaidContext === "object" ? latestRaidContext : null;
  const latestReportCode = String(ctx?.reportCode || "").trim();
  const latestRaidStartMs = normalizeRaidStartMs(ctx?.startMs);
  const orderedReportCodes = Array.isArray(ctx?.orderedReportCodes) ? ctx.orderedReportCodes : [];
  if (!latestReportCode && !latestRaidStartMs) return out;

  for (const row of badgeStateGetByUserId(uid) || []) {
    const earned = row?.earned === 1 || row?.earned === true || row?.earned === "1";
    if (!earned) continue;
    const badgeId = String(row?.badgeId || "").trim();
    if (!badgeId || GUILD_ROLE_BADGE_IDS.has(badgeId)) continue;
    if (isRecentBadgeRow(row, latestReportCode, latestRaidStartMs, orderedReportCodes)) {
      out.add(badgeId);
    }
  }
  return out;
}

export function recentBadgeIdsArrayForUser(userId, latestRaidContext) {
  return [...recentBadgeIdsForUser(userId, latestRaidContext)];
}
