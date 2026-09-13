import assert from "node:assert/strict";
import {
  needsDpsSpecPicker,
  publicCatalog,
  rolesForClass,
  specsForRole,
  validateWowForeverPick,
} from "../lib/wow-forever-data.mjs";

const base = {
  race: "orc",
  faction: "horde",
  gender: "male",
  givenName: "Thrall",
};

const shamanDps = validateWowForeverPick({ ...base, classId: "shaman", role: "dps" });
assert.equal(shamanDps.ok, false);
assert.match(shamanDps.error, /Ele|Enhancer|Elemental|Enhancement/);

const shamanEle = validateWowForeverPick({ ...base, classId: "shaman", role: "dps", specId: "ele" });
assert.equal(shamanEle.ok, true);
assert.equal(shamanEle.pick.role, "dps");
assert.equal(shamanEle.pick.specId, "elemental");

const shamanEnh = validateWowForeverPick({
  ...base,
  classId: "shaman",
  role: "dps",
  spec: "enhancer",
});
assert.equal(shamanEnh.ok, true);
assert.equal(shamanEnh.pick.specId, "enhancement");

const shamanHeal = validateWowForeverPick({ ...base, classId: "shaman", role: "heal" });
assert.equal(shamanHeal.ok, true);
assert.equal(shamanHeal.pick.specId, "restoration");

const shamanTank = validateWowForeverPick({ ...base, classId: "shaman", role: "tank" });
assert.equal(shamanTank.ok, false);

const paladinDps = validateWowForeverPick({
  race: "human",
  faction: "alliance",
  gender: "female",
  classId: "paladin",
  role: "dps",
  givenName: "Jaina",
});
assert.equal(paladinDps.ok, true);
assert.equal(paladinDps.pick.specId, "retribution");

const hunter = validateWowForeverPick({
  ...base,
  classId: "hunter",
  role: "dps",
  specId: "bm",
});
assert.equal(hunter.ok, true);
assert.equal(hunter.pick.specId, "beast-mastery");

assert.equal(needsDpsSpecPicker("shaman", "dps"), true);
assert.equal(needsDpsSpecPicker("paladin", "dps"), false);
assert.equal(needsDpsSpecPicker("hunter", "dps"), true);
assert.equal(needsDpsSpecPicker("warrior", "dps"), true);
assert.equal(needsDpsSpecPicker("priest", "dps"), false);

assert.deepEqual(
  rolesForClass("shaman").map((r) => r.id),
  ["dps", "heal"]
);
assert.equal(specsForRole("shaman", "dps").length, 2);

const catalog = publicCatalog();
assert.ok(catalog.roles.some((r) => r.id === "tank"));
assert.equal(catalog.classRoles.shaman.dps.length, 2);

console.log("wow-forever role/spec tests passed");
