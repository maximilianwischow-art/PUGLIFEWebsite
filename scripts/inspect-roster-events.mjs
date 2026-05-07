const url = "http://localhost:8787/api/wcl/guild/817080/active-roster?limit=40&top=250&maxRhPastEvents=0";
const r = await fetch(url);
if (!r.ok) {
  console.error("HTTP", r.status, await r.text());
  process.exit(1);
}
const body = await r.json();
const players = Array.isArray(body?.players) ? body.players : [];

const sample = players
  .filter((p) => p?.dbUserId)
  .map((p) => ({
    name: p.name || p.characterName,
    dbUserId: p.dbUserId,
    raidsAttended: p.raidsAttended,
    wclEventCount: p.wclEventCount,
    rhPastEventCount: p.rhPastEventCount,
    legacyRhSignupCount: p.legacyRhSignupCount,
  }))
  .sort((a, b) => Number(b.wclEventCount || 0) - Number(a.wclEventCount || 0))
  .slice(0, 10);

console.log("wclEventScope:", JSON.stringify(body?.wclEventScope || null, null, 2));
console.log("\nTop 10 by wclEventCount:");
console.table(sample);

// Find Mightyboom specifically (the earlier issue case)
const mighty = players.find((p) =>
  String(p?.name || p?.characterName || "").toLowerCase().includes("mightyboom")
);
if (mighty) {
  console.log("\nMightyboom row:");
  console.log(
    JSON.stringify(
      {
        name: mighty.name,
        dbUserId: mighty.dbUserId,
        raidsAttended: mighty.raidsAttended,
        wclEventCount: mighty.wclEventCount,
        rhPastEventCount: mighty.rhPastEventCount,
        legacyRhSignupCount: mighty.legacyRhSignupCount,
      },
      null,
      2
    )
  );
}
