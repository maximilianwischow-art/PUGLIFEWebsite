/**
 * CLI wrapper for POST /api/loot-history/events/import logic.
 *
 * Usage: node scripts/add-event-management-report.mjs <reportCodeOrUrl>
 */
import dotenv from "dotenv";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openItemNeedsDb,
  raidAppearancesReplaceForReports,
  raidAppearancesListReports,
} from "../lib/item-needs-db.mjs";
import { fetchEventReportMetaFromWcl } from "../lib/wcl/import-event-report.mjs";

dotenv.config({ override: true });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const gargulPath = path.join(dataDir, "gargul-loot-history.json");

const raw = String(process.argv[2] || "").trim();
if (!raw) {
  console.error("Usage: node scripts/add-event-management-report.mjs <reportCodeOrUrl>");
  process.exit(1);
}

function extractReportCode(reportInput) {
  const value = String(reportInput || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/\/reports\/([A-Za-z0-9]+)/i);
    return match?.[1] || value;
  } catch {
    return value;
  }
}

const code = extractReportCode(raw);
const id = process.env.WCL_CLIENT_ID;
const secret = process.env.WCL_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Missing WCL_CLIENT_ID / WCL_CLIENT_SECRET");
  process.exit(1);
}

const tokenRes = await fetch("https://www.warcraftlogs.com/oauth/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
  },
  body: "grant_type=client_credentials",
});
if (!tokenRes.ok) {
  console.error("WCL token failed:", tokenRes.status, await tokenRes.text());
  process.exit(1);
}
const { access_token } = await tokenRes.json();

async function queryWcl(query, variables) {
  const r = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ query, variables }),
  });
  const p = await r.json();
  if (p.errors) throw new Error(JSON.stringify(p.errors, null, 2));
  return p.data;
}

const meta = await fetchEventReportMetaFromWcl({ reportCode: code, queryWcl });

openItemNeedsDb(dataDir);
const appResult = raidAppearancesReplaceForReports({
  reportCodes: [meta.reportCode],
  entries: meta.appearanceEntries,
});

let gargul = { entries: [], selectedReportCodes: [] };
try {
  gargul = JSON.parse(await readFile(gargulPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const existingSelected = Array.isArray(gargul?.selectedReportCodes)
  ? gargul.selectedReportCodes.map((x) => String(x || "").trim()).filter(Boolean)
  : [];

const nextSelected =
  existingSelected.length === 0 ? [] : [...new Set([...existingSelected, meta.reportCode])];

const out = {
  ...gargul,
  entries: Array.isArray(gargul?.entries) ? gargul.entries : [],
  selectedReportCodes: nextSelected,
};

const tmpPath = `${gargulPath}.tmp`;
await writeFile(tmpPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
await rename(tmpPath, gargulPath);

const known = raidAppearancesListReports({ limit: 500 }).map((r) => r.reportCode);

console.log(
  JSON.stringify(
    {
      ok: true,
      reportCode: meta.reportCode,
      title: meta.title,
      startTime: meta.startTimeMs,
      rankedCharacters: meta.rankedCount,
      raidAppearancesRowsWritten: appResult?.rows ?? 0,
      eventManagementSelectedBefore: existingSelected.length,
      eventManagementSelectedAfter: nextSelected.length,
      inEventManagementSelection: nextSelected.length === 0 || nextSelected.includes(meta.reportCode),
      knownMaterialisedReports: known.length,
      reportListedInMaterialised: known.includes(meta.reportCode),
    },
    null,
    2
  )
);
