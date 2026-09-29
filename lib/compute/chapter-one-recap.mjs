/** Chapter 1 recap — TBC Classic Horde era, “From Strangers to Community”. */

import { isCoreParseEligibleGuildRole } from "../wcl/parse-development.mjs";

export const CHAPTER_ONE = {
  id: 1,
  title: "From Strangers to Community",
  kicker: "Chapter 1",
  era: "The Burning Crusade Classic",
  faction: "Horde",
  realm: "Thunderstrike EU",
  closeout:
    "We started as strangers on Horde Thunderstrike and raided through Karazhan, Gruul, Magtheridon, Serpentshrine, Tempest Keep, Hyjal, and Illidan in Black Temple. This archive is that first chapter. Chapter 2 begins on Alliance — World of Warcraft Forever.",
};

export const CHAPTER_ONE_RAID_ORDER = [
  "Karazhan",
  "Gruul's Lair",
  "Magtheridon's Lair",
  "Serpentshrine Cavern",
  "Tempest Keep",
  "Hyjal Summit",
  "Black Temple",
];

export const CHAPTER_ONE_RAID_IMAGES = {
  Karazhan: "/raid-images/kara.png",
  "Gruul's Lair": "/raid-images/gruul.png",
  "Magtheridon's Lair": "/raid-images/magtheridon.png",
  "Serpentshrine Cavern": "/raid-images/ssc.png",
  "Tempest Keep": "/raid-images/tk.png",
  "Hyjal Summit": "/raid-images/hyjal.png",
  "Black Temple": "/raid-images/black-temple.png",
};

export const CHAPTER_ONE_BADGES = [
  { id: "kara-first-time-clear", label: "Karazhan First Clear", icon: "/images/achievements/kara-first-time-clear.png" },
  { id: "gruul-first-time-clear", label: "Gruul First Clear", icon: "/images/achievements/gruul-first-time-clear.png" },
  { id: "magtheridon-first-time-clear", label: "Magtheridon First Clear", icon: "/images/achievements/magtheridon-first-time-clear.png" },
  { id: "aoe-cleave", label: "AOE Cleave", icon: "/images/achievements/aoe-cleave.png" },
  { id: "ssc-first-event", label: "SSC First Event", icon: "/images/achievements/ssc-first-event.png" },
  { id: "ssc-first-clear", label: "SSC First Clear", icon: "/images/achievements/ssc-first-clear.png" },
  { id: "double-trouble-ssc", label: "Double Trouble · SSC", icon: "/images/achievements/double-trouble-ssc.png" },
  { id: "double-trouble-tk", label: "Double Trouble · TK", icon: "/images/achievements/double-trouble-tk.png" },
  { id: "tk-first-kael-kill", label: "TK First Kael Kill", icon: "/images/achievements/tk-first-kael-kill.png" },
  { id: "ssc-0611-2026", label: "SSC 11 June 2026", icon: "/images/achievements/ssc-0611-2026.png" },
  { id: "tk-0730-2026", label: "Solarian Two-Phase", icon: "/images/achievements/tk-0730-2026.png" },
  { id: "hyjal-first-clear", label: "Hyjal First Clear", icon: "/images/achievements/hyjal-first-clear.png" },
  { id: "bt-first-illidan-kill", label: "BT First Illidan Kill", icon: "/images/achievements/bt-first-illidan-kill.png" },
  { id: "hall-of-fame", label: "Hall of Fame", icon: "/images/achievements/hall-of-fame.png" },
];

export const CHAPTER_ONE_BADGE_IDS = CHAPTER_ONE_BADGES.map((b) => b.id);

