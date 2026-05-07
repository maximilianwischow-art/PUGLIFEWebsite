import path from "node:path";
import {
  openItemNeedsDb,
  identityResolveProfilesByCharacterNames,
  profileGetByUserId,
  userGetByRaidHelperKey,
  rhNameKey,
} from "../lib/item-needs-db.mjs";

openItemNeedsDb(path.resolve("./data"));

console.log("rhNameKey('Glutelf'):", rhNameKey("Glutelf"));
console.log("userGetByRaidHelperKey:", userGetByRaidHelperKey(rhNameKey("Glutelf")));
console.log("profileGetByUserId('648969752810618910'):", profileGetByUserId("648969752810618910"));
console.log(
  "identityResolveProfilesByCharacterNames(['Glutelf']):",
  identityResolveProfilesByCharacterNames(["Glutelf"])
);
