import { reportStartTimeMs } from "./wcl/import-event-report.mjs";
import {
  badgeStateGetByUserId,
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
  return latestRaidStartMs >= start && latestRaidStartMs < end;
}

function isNeverRecentBadgeId(badgeId) {
  const id = String(badgeId || "").trim();
  if (!id || GUILD_ROLE_BADGE_IDS.has(id)) return true;
  if (NEVER_RECENT_BY_FIRST_EARNED.has(id)) return true;
  if (id.startsWith("raids-with-guild-")) return true;
  return false;
}

function isRecentBadgeRow(row, latestReportCode, latestRaidStartMs) {
  const badgeId = String(row?.badgeId || "").trim();
  if (!badgeId || isNeverRecentBadgeId(badgeId)) return false;

  const evidence = parseBadgeEvidence(row?.evidenceJson);
  const evidenceCode = badgeEvidenceReportCode(evidence);
  const evidenceType = String(evidence?.type || "").trim();
  const firstEarnedAt = Number(row?.firstEarnedAt || 0) || 0;

  if (latestReportCode && evidenceCode && evidenceCode === latestReportCode) {
    return true;
  }

  if (latestRaidStartMs <= 0 || firstEarnedAt < latestRaidStartMs) {
    return false;
  }

  if (evidenceType === "specific-raid-attendance") {
    return latestRaidWithinEvidenceWindow(evidence, latestRaidStartMs);
  }

  if (evidenceType === "double-trouble") {
    if (latestReportCode && evidenceCode && evidenceCode === latestReportCode) {
      return true;
    }
    return latestRaidWithinEvidenceWindow(evidence, latestRaidStartMs);
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
      achievementAt >= latestRaidStartMs
    );
  }

  const achievementAt = badgeAchievementAtMs(evidence);
  if (achievementAt == null || achievementAt < latestRaidStartMs) {
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
  const startMs = Number(latest?.reportStartedAt || 0) || null;
  if (!reportCode) return null;
  return { reportCode, startMs };
}

/**
 * Achievement badge ids newly earned by the player since the latest curated raid night.
 * @param {number} userId
 * @param {{ reportCode: string, startMs?: number|null } | null} latestRaidContext
 */
export function recentBadgeIdsForUser(userId, latestRaidContext) {
  /** @type {Set<string>} */
  const out = new Set();
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return out;
  const ctx = latestRaidContext && typeof latestRaidContext === "object" ? latestRaidContext : null;
  const latestReportCode = String(ctx?.reportCode || "").trim();
  const latestRaidStartMs = Number(ctx?.startMs || 0) || 0;
  if (!latestReportCode && !latestRaidStartMs) return out;

  for (const row of badgeStateGetByUserId(uid) || []) {
    const earned = row?.earned === 1 || row?.earned === true || row?.earned === "1";
    if (!earned) continue;
    const badgeId = String(row?.badgeId || "").trim();
    if (!badgeId || GUILD_ROLE_BADGE_IDS.has(badgeId)) continue;
    if (isRecentBadgeRow(row, latestReportCode, latestRaidStartMs)) {
      out.add(badgeId);
    }
  }
  return out;
}

export function recentBadgeIdsArrayForUser(userId, latestRaidContext) {
  return [...recentBadgeIdsForUser(userId, latestRaidContext)];
}