/** One-time chronicle beats: first night, first clear, and named badge nights. */
export const CHAPTER_ONE_MILESTONES = [
  { id: "kara-first-night", label: "First Karazhan", raidName: "Karazhan", kind: "first-raid" },
  {
    id: "kara-first-clear",
    label: "Karazhan First Clear",
    raidName: "Karazhan",
    kind: "first-full-clear",
    badgeId: "kara-first-time-clear",
  },
  {
    id: "aoe-cleave",
    label: "AOE Cleave",
    raidName: "Karazhan",
    kind: "event",
    reportCodes: ["XVH1LmTWYDq6Zr7t"],
    badgeId: "aoe-cleave",
    calendarDay: "2026-05-07",
    startTime: Date.UTC(2026, 4, 7, 18, 0, 0),
  },
  { id: "gruul-first-night", label: "First Gruul's Lair", raidName: "Gruul's Lair", kind: "first-raid" },
  {
    id: "gruul-first-clear",
    label: "Gruul First Clear",
    raidName: "Gruul's Lair",
    kind: "first-full-clear",
    badgeId: "gruul-first-time-clear",
  },
  { id: "mag-first-night", label: "First Magtheridon's Lair", raidName: "Magtheridon's Lair", kind: "first-raid" },
  {
    id: "mag-first-clear",
    label: "Magtheridon First Clear",
    raidName: "Magtheridon's Lair",
    kind: "first-full-clear",
    badgeId: "magtheridon-first-time-clear",
  },
  {
    id: "ssc-first-event",
    label: "SSC First Event",
    raidName: "Serpentshrine Cavern",
    kind: "first-raid",
    badgeId: "ssc-first-event",
  },
  {
    id: "ssc-first-clear",
    label: "SSC First Clear",
    raidName: "Serpentshrine Cavern",
    kind: "event",
    reportCodes: ["c8dgnLmWCZ7xyvzG"],
    badgeId: "ssc-first-clear",
    calendarDay: "2026-05-21",
    startTime: Date.UTC(2026, 4, 21, 18, 0, 0),
  },
  {
    id: "double-trouble",
    label: "Double Trouble",
    raidName: "Serpentshrine Cavern",
    kind: "event",
    reportCodes: ["1C8XmybLW46kT39D"],
    badgeId: "double-trouble-ssc",
    calendarDay: "2026-06-18",
    startTime: Date.UTC(2026, 5, 18, 18, 0, 0),
  },
  { id: "tk-first-night", label: "First Tempest Keep", raidName: "Tempest Keep", kind: "first-raid" },
  {
    id: "tk-first-kael",
    label: "First Kael'thas Kill",
    raidName: "Tempest Keep",
    kind: "event",
    reportCodes: ["NnHhqGbLQZvMXd96"],
    badgeId: "tk-first-kael-kill",
    calendarDay: "2026-06-07",
    startTime: Date.UTC(2026, 5, 7, 18, 0, 0),
  },
  { id: "hyjal-first-night", label: "First Hyjal Summit", raidName: "Hyjal Summit", kind: "first-raid" },
  {
    id: "hyjal-first-clear",
    label: "Hyjal First Clear · Archimonde",
    raidName: "Hyjal Summit",
    kind: "first-full-clear",
    badgeId: "hyjal-first-clear",
    reportCodes: ["b8d4KDATxjWnrfpJ"],
    calendarDay: "2026-08-30",
    startTime: Date.UTC(2026, 7, 30, 18, 0, 0),
  },
  { id: "bt-first-night", label: "First Black Temple", raidName: "Black Temple", kind: "first-raid" },
  {
    id: "bt-first-illidan",
    label: "First Illidan Kill",
    raidName: "Black Temple",
    kind: "event",
    reportCodes: ["TKZ6qwz3pncvAyXQ", "GN2Y1mgTDtMkLbCv"],
    badgeId: "bt-first-illidan-kill",
    calendarDay: "2026-09-20",
    startTime: Date.UTC(2026, 8, 20, 18, 0, 0),
  },
];

const MS_PER_HOUR = 3_600_000;

export function hoursFromMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / MS_PER_HOUR) * 10) / 10;
}

export function wclFightUrl(reportCode, fightId) {
  const code = String(reportCode || "").trim();
  if (!code) return null;
  const fid = Number(fightId);
  if (Number.isInteger(fid) && fid > 0) {
    return `https://fresh.warcraftlogs.com/reports/${encodeURIComponent(code)}#fight=${fid}`;
  }
  return `https://fresh.warcraftlogs.com/reports/${encodeURIComponent(code)}`;
}

function asCodeSet(codes) {
  return new Set((Array.isArray(codes) ? codes : []).map((c) => String(c || "").trim()).filter(Boolean));
}

function entryCodes(entry) {
  const codes = [];
  for (const c of entry?.reportCodes || []) {
    const v = String(c || "").trim();
    if (v) codes.push(v);
  }
  const primary = String(entry?.reportCode || "").trim();
  if (primary && !codes.includes(primary)) codes.push(primary);
  return codes;
}

