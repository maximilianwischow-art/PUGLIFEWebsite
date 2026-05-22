import {
  DEBUFF_CATEGORIES,
  DEBUFF_OR_GROUP_LABELS,
  IMPORTANT_DEBUFFS,
  debuffOrGroupsForApi,
} from "./important-debuffs.mjs";

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** @typedef {{ name: string, className: string, specName: string, roleName: string, groupNumber: number, classSlug: string, specSlug: string }} RosterSlotProfile */

/**
 * @param {object} slot
 * @returns {RosterSlotProfile|null}
 */
export function rosterSlotProfileFromCompSlot(slot) {
  if (!slot || slot.isBlocker || slot.isEmpty || !slot.isKnownSignup) return null;
  const name = String(slot.displayCharacterName || slot.name || "").trim();
  if (!name) return null;
  const className = String(slot.className || "").trim();
  const specName = String(slot.specName || "").trim();
  const roleName = String(slot.roleName || "").trim();
  const classSlug = classSlugFromDisplay(className, specName);
  const specSlug = norm(specName);
  return {
    name,
    className,
    specName,
    roleName,
    groupNumber: Math.max(1, Math.floor(Number(slot.groupNumber || 0))),
    classSlug,
    specSlug,
  };
}

function classSlugFromDisplay(className, specName) {
  const c = norm(className);
  const valid = new Set([
    "warrior",
    "paladin",
    "hunter",
    "rogue",
    "priest",
    "shaman",
    "mage",
    "warlock",
    "druid",
    "deathknight",
  ]);
  if (valid.has(c)) return c;
  const spec = norm(specName);
  const hint = {
    arms: "warrior",
    fury: "warrior",
    protection: "warrior",
    holy: "paladin",
    retribution: "paladin",
    beastmastery: "hunter",
    marksmanship: "hunter",
    survival: "hunter",
    assassination: "rogue",
    combat: "rogue",
    subtlety: "rogue",
    discipline: "priest",
    shadow: "priest",
    elemental: "shaman",
    enhancement: "shaman",
    restoration: "shaman",
    arcane: "mage",
    fire: "mage",
    frost: "mage",
    affliction: "warlock",
    demonology: "warlock",
    destruction: "warlock",
    balance: "druid",
    feral: "druid",
    guardian: "druid",
  };
  return hint[spec] || "";
}

function providerKeyFromAppliedBy(appliedBy) {
  const s = String(appliedBy || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s.includes("feral") && s.includes("druid")) return "feral-druid";
  if (s.includes("survival") && s.includes("hunter")) return "survival-hunter";
  if (s.includes("fire") && s.includes("mage")) return "fire-mage";
  if (s.includes("shadow") && s.includes("priest")) return "shadow-priest";
  if (s.includes("thunderfury") || (s.includes("warrior") && s.includes("/"))) return "warrior-tc";
  if (s.includes("warrior")) return "warrior";
  if (s.includes("rogue")) return "rogue";
  if (s.includes("druid")) return "druid-balance";
  if (s.includes("hunter")) return "hunter";
  if (s.includes("warlock")) return "warlock";
  if (s.includes("paladin")) return "paladin";
  if (s.includes("mage")) return "mage";
  if (s.includes("priest")) return "priest";
  return norm(s) || "unknown";
}

/**
 * @param {RosterSlotProfile} p
 * @param {string} providerKey
 */
function slotMatchesProvider(p, providerKey) {
  if (!p?.classSlug) return false;
  switch (providerKey) {
    case "warrior":
      return p.classSlug === "warrior";
    case "warrior-tc":
      return p.classSlug === "warrior";
    case "rogue":
      return p.classSlug === "rogue";
    case "druid-balance":
      return (
        p.classSlug === "druid" &&
        (p.specSlug === "balance" || p.specSlug === "boomkin" || (!p.specSlug && p.roleName === "Ranged"))
      );
    case "feral-druid":
      return p.classSlug === "druid" && (p.specSlug === "feral" || p.specSlug === "guardian" || p.roleName === "Tanks");
    case "survival-hunter":
      return p.classSlug === "hunter" && (p.specSlug === "survival" || p.specSlug === "surv");
    case "hunter":
      return p.classSlug === "hunter";
    case "warlock":
      return p.classSlug === "warlock";
    case "paladin":
      return p.classSlug === "paladin";
    case "fire-mage":
      return p.classSlug === "mage" && (p.specSlug === "fire" || (!p.specSlug && p.roleName === "Ranged"));
    case "mage":
      return p.classSlug === "mage";
    case "shadow-priest":
      return p.classSlug === "priest" && (p.specSlug === "shadow" || (!p.specSlug && p.roleName === "Ranged"));
    case "priest":
      return p.classSlug === "priest";
    default:
      return norm(p.className).includes(providerKey) || norm(p.specName).includes(providerKey);
  }
}

