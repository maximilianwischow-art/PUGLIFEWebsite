/**
 * Phase 3 raid overview — Mount Hyjal + Black Temple catalog.
 * Metrics are assembled in server.js from WCL reports.
 */

export {
  phase2ProgressionTone as phase3ProgressionTone,
  formatPhase2Duration as formatPhase3Duration,
  formatPhase2ShortDate as formatPhase3ShortDate,
  formatPhase2ParsePct as formatPhase3ParsePct,
} from "./phase2-raid-overview.mjs";

export const PHASE3_RAID_CATALOG = [
  {
    id: "hyjal",
    raidKey: "Hyjal Summit",
    name: "Battle for Mount Hyjal",
    shortName: "Hyjal",
    size: 25,
    tier: "T6",
    color: "#22C55E",
    imageUrl: "/raid-images/hyjal.png",
    headerImageUrl: "/raid-images/event-header-hyjal.png",
    pbHeaderImageUrl: "/raid-images/pb-header-hyjal.png",
  },
  {
    id: "black-temple",
    raidKey: "Black Temple",
    name: "Black Temple",
    shortName: "BT",
    size: 25,
    tier: "T6",
    color: "#7C3AED",
    imageUrl: "/raid-images/black-temple.png",
    headerImageUrl: "/raid-images/event-header-black-temple.png",
    pbHeaderImageUrl: "/raid-images/pb-header-black-temple.png",
  },
];

export const PHASE3_RAID_BY_KEY = new Map(PHASE3_RAID_CATALOG.map((r) => [r.raidKey, r]));