function joinNamesLabel(names) {
  const list = (Array.isArray(names) ? names : []).map((n) => String(n || "").trim()).filter(Boolean);
  if (!list.length) return "Core joined";
  if (list.length === 1) return `${list[0]} joined`;
  if (list.length === 2) return `${list[0]} and ${list[1]} joined`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]} joined`;
}

function beatKindRank(kind) {
  return kind === "core-join" ? 1 : 0;
}

function corePeopleOnNight(night, usersById) {
  const people = [];
  for (const uid of night?.attendeeIds || []) {
    const user = usersById.get(Number(uid)) || {};
    if (!isCoreParseEligibleGuildRole(user.guildRole)) continue;
    people.push({
      userId: Number(uid),
      name: raiderDisplayName({ ...user, characterName: user.characterName }),
      className: String(user.wowClass || user.className || "").trim() || null,
      guildRole: user.guildRole || null,
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return people;
}

function nameKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function corePeopleFromBadge(badgeId, badgesByUser, usersById) {
  if (!badgeId) return [];
  const people = [];
  for (const [uid, ids] of badgesByUser) {
    if (!(ids || []).includes(badgeId)) continue;
    const user = usersById.get(Number(uid)) || {};
    if (!isCoreParseEligibleGuildRole(user.guildRole)) continue;
    people.push({
      userId: Number(uid),
      name: raiderDisplayName({ ...user, characterName: user.characterName }),
      className: String(user.wowClass || user.className || "").trim() || null,
      guildRole: user.guildRole || null,
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return people;
}

function corePeopleFromNames(names, usersById) {
  const wanted = new Set((Array.isArray(names) ? names : []).map(nameKey).filter(Boolean));
  if (!wanted.size) return [];
  const people = [];
  for (const [uid, user] of usersById) {
    if (!isCoreParseEligibleGuildRole(user?.guildRole)) continue;
    const keys = [
      nameKey(user.displayName),
      nameKey(user.raidHelperName),
      nameKey(user.characterName),
    ].filter(Boolean);
    if (!keys.some((key) => wanted.has(key))) continue;
    people.push({
      userId: Number(uid),
      name: raiderDisplayName({ ...user, characterName: user.characterName }),
      className: String(user.wowClass || user.className || "").trim() || null,
      guildRole: user.guildRole || null,
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return people;
}

function resolveMilestoneCorePeople(mile, night, usersById, badgesByUser, firstClears) {
  const fromNight = corePeopleOnNight(night, usersById);
  if (fromNight.length) return fromNight;
  const fromBadge = corePeopleFromBadge(mile.badgeId, badgesByUser, usersById);
  if (fromBadge.length) return fromBadge;
  if (mile.kind === "first-full-clear") {
    const names = firstClears?.[mile.raidName]?.participants || [];
    return corePeopleFromNames(names, usersById);
  }
  return [];
}

function buildCoreJoinBeats(nights, usersById) {
  const firstNightByUser = new Map();
  for (const night of nights) {
    for (const uid of night.attendeeIds || []) {
      if (firstNightByUser.has(uid)) continue;
      const user = usersById.get(uid) || {};
      if (!isCoreParseEligibleGuildRole(user.guildRole)) continue;
      firstNightByUser.set(uid, night);
    }
  }

  const groups = new Map();
  for (const [uid, night] of firstNightByUser) {
    const key = `${night.startTime || 0}|${night.calendarDay || ""}|${night.raidName || ""}|${night.reportCode || ""}`;
    if (!groups.has(key)) groups.set(key, { night, people: [] });
    const user = usersById.get(uid) || {};
    groups.get(key).people.push({
      userId: uid,
      name: raiderDisplayName({ ...user, characterName: user.characterName }),
      className: String(user.wowClass || user.className || "").trim() || null,
      guildRole: user.guildRole || null,
    });
  }

  return [...groups.values()].map(({ night, people }) => {
    people.sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: `core-join-${night.calendarDay || "day"}-${String(night.raidName || "raid").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: joinNamesLabel(people.map((p) => p.name)),
      kind: "core-join",
      raidName: night.raidName,
      people,
      calendarDay: night.calendarDay,
      startTime: night.startTime,
      bossesKilled: night.bossesKilled,
      bossesTotal: night.bossesTotal,
      isFullClear: night.isFullClear,
      hours: night.hours,
      attendeeCount: night.attendeeCount,
      wclUrl: night.wclUrl,
      image: raidImageFor(night.raidName, night.image),
      reportCode: night.reportCode,
      sameNightAsFirstVisit: false,
      badgeId: null,
      badgeIcon: null,
    };
  });
}

