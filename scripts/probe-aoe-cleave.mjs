/**
 * Probe `raidAppearancesUserIdsInDateRange` against the local SQLite. Sanity
 * checks both the date-range branch (using the most recent raid we have, on
 * May 3 2026, since May 7 hasn't synced locally yet) and the explicit
 * `reportCodes` branch (using `TPG4gwAHCMp7zadQ` — the May 3 report code).
 */
import { openItemNeedsDb, raidAppearancesUserIdsInDateRange } from "../lib/item-needs-db.mjs";
import path from "node:path";

openItemNeedsDb(path.resolve("./data"));

const knownReportCode = "TPG4gwAHCMp7zadQ";
const startMs = Date.UTC(2026, 4, 3, 0, 0, 0);
const endMs = Date.UTC(2026, 4, 4, 0, 0, 0);

console.log("Sanity window UTC:", new Date(startMs).toISOString(), "->", new Date(endMs).toISOString());
console.log("Pinned report code:", knownReportCode);

const dateOnly = raidAppearancesUserIdsInDateRange({ startMs, endMs });
console.log(`\nDate-only branch (sanity, May 3 window): ${dateOnly.size} users`);

const codeOnly = raidAppearancesUserIdsInDateRange({ reportCodes: [knownReportCode] });
console.log(`Report-code-only branch (sanity, May 3 code): ${codeOnly.size} users`);

const combined = raidAppearancesUserIdsInDateRange({
  startMs,
  endMs,
  reportCodes: [knownReportCode],
});
console.log(`Combined: ${combined.size} users`);

const aoeStartMs = Date.UTC(2026, 4, 6, 22, 0, 0);
const aoeEndMs = Date.UTC(2026, 4, 8, 4, 0, 0);
const aoeReportCodes = ["XVH1LmTWYDq6Zr7t"];

console.log("\n--- AOE Cleave (May 7) ---");
console.log("Window UTC:", new Date(aoeStartMs).toISOString(), "->", new Date(aoeEndMs).toISOString());
console.log("Pinned report codes:", aoeReportCodes);
const aoeCombined = raidAppearancesUserIdsInDateRange({
  startMs: aoeStartMs,
  endMs: aoeEndMs,
  reportCodes: aoeReportCodes,
});
console.log(`AOE Cleave matched users: ${aoeCombined.size}`);
console.log(
  "(0 locally is expected — May 7 raid hasn't been pulled into raid_appearances yet on dev. Render's 15-min sync will populate after deploy.)"
);
