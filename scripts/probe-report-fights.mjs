import "dotenv/config";

const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const API_URL = "https://www.warcraftlogs.com/api/v2/client";
const code = process.argv[2] || "BvqA8ZHjngpcDazR";

const id = process.env.WCL_CLIENT_ID;
const secret = process.env.WCL_CLIENT_SECRET;
const tokenRes = await fetch(TOKEN_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
  },
  body: "grant_type=client_credentials",
});
const { access_token: token } = await tokenRes.json();

const q = `query($c: String!) {
  reportData {
    report(code: $c) {
      code title startTime zone { name }
      fights { id encounterID name kill gameZone { name } startTime endTime }
    }
  }
}`;
const r = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ query: q, variables: { c: code } }),
});
const j = await r.json();
if (j.errors) console.error(j.errors);
const rep = j?.data?.reportData?.report;
console.log("code:", rep?.code, "title:", rep?.title, "zone:", rep?.zone?.name);
const ms = Number(rep?.startTime || 0);
const startMs = ms < 100_000_000_000 ? ms * 1000 : ms;
if (startMs) {
  console.log(
    "start:",
    new Date(startMs).toISOString(),
    "Berlin:",
    new Date(startMs).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" })
  );
}
for (const f of rep?.fights || []) {
  if (!Number(f?.encounterID || 0)) continue;
  console.log(
    `  fight ${f.id}: ${f.name} kill=${f.kill} gameZone=${f.gameZone?.name || "(none)"}`
  );
}
// Also show fights with kill but no encounterID (WCL quirks)
const odd = (rep?.fights || []).filter((f) => f.kill && !Number(f?.encounterID || 0));
if (odd.length) {
  console.log("  --- kill but no encounterID ---");
  for (const f of odd) console.log(`  fight ${f.id}: ${f.name} gameZone=${f.gameZone?.name || "(none)"}`);
}