function raidSortIndex(name) {
  const i = CHAPTER_ONE_RAID_ORDER.indexOf(String(name || ""));
  return i === -1 ? CHAPTER_ONE_RAID_ORDER.length : i;
}

function raidImageFor(raidName, nightImage) {
  const custom = String(nightImage || "").trim();
  if (custom) return custom;
  return CHAPTER_ONE_RAID_IMAGES[String(raidName || "")] || null;
}

function nightMatchesEntry(night, entry) {
  if (!night || !entry) return false;
  const nightStart = Number(night.startTime || 0);
  const entryStart = Number(entry.startTime || 0);
  if (nightStart && entryStart && nightStart === entryStart && night.raidName === entry.raidName) return true;
  return (
    night.calendarDay === String(entry.calendarDay || "").trim() &&
    night.raidName === String(entry.raidName || "").trim() &&
    night.reportCode === (String(entry.reportCode || "").trim() || null)
  );
}

function syntheticNightFromMilestone(mile) {
  const code = String((mile.reportCodes || [])[0] || mile.reportCode || "").trim();
  const day = String(mile.calendarDay || "").trim();
  const start = Number(mile.startTime || 0);
  if (!code && !day && !start) return null;
  return {
    calendarDay: day || null,
    startTime: start || null,
    raidName: mile.raidName,
    bossesKilled: Number(mile.bossesKilled || 0) || 0,
    bossesTotal: Number(mile.bossesTotal || 0) || 0,
    isFullClear: mile.kind === "first-full-clear" || Boolean(mile.isFullClear),
    hours: 0,
    attendeeCount: 0,
    wclUrl: wclFightUrl(code),
    image: CHAPTER_ONE_RAID_IMAGES[mile.raidName] || null,
    reportCode: code || null,
    reportCodes: code ? [code] : [],
  };
}

function findNightForMilestone(mile, nights, firstRaidNightByRaid, firstFullClearByRaid) {
  if (mile.kind === "first-full-clear") {
    const hit = nights.find((night) => nightMatchesEntry(night, firstFullClearByRaid.get(mile.raidName)));
    if (hit) return hit;
  }
  if (mile.kind === "first-raid") {
    const hit = nights.find((night) => nightMatchesEntry(night, firstRaidNightByRaid.get(mile.raidName)));
    if (hit) return hit;
  }
  const codes = asCodeSet(mile.reportCodes);
  if (codes.size) {
    const hit = nights.find((night) => (night.reportCodes || []).some((code) => codes.has(code)));
    if (hit) return hit;
  }
  return syntheticNightFromMilestone(mile);
}

function enrichNightAttendees(night, appearancesByReport, extraCodes = []) {
  if (!night) return night;
  if (Array.isArray(night.attendeeIds) && night.attendeeIds.length) return night;
  const ids = new Set();
  const codes = [
    ...(Array.isArray(night.reportCodes) ? night.reportCodes : []),
    night.reportCode,
    ...(Array.isArray(extraCodes) ? extraCodes : []),
  ]
    .map((code) => String(code || "").trim())
    .filter(Boolean);
  for (const code of codes) {
    const set = appearancesByReport?.get?.(code);
    if (!set) continue;
    for (const uid of set) {
      const n = Number(uid);
      if (Number.isInteger(n) && n > 0) ids.add(n);
    }
  }
  if (!ids.size) return night;
  return {
    ...night,
    attendeeIds: [...ids],
    attendeeCount: Number(night.attendeeCount || 0) || ids.size,
  };
}

