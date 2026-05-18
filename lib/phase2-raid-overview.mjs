/**
 * Phase 2 raid overview — static catalog + presentation helpers.
 * Metrics are assembled in server.js from WCL reports.
 */

export const PHASE2_RAID_CATALOG = [
  {
    id: "ssc",
    raidKey: "Serpentshrine Cavern",
    name: "Serpentshrine Cavern",
    shortName: "SSC",
    size: 25,
    tier: "T5",
    color: "#0EA5E9",
    imageUrl: "/raid-images/ssc.png",
    headerImageUrl: "/raid-images/event-header-ssc.png?v=20260518ssc-3x1",
    pbHeaderImageUrl: "/raid-images/pb-header-ssc.png",
  },
  {
    id: "tk",
    raidKey: "Tempest Keep",
    name: "Tempest Keep: The Eye",
    shortName: "TK",
    size: 25,
    tier: "T5",
    color: "#8B5CF6",
    imageUrl: "/raid-images/tk.png",
    headerImageUrl: "/raid-images/event-header-tk.png?v=20260518tk-3x1b",
    pbHeaderImageUrl: "/raid-images/pb-header-tk.png",
  },
  {
    id: "kara",
    raidKey: "Karazhan",
    name: "Karazhan",
    shortName: "Kara",
    size: 10,
    tier: "T4",
    color: "#6366F1",
    imageUrl: "/raid-images/kara.png",
    headerImageUrl: "/raid-images/event-header-kara.png",
    pbHeaderImageUrl: "/raid-images/pb-header-kara.png",
  },
  {
    id: "gruul",
    raidKey: "Gruul's Lair",
    name: "Gruul's Lair",
    shortName: "Gruul",
    size: 25,
    tier: "T4",
    color: "#78716C",
    imageUrl: "/raid-images/gruul.png",
    headerImageUrl: "/raid-images/event-header-gruul.png",
    pbHeaderImageUrl: "/raid-images/pb-header-gruul.png",
  },
  {
    id: "mag",
    raidKey: "Magtheridon's Lair",
    name: "Magtheridon's Lair",
    shortName: "Mag",
    size: 25,
    tier: "T4",
    color: "#DC2626",
    imageUrl: "/raid-images/magtheridon.png",
    headerImageUrl: "/raid-images/event-header-magtheridon.png",
    pbHeaderImageUrl: "/raid-images/pb-header-magtheridon.png",
  },
];

export const PHASE2_RAID_BY_KEY = new Map(PHASE2_RAID_CATALOG.map((r) => [r.raidKey, r]));

export function phase2ProgressionTone(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "none";
  if (n >= 100) return "excellent";
  if (n >= 75) return "good";
  if (n >= 50) return "average";
  if (n > 0) return "poor";
  return "critical";
}

export function formatPhase2Duration(ms) {
  const totalSeconds = Math.floor(Number(ms || 0) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatPhase2ShortDate(timestampMs) {
  const ms = Number(timestampMs);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatPhase2ParsePct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}
