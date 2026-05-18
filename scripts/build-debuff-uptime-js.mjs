import fs from "fs";

const src = fs.readFileSync("public/admin.js", "utf8").split("\n");

const header = `function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

${src.slice(316, 322).join("\n")}

${src.slice(392, 399).join("\n")}

${src.slice(404, 418).join("\n")}

${src.slice(443, 448).join("\n")}

const WCL_DEBUFF_API = "/api/raid-lead/wcl-debuff-uptime";
let allRaidsState = [];
let selectedReportCodesState = new Set();

`;

const debuffCore = [
  ...src.slice(5257, 5283),
  "",
  ...src.slice(5489, 6121),
].join("\n");

const footer = `
async function loadRaidLeadEventReports() {
  const payload = await getJson("/api/raid-lead/event-reports");
  allRaidsState = Array.isArray(payload?.allRaids) ? payload.allRaids : [];
  selectedReportCodesState = new Set(
    Array.isArray(payload?.selectedReportCodes) ? payload.selectedReportCodes : []
  );
}

async function bootDebuffUptimePage() {
  try {
    await loadRaidLeadEventReports();
    await initWclDebuffUptimePanel();
  } catch (error) {
    setWclDebuffStatusLine(error?.message || "Failed to load debuff uptime.");
  }
}

${src.slice(9726, 9749).join("\n")}

bootDebuffUptimePage();
`;

let out = header + debuffCore + footer;
out = out.replaceAll("/api/admin/wcl-debuff-uptime", "${WCL_DEBUFF_API}");
out = out.replaceAll(
  "No Event Management reports — check Roster &amp; Loot → Event Management",
  "No raid reports in the Event Management selection"
);
out = out.replace(/\n\s*status\([^)]*\);\n/g, "\n");

fs.writeFileSync("public/debuff-uptime.js", out);
console.log("wrote public/debuff-uptime.js", out.length, "chars");
