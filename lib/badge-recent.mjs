import { badgeStateGetByUserId, raidAppearancesAttendanceWindowByUser } from "./item-needs-db.mjs";

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
 * Achievement badge ids earned during the latest curated raid night.
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
    const badgeId = String(row?.badgeId || "").trim();
    if (!badgeId || GUILD_ROLE_BADGE_IDS.has(badgeId)) continue;
    const earned = row?.earned === 1 || row?.earned === true || row?.earned === "1";
    if (!earned) continue;

    const evidence = parseBadgeEvidence(row?.evidenceJson);
    const evidenceCode = badgeEvidenceReportCode(evidence);
    if (latestReportCode && evidenceCode && evidenceCode === latestReportCode) {
      out.add(badgeId);
      continue;
    }

    const firstEarnedAt = Number(row?.firstEarnedAt || 0) || 0;
    if (latestRaidStartMs > 0 && firstEarnedAt >= latestRaidStartMs) {
      out.add(badgeId);
    }
  }
  return out;
}

export function recentBadgeIdsArrayForUser(userId, latestRaidContext) {
  return [...recentBadgeIdsForUser(userId, latestRaidContext)];
}
