/** WCL log for the first guild evening clearing SSC and TK (TBC Classic Anniversary). */
export const DOUBLE_TROUBLE_REPORT_CODE = "1C8XmybLW46kT39D";
export const DOUBLE_TROUBLE_WCL_URL = `https://fresh.warcraftlogs.com/reports/${DOUBLE_TROUBLE_REPORT_CODE}`;

/** Linked achievement badge combos — each part is its own badge id + icon. */
export const ACHIEVEMENT_BADGE_COMBOS = [
  {
    id: "double-trouble",
    name: "Double Trouble",
    description:
      "First time the raid cleared Serpentshrine Cavern and Tempest Keep in one evening session during TBC Classic Anniversary.",
    reportCode: DOUBLE_TROUBLE_REPORT_CODE,
    wclUrl: DOUBLE_TROUBLE_WCL_URL,
    rarity: "legendary",
    parts: [
      {
        badgeId: "double-trouble-ssc",
        partLabel: "Serpentshrine Cavern",
        icon: "/images/achievements/double-trouble-ssc.png",
      },
      {
        badgeId: "double-trouble-tk",
        partLabel: "Tempest Keep",
        icon: "/images/achievements/double-trouble-tk.png",
      },
    ],
  },
];

export const COMBO_BADGE_IDS = new Set(
  ACHIEVEMENT_BADGE_COMBOS.flatMap((combo) => (combo.parts || []).map((p) => String(p.badgeId || "").trim())).filter(Boolean)
);

/** Canonical `users.id` granted both combo parts for UI testing (Highbullet). */
export const DOUBLE_TROUBLE_TEST_USER_IDS = new Set([22]);

/** @type {Map<string, { combo: object, part: object }>} */
const badgeComboPartIndex = new Map();
for (const combo of ACHIEVEMENT_BADGE_COMBOS) {
  for (const part of combo.parts || []) {
    const id = String(part.badgeId || "").trim();
    if (id) badgeComboPartIndex.set(id, { combo, part });
  }
}

export function badgeComboMetaForBadgeId(badgeId) {
  const id = String(badgeId || "").trim();
  if (!id) return null;
  const hit = badgeComboPartIndex.get(id);
  if (!hit) return null;
  return {
    comboId: hit.combo.id,
    comboName: hit.combo.name,
    comboDescription: hit.combo.description,
    comboRarity: hit.combo.rarity || "legendary",
    comboWclUrl: hit.combo.wclUrl || null,
    partLabel: hit.part.partLabel || "",
    partIndex: (hit.combo.parts || []).findIndex((p) => String(p.badgeId) === id),
  };
}

export function doubleTroublePinnedEvening() {
  return {
    pinned: true,
    reportCode: DOUBLE_TROUBLE_REPORT_CODE,
    wclUrl: DOUBLE_TROUBLE_WCL_URL,
    sscReportCodes: [DOUBLE_TROUBLE_REPORT_CODE],
    tkReportCodes: [DOUBLE_TROUBLE_REPORT_CODE],
  };
}

export function badgeCatalogEntriesFromCombos() {
  return ACHIEVEMENT_BADGE_COMBOS.flatMap((combo) =>
    (combo.parts || []).map((part) => ({
      id: part.badgeId,
      name: `${combo.name} — ${part.partLabel}`,
      icon: part.icon,
      phase: "P2",
      rarity: combo.rarity || "legendary",
      comboId: combo.id,
      comboPartLabel: part.partLabel,
      description: `${combo.description} (${part.partLabel})`,
      wclUrl: combo.wclUrl || null,
      reportCode: combo.reportCode || null,
    }))
  );
}
