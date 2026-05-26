import { readFile, writeFile, rename } from "node:fs/promises";
import { scoreDebuffOverview } from "./debuff-scores.mjs";

/** Map WCL report title raid name → short filter key. */
export function debuffTrendRaidKeyFromTitle(eventTitle) {
  const text = String(eventTitle || "").toLowerCase();
  if (!text) return null;
  if (text.includes("serpentshrine") || /\bssc\b/.test(text)) return "ssc";
  if (text.includes("tempest keep") || text.includes("the eye") || /\btk\b/.test(text)) return "tk";
  if (text.includes("karazhan") || /\bkara\b/.test(text)) return "kara";
  if (text.includes("gruul")) return "gruul";
  if (text.includes("magtheridon")) return "mag";
  return null;
}

export function debuffTrendRaidLabel(raidKey) {
  const key = String(raidKey || "").trim();
  const labels = {
    ssc: "SSC",
    tk: "TK",
    kara: "Kara",
    gruul: "Gruul",
    mag: "Mag",
  };
  return labels[key] || key || "—";
}

export function debuffTrendRaidFilterMatches(raidKey, filter) {
  const f = String(filter || "all").trim().toLowerCase();
  if (!f || f === "all") return true;
  return String(raidKey || "").trim().toLowerCase() === f;
}

let storeReady = null;
let writeChain = Promise.resolve();
/** @type {Map<string, object>} */
const byReportCode = new Map();

export function createDebuffTrendSnapshotStore({ filePath }) {
  async function ensureLoaded() {
    if (storeReady) return storeReady;
    storeReady = (async () => {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        const entries =
          parsed && typeof parsed === "object" && parsed.byReportCode ? parsed.byReportCode : {};
        for (const [code, row] of Object.entries(entries)) {
          const key = String(code || "").trim();
          if (!key || !row || typeof row !== "object") continue;
          byReportCode.set(key, row);
        }
      } catch (err) {
        if (err?.code !== "ENOENT") {
          console.warn("[debuff-trends] snapshot load failed:", err?.message || err);
        }
      }
    })();
    return storeReady;
  }

  async function persist() {
    writeChain = writeChain.catch(() => {}).then(async () => {
      const byReportCodeOut = {};
      for (const [k, v] of byReportCode.entries()) byReportCodeOut[k] = v;
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, JSON.stringify({ byReportCode: byReportCodeOut }, null, 2), "utf8");
      await rename(tmp, filePath);
    });
    return writeChain;
  }

  function snapshotFromOverview(overviewPayload, { raidKey = null, startTime = null } = {}) {
    if (!overviewPayload?.ok || overviewPayload?.mode !== "overview") return null;
    const code = String(overviewPayload.reportCode || "").trim();
    if (!code) return null;
    const scores = scoreDebuffOverview(overviewPayload);
    const title = String(overviewPayload.reportTitle || "").trim();
    const rk = raidKey ?? debuffTrendRaidKeyFromTitle(title);
    const st =
      startTime != null && Number.isFinite(Number(startTime))
        ? Number(startTime)
        : Number(overviewPayload.reportStartTime) || null;
    return {
      reportCode: code,
      reportTitle: title || code,
      startTime: st,
      raidKey: rk,
      overallPct: scores.overallPct,
      overallTier: scores.overallTier,
      categoryPct: scores.categoryPct,
      bossesScored: scores.bossesScored,
      bossesTotal: scores.bossesTotal,
      computedAt: Date.now(),
    };
  }

  async function upsertFromOverview(overviewPayload, meta = {}) {
    const snap = snapshotFromOverview(overviewPayload, meta);
    if (!snap || snap.overallPct == null) return null;
    await ensureLoaded();
    byReportCode.set(snap.reportCode, snap);
    void persist().catch((err) => {
      console.warn("[debuff-trends] snapshot persist failed:", err?.message || err);
    });
    return snap;
  }

  async function getSnapshot(reportCode) {
    await ensureLoaded();
    const code = String(reportCode || "").trim();
    return code ? byReportCode.get(code) || null : null;
  }

  async function getAllSnapshots() {
    await ensureLoaded();
    return new Map(byReportCode);
  }

  return {
    ensureLoaded,
    upsertFromOverview,
    getSnapshot,
    getAllSnapshots,
    snapshotFromOverview,
  };
}