function buildChronicleBeats(
  nights,
  firstRaidNightByRaid,
  firstFullClearByRaid,
  badgeMeta,
  usersById,
  badgesByUser,
  firstClears,
  appearancesByReport
) {
  const resolved = [];
  for (const mile of CHAPTER_ONE_MILESTONES) {
    const rawNight = findNightForMilestone(mile, nights, firstRaidNightByRaid, firstFullClearByRaid);
    if (!rawNight) continue;
    const night = enrichNightAttendees(rawNight, appearancesByReport, mile.reportCodes);
    const badge = mile.badgeId ? badgeMeta.get(mile.badgeId) : null;
    resolved.push({
      id: mile.id,
      label: mile.label,
      kind: mile.kind,
      raidName: mile.raidName,
      badgeId: mile.badgeId || null,
      badgeIcon: badge?.icon || null,
      calendarDay: night.calendarDay,
      startTime: night.startTime,
      bossesKilled: night.bossesKilled,
      bossesTotal: night.bossesTotal,
      isFullClear: night.isFullClear,
      hours: night.hours,
      attendeeCount: night.attendeeCount,
      people: resolveMilestoneCorePeople(mile, night, usersById, badgesByUser, firstClears),
      wclUrl: night.wclUrl,
      image: raidImageFor(mile.raidName, night.raidName === mile.raidName ? night.image : null),
      reportCode: night.reportCode,
      sameNightAsFirstVisit: false,
    });
  }

  const skipIds = new Set();
  for (const raidName of CHAPTER_ONE_RAID_ORDER) {
    const firstNight = resolved.find((beat) => beat.raidName === raidName && beat.kind === "first-raid");
    const firstClear = resolved.find((beat) => beat.raidName === raidName && beat.kind === "first-full-clear");
    if (
      firstNight &&
      firstClear &&
      firstNight.calendarDay === firstClear.calendarDay &&
      firstNight.startTime === firstClear.startTime
    ) {
      skipIds.add(firstNight.id);
      firstClear.sameNightAsFirstVisit = true;
    }
  }

  return resolved
    .filter((beat) => !skipIds.has(beat.id))
    .sort(
      (a, b) =>
        Number(a.startTime || 0) - Number(b.startTime || 0) ||
        beatKindRank(a.kind) - beatKindRank(b.kind) ||
        raidSortIndex(a.raidName) - raidSortIndex(b.raidName)
    );
}

function pickPeakParse(rows) {
  let best = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = Number(row?.bestValue ?? row?.best_value);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!best || value > best.value) {
      best = {
        value: Math.round(value * 10) / 10,
        encounter: String(row?.bestEncounter || row?.best_encounter || "").trim() || null,
        reportCode: String(row?.bestReportCode || row?.best_report_code || "").trim() || null,
        fightId: Number.isInteger(Number(row?.bestFightId ?? row?.best_fight_id))
          ? Number(row?.bestFightId ?? row?.best_fight_id)
          : null,
        bracket: String(row?.bracket || "").trim() || null,
      };
    }
  }
  return best;
}

function raiderDisplayName(user) {
  return (
    String(user?.displayName || "").trim() ||
    String(user?.raidHelperName || "").trim() ||
    String(user?.characterName || "").trim() ||
    "Unknown"
  );
}

/**
 * Credit a raider a night’s `clearDurationMs` when they appear in any of
 * that night’s WCL report codes. Guild hours count each night once.
 *
 * @param {object} input
 * @param {object[]} input.calendarEntries
 * @param {Map<string, Set<number>>|Record<string, number[]>} input.appearancesByReport
 * @param {object[]} [input.users]
 * @param {Map<number, object[]>|Record<string, object[]>} [input.parseRowsByUser]
 * @param {Map<number, string[]>|Record<string, string[]>} [input.badgesByUser]
 * @param {object} [input.hallOfFame]
 * @param {object} [input.kpi]
 * @param {Record<string, { reportCode?: string, startTime?: number, participants?: string[] }>} [input.firstClears]
 */
