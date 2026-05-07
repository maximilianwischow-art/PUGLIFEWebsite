import "dotenv/config";

const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const API_URL = "https://www.warcraftlogs.com/api/v2/client";
const id = process.env.WCL_CLIENT_ID;
const secret = process.env.WCL_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set WCL_CLIENT_ID + WCL_CLIENT_SECRET in .env");
  process.exit(1);
}

const tokenRes = await fetch(TOKEN_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
  },
  body: "grant_type=client_credentials",
});
const tokenJson = await tokenRes.json();
const token = tokenJson.access_token;
if (!token) {
  console.error("token failed:", tokenJson);
  process.exit(2);
}

const guildId = Number(process.env.VOTING_GUILD_ID || 817080);
const q = `query($g: Int!, $l: Int!) {
  reportData {
    reports(guildID: $g, limit: $l) {
      data {
        code title startTime endTime
        owner { name }
        zone { name }
        rankedCharacters { name }
        fights { id encounterID name kill gameZone { name } }
      }
    }
  }
}`;
const r = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ query: q, variables: { g: guildId, l: 8 } }),
});
const j = await r.json();
const reports = j?.data?.reportData?.reports?.data || [];
for (const rep of reports) {
  const date = new Date(Number(rep.startTime || 0));
  const ranked = (rep.rankedCharacters || []).map((c) => c.name);
  const hasGernig = ranked.includes("Gernig");
  const fights = (rep.fights || []).filter((f) => Number(f?.encounterID || 0) > 0);
  const zones = [...new Set(fights.map((f) => f?.gameZone?.name).filter(Boolean))];
  console.log(
    `${date.toISOString().slice(0, 16)} ${rep.code}  uploader=${rep?.owner?.name || "?"}  zone=${rep?.zone?.name || ""}  bossFights=${fights.length}  zones=[${zones.join(",")}]  rankedHasGernig=${hasGernig}  ranked=${ranked.length}`
  );
}
