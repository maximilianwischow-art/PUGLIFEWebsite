/**
 * Forever / Classic profession icons (Wowhead → wow.zamimg textures, cached locally).
 * Exposes window.plbProfessionIcons for Guild LB + Profession LB.
 */
(() => {
  const ICON_BY_NAME = {
    Alchemy: "/images/professions/alchemy.jpg",
    Blacksmithing: "/images/professions/blacksmithing.jpg",
    Enchanting: "/images/professions/enchanting.jpg",
    Engineering: "/images/professions/engineering.jpg",
    Herbalism: "/images/professions/herbalism.jpg",
    Leatherworking: "/images/professions/leatherworking.jpg",
    Mining: "/images/professions/mining.jpg",
    Skinning: "/images/professions/skinning.jpg",
    Tailoring: "/images/professions/tailoring.jpg",
    Cooking: "/images/professions/cooking.jpg",
    Fishing: "/images/professions/fishing.jpg",
    "First Aid": "/images/professions/first-aid.jpg",
  };

  const PRIMARY_ORDER = [
    "Alchemy",
    "Blacksmithing",
    "Enchanting",
    "Engineering",
    "Herbalism",
    "Leatherworking",
    "Mining",
    "Skinning",
    "Tailoring",
  ];

  const SECONDARY_ORDER = ["Cooking", "Fishing", "First Aid"];

  const ALL_ORDER = [...PRIMARY_ORDER, ...SECONDARY_ORDER];

  function iconUrl(name) {
    const key = String(name || "").trim();
    return ICON_BY_NAME[key] || "";
  }

  function iconImg(name, { className = "glb-prof-icon", size = 28 } = {}) {
    const src = iconUrl(name);
    const label = String(name || "").trim() || "Profession";
    if (!src) return "";
    return `<img class="${className}" src="${src}" alt="${label}" title="${label}" width="${size}" height="${size}" loading="lazy" decoding="async" />`;
  }

  window.plbProfessionIcons = {
    ICON_BY_NAME,
    PRIMARY_ORDER,
    SECONDARY_ORDER,
    ALL_ORDER,
    iconUrl,
    iconImg,
  };
})();