export function buildChapterOneRecap(input = {}) {
  const calendarEntries = Array.isArray(input.calendarEntries) ? input.calendarEntries : [];
  const users = Array.isArray(input.users) ? input.users : [];
  const kpi = input.kpi && typeof input.kpi === "object" ? input.kpi : {};
  const firstClears = input.firstClears && typeof input.firstClears === "object" ? input.firstClears : {};
  const hof = input.hallOfFame && typeof input.hallOfFame === "object" ? input.hallOfFame : {};

  const appearancesByReport = new Map();
  const rawAppearances = input.appearancesByReport;
  if (rawAppearances instanceof Map) {
    for (const [code, ids] of rawAppearances) {
      const set = ids instanceof Set ? ids : new Set(ids || []);
      appearancesByReport.set(String(code), set);
    }
  } else if (rawAppearances && typeof rawAppearances === "object") {
    for (const [code, ids] of Object.entries(rawAppearances)) {
      appearancesByReport.set(String(code), new Set(ids || []));
    }
  }

  const parseRowsByUser = new Map();
  const rawParses = input.parseRowsByUser;
  if (rawParses instanceof Map) {
    for (const [uid, rows] of rawParses) parseRowsByUser.set(Number(uid), rows || []);
  } else if (rawParses && typeof rawParses === "object") {
    for (const [uid, rows] of Object.entries(rawParses)) parseRowsByUser.set(Number(uid), rows || []);
  }

  const badgesByUser = new Map();
  const rawBadges = input.badgesByUser;
  if (rawBadges instanceof Map) {
    for (const [uid, ids] of rawBadges) badgesByUser.set(Number(uid), ids || []);
  } else if (rawBadges && typeof rawBadges === "object") {
    for (const [uid, ids] of Object.entries(rawBadges)) badgesByUser.set(Number(uid), ids || []);
  }

  const usersById = new Map(users.map((u) => [Number(u.id), u]));
  const badgeMeta = new Map(CHAPTER_ONE_BADGES.map((b) => [b.id, b]));

  const firstFullClearByRaid = new Map();
  const firstRaidNightByRaid = new Map();
  for (const entry of calendarEntries) {
    const raidName = String(entry?.raidName || "").trim();
    if (!raidName) continue;
    const start = Number(entry?.startTime || 0);
    if (!firstRaidNightByRaid.has(raidName) || start < Number(firstRaidNightByRaid.get(raidName)?.startTime || 0)) {
      firstRaidNightByRaid.set(raidName, entry);
    }
    if (entry?.isFullClear) {
      const prev = firstFullClearByRaid.get(raidName);
      if (!prev || start < Number(prev.startTime || 0)) firstFullClearByRaid.set(raidName, entry);
    }
  }

  const nights = [];
  const hoursByUser = new Map();
  const nightsByUser = new Map();
  let guildRaidHoursMs = 0;
  const reportCodesSeen = new Set();

  for (const entry of [...calendarEntries].sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0))) {
    const codes = entryCodes(entry);
    for (const c of codes) reportCodesSeen.add(c);
    const durationMs = Number(entry?.clearDurationMs);
    const creditedMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    if (creditedMs) guildRaidHoursMs += creditedMs;

    const attendeeIds = new Set();
    for (const code of codes) {
      const ids = appearancesByReport.get(code);
      if (!ids) continue;
      for (const uid of ids) {
        const n = Number(uid);
        if (Number.isInteger(n) && n > 0) attendeeIds.add(n);
      }
    }
    for (const uid of attendeeIds) {
      nightsByUser.set(uid, (nightsByUser.get(uid) || 0) + 1);
      if (creditedMs) hoursByUser.set(uid, (hoursByUser.get(uid) || 0) + creditedMs);
    }

    nights.push({
      calendarDay: String(entry?.calendarDay || "").trim() || null,
      startTime: Number(entry?.startTime || 0) || null,
      raidName: String(entry?.raidName || "").trim() || null,
      title: String(entry?.title || "").trim() || null,
      bossesKilled: Number(entry?.bossesKilled || 0) || 0,
      bossesTotal: Number(entry?.bossesTotal || 0) || 0,
      isFullClear: Boolean(entry?.isFullClear),
      clearDurationMs: creditedMs || null,
      hours: hoursFromMs(creditedMs),
      attendeeCount: attendeeIds.size,
      attendeeIds: [...attendeeIds],
      reportCode: String(entry?.reportCode || "").trim() || null,
      reportCodes: codes,
      wclUrl: String(entry?.wclUrl || "").trim() || wclFightUrl(entry?.reportCode),
      image: String(entry?.image || "").trim() || null,
    });
  }

  const timeline = [
    ...buildChronicleBeats(
      nights,
      firstRaidNightByRaid,
      firstFullClearByRaid,
      badgeMeta,
      usersById,
      badgesByUser,
      firstClears,
      appearancesByReport
    ),
    ...buildCoreJoinBeats(nights, usersById),
  ].sort(
    (a, b) =>
      Number(a.startTime || 0) - Number(b.startTime || 0) ||
      beatKindRank(a.kind) - beatKindRank(b.kind) ||
      raidSortIndex(a.raidName) - raidSortIndex(b.raidName)
  );

  const raids = CHAPTER_ONE_RAID_ORDER.map((raidName) => {
    const raidNights = nights.filter((row) => row.raidName === raidName);
    const fullClears = raidNights.filter((row) => row.isFullClear && row.clearDurationMs);
    const fastest = fullClears.reduce((best, row) => {
      if (!best || row.clearDurationMs < best.clearDurationMs) return row;
      return best;
    }, null);
    const firstClear = firstFullClearByRaid.get(raidName) || null;
    const firstClearEntry = firstClear
      ? raidNights.find((n) => n.reportCode === firstClear.reportCode && n.calendarDay === firstClear.calendarDay)
      : null;
    const firstClearApi = firstClears[raidName] || null;
    return {
      raidName,
      nights: raidNights.length,
      firstClearDay: firstClearEntry?.calendarDay || firstClear?.calendarDay || null,
      firstClearWclUrl: firstClearEntry?.wclUrl || (firstClearApi?.reportCode ? wclFightUrl(firstClearApi.reportCode) : null),
      fastestClearMs: fastest?.clearDurationMs || null,
      fastestClearHours: hoursFromMs(fastest?.clearDurationMs),
      fastestClearWclUrl: fastest?.wclUrl || null,
      image: raidNights.find((n) => n.image)?.image || CHAPTER_ONE_RAID_IMAGES[raidName] || null,
    };
  }).filter((raid) => raid.nights > 0);

  const raiderIds = new Set([...hoursByUser.keys(), ...nightsByUser.keys()]);
  const raiders = [...raiderIds]
    .map((userId) => {
      const user = usersById.get(userId) || {};
      if (!isCoreParseEligibleGuildRole(user.guildRole)) return null;
      const peak = pickPeakParse(parseRowsByUser.get(userId) || []);
      const earnedIds = (badgesByUser.get(userId) || []).filter((id) => badgeMeta.has(id));
      return {
        userId,
        name: raiderDisplayName({ ...user, characterName: user.characterName }),
        className: String(user.wowClass || user.className || "").trim() || null,
        guildRole: user.guildRole || null,
        hoursMs: hoursByUser.get(userId) || 0,
        hours: hoursFromMs(hoursByUser.get(userId) || 0),
        nights: nightsByUser.get(userId) || 0,
        peakParse: peak
          ? {
              value: peak.value,
              encounter: peak.encounter,
              bracket: peak.bracket,
              wclUrl: wclFightUrl(peak.reportCode, peak.fightId),
            }
          : null,
        badges: earnedIds.map((id) => {
          const meta = badgeMeta.get(id);
          return { id, label: meta.label, icon: meta.icon };
        }),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.hoursMs - a.hoursMs || b.nights - a.nights || a.name.localeCompare(b.name));

  const hofPlayers = (Array.isArray(hof.players) ? hof.players : []).map((player) => ({
    winnerName: String(player?.winnerName || "").trim() || "Unknown",
    mvpCount: Number(player?.mvpCount || 0) || 0,
    latestRaidName: String(player?.latestRaidName || "").trim() || null,
    customQuote: String(player?.customQuote || "").trim() || null,
    wins: (Array.isArray(player?.wins) ? player.wins : []).map((win) => ({
      raidName: String(win?.raidName || win?.raidCode || "").trim() || null,
      raidStartTime: Number(win?.raidStartTime || 0) || null,
    })),
  }));

  const uniqueRaiders = raiderIds.size || Number(kpi.uniqueRaiderCount || 0) || 0;

  return {
    ok: true,
    chapter: { ...CHAPTER_ONE },
    kpis: {
      raidNights: nights.length,
      uniqueRaiders,
      totalRaidHours: hoursFromMs(guildRaidHoursMs),
      totalRaidHoursMs: guildRaidHoursMs,
      wclReports: reportCodesSeen.size || Number(kpi.wclReportsCovered || 0) || 0,
      itemsDistributed: Number(kpi.totalItemsDistributed || 0) || 0,
    },
    raids,
    timeline,
    raiders,
    hallOfFame: {
      players: hofPlayers,
      latestChampion: hofPlayers[0] || null,
    },
    milestones: timeline.map((beat) => ({
      id: beat.id,
      label: beat.label,
      raidName: beat.raidName,
      calendarDay: beat.calendarDay,
      wclUrl: beat.wclUrl,
    })),
  };
}