function formatRaiderLine(p) {
  const spec = String(p.specName || "").trim();
  const cls = String(p.className || "").trim();
  const meta = spec && cls ? `${spec} · ${cls}` : spec || cls || "—";
  const grp = p.groupNumber ? `G${p.groupNumber}` : "";
  return { label: p.name, meta, groupNumber: p.groupNumber, groupTag: grp };
}

function pickOne(candidates, prefer) {
  if (!candidates.length) return null;
  if (typeof prefer === "function") {
    const hit = candidates.find(prefer);
    if (hit) return hit;
  }
  return [...candidates].sort((a, b) => a.groupNumber - b.groupNumber || a.label.localeCompare(b.label))[0];
}

function pickManyDistinct(candidates, count, usedNames) {
  const out = [];
  const sorted = [...candidates].sort(
    (a, b) => a.groupNumber - b.groupNumber || a.label.localeCompare(b.label)
  );
  for (const c of sorted) {
    if (out.length >= count) break;
    if (usedNames.has(c.label)) continue;
    out.push(c);
    usedNames.add(c.label);
  }
  return out;
}

/**
 * @param {object} compBoard
 * @returns {{ raiders: RosterSlotProfile[], assignments: object[], gaps: object[], orGroups: object[] }}
 */
export function buildDebuffAssignmentsFromCompBoard(compBoard) {
  const profiles = [];
  for (const group of compBoard?.groups || []) {
    const gn = Math.max(1, Math.floor(Number(group?.groupNumber || 0)));
    for (const slot of group?.slots || []) {
      const p = rosterSlotProfileFromCompSlot({ ...slot, groupNumber: gn });
      if (p) profiles.push(p);
    }
  }

  const lines = profiles.map(formatRaiderLine);
  const byProvider = new Map();
  for (const p of profiles) {
    for (const def of IMPORTANT_DEBUFFS) {
      const pk = providerKeyFromAppliedBy(def.appliedBy);
      if (!slotMatchesProvider(p, pk)) continue;
      if (!byProvider.has(pk)) byProvider.set(pk, []);
      const line = formatRaiderLine(p);
      if (!byProvider.get(pk).some((x) => x.label === line.label)) byProvider.get(pk).push(line);
    }
  }

  const usedPaladinJudges = new Set();
  const assignments = [];
  const gaps = [];

  const addRow = (def, primary, backups = [], extra = {}) => {
    assignments.push({
      key: def.key,
      name: def.name,
      category: def.category,
      categoryLabel: DEBUFF_CATEGORIES.find((c) => c.id === def.category)?.label || def.category,
      appliedBy: def.appliedBy,
      description: def.description,
      orGroup: def.orGroup || null,
      orNote: def.orNote || null,
      primary: primary || null,
      backups,
      ...extra,
    });
    if (!primary) {
      gaps.push({
        key: def.key,
        name: def.name,
        appliedBy: def.appliedBy,
        orGroup: def.orGroup || null,
      });
    }
  };

  const warriors = byProvider.get("warrior") || [];
  const rogues = byProvider.get("rogue") || [];
  const exposeRogue = pickOne(rogues, (r) => /combat/i.test(r.meta));
  const sunderWarrior = pickOne(warriors, (r) => /fury|arms|prot|protection/i.test(r.meta)) || pickOne(warriors);

  if (exposeRogue) {
    addRow(
      IMPORTANT_DEBUFFS.find((d) => d.key === "expose-armor"),
      exposeRogue,
      sunderWarrior && sunderWarrior.label !== exposeRogue.label ? [sunderWarrior] : [],
      { orGroupLabel: DEBUFF_OR_GROUP_LABELS["armor-major"], roleNote: "Primary armor reduction (overwrites Sunder)" }
    );
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "sunder-armor"), null, [], {
      orGroupLabel: DEBUFF_OR_GROUP_LABELS["armor-major"],
      roleNote: "Not needed while Expose Armor is active",
      skipped: true,
    });
  } else if (sunderWarrior) {
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "sunder-armor"), sunderWarrior, [], {
      orGroupLabel: DEBUFF_OR_GROUP_LABELS["armor-major"],
      roleNote: "Primary armor reduction (no Combat Rogue on roster)",
    });
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "expose-armor"), null, [], {
      orGroupLabel: DEBUFF_OR_GROUP_LABELS["armor-major"],
      skipped: true,
    });
  } else {
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "expose-armor"), null, []);
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "sunder-armor"), null, []);
  }

  for (const def of IMPORTANT_DEBUFFS) {
    if (def.key === "expose-armor" || def.key === "sunder-armor") continue;
    if (def.orGroup === "demo") continue;

    const pk = providerKeyFromAppliedBy(def.appliedBy);
    let candidates = byProvider.get(pk) || [];

    if (def.key === "judgment-of-the-crusader" || def.key === "judgment-of-wisdom") {
      const paladins = byProvider.get("paladin") || [];
      const picked = pickManyDistinct(paladins, 1, usedPaladinJudges)[0] || null;
      if (picked) usedPaladinJudges.add(picked.label);
      addRow(def, picked, paladins.filter((p) => p.label !== picked?.label));
      continue;
    }

    if (def.key === "misery" || def.key === "shadow-weaving") {
      const sp = pickOne(candidates, (r) => /shadow/i.test(r.meta));
      const existing = assignments.find((a) => a.key === "shadow-weaving" || a.key === "misery");
      if (existing?.primary) {
        addRow(def, existing.primary, [], { roleNote: "Same player as other Shadow Priest debuffs" });
        continue;
      }
      addRow(def, sp, candidates.filter((c) => c.label !== sp?.label));
      continue;
    }

    if (def.key === "curse-of-the-elements" || def.key === "curse-of-recklessness") {
      const locks = byProvider.get("warlock") || [];
      const existing = assignments.find(
        (a) => a.key === "curse-of-the-elements" || a.key === "curse-of-recklessness"
      );
      if (existing?.primary) {
        addRow(def, existing.primary, locks.filter((c) => c.label !== existing.primary.label), {
          roleNote: "Same Warlock maintains both curses",
        });
        continue;
      }
      const primary = pickOne(locks);
      addRow(def, primary, locks.filter((c) => c.label !== primary?.label));
      continue;
    }

    const primary = pickOne(candidates);
    addRow(def, primary, candidates.filter((c) => c.label !== primary?.label));
  }

  const demoWarrior = pickOne(warriors);
  const demoFeral = pickOne(byProvider.get("feral-druid") || [], (r) => /feral|guardian|bear/i.test(r.meta));
  if (demoWarrior) {
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "demoralizing-shout"), demoWarrior, demoFeral ? [demoFeral] : [], {
      orGroupLabel: DEBUFF_OR_GROUP_LABELS.demo,
      roleNote: "Primary Demo (Warrior preferred)",
    });
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "demoralizing-roar"), null, [], {
      orGroupLabel: DEBUFF_OR_GROUP_LABELS.demo,
      skipped: true,
    });
  } else if (demoFeral) {
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "demoralizing-roar"), demoFeral, [], {
      orGroupLabel: DEBUFF_OR_GROUP_LABELS.demo,
    });
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "demoralizing-shout"), null, [], {
      orGroupLabel: DEBUFF_OR_GROUP_LABELS.demo,
      skipped: true,
    });
  } else {
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "demoralizing-shout"), null, []);
    addRow(IMPORTANT_DEBUFFS.find((d) => d.key === "demoralizing-roar"), null, []);
  }

  return {
    raiderCount: profiles.length,
    raiders: lines,
    assignments: assignments.filter((a) => !a.skipped),
    skipped: assignments.filter((a) => a.skipped),
    gaps,
    orGroups: debuffOrGroupsForApi(
      IMPORTANT_DEBUFFS.map((row) => ({
        key: row.key,
        orGroup: row.orGroup,
        name: row.name,
      }))
    ),
  };
}
