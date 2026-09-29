(function () {
  const main = document.getElementById("ch1Main");
  if (!main) return;

  const CLASS_SLUG = {
    warrior: "warrior",
    paladin: "paladin",
    hunter: "hunter",
    rogue: "rogue",
    priest: "priest",
    shaman: "shaman",
    mage: "mage",
    warlock: "warlock",
    druid: "druid",
  };

  const FALLBACK_ART = "/raid-images/black-temple.png";

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function classSlug(name) {
    return CLASS_SLUG[String(name || "").trim().toLowerCase()] || "";
  }

  function formatDay(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).split("-").map(Number);
    if (!y || !m || !d) return String(iso);
    try {
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    } catch {
      return String(iso);
    }
  }

  function hoursLabel(hours) {
    const n = Number(hours);
    if (!Number.isFinite(n) || n <= 0) return "—";
    return `${n.toFixed(n % 1 ? 1 : 0)}h`;
  }

  let raiders = [];
  let sortKey = "hours";
  let sortDir = "desc";

  function sortedRaiders() {
    const copy = [...raiders];
    copy.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "name") return dir * String(a.name).localeCompare(String(b.name));
      if (sortKey === "class") return dir * String(a.className || "").localeCompare(String(b.className || ""));
      if (sortKey === "nights") return dir * (Number(a.nights || 0) - Number(b.nights || 0));
      if (sortKey === "parse") return dir * (Number(a.peakParse?.value || 0) - Number(b.peakParse?.value || 0));
      return dir * (Number(a.hoursMs || 0) - Number(b.hoursMs || 0));
    });
    return copy;
  }

  function renderRaiderRows() {
    const host = document.getElementById("ch1RaiderBody");
    if (!host) return;
    host.innerHTML = sortedRaiders()
      .map((row) => {
        const slug = classSlug(row.className);
        const parse = row.peakParse;
        const parseCell = parse
          ? parse.wclUrl
            ? `<a href="${esc(parse.wclUrl)}" target="_blank" rel="noopener noreferrer">${esc(String(parse.value))}%</a>`
            : `${esc(String(parse.value))}%`
          : "—";
        const badges = (row.badges || [])
          .map(
            (badge) =>
              `<img src="${esc(badge.icon)}" alt="${esc(badge.label)}" title="${esc(badge.label)}" width="28" height="28" />`
          )
          .join("");
        return `<tr>
          <td>${esc(row.name)}</td>
          <td class="${slug ? `class-${slug}` : ""}">${esc(row.className || "—")}</td>
          <td>${hoursLabel(row.hours)}</td>
          <td>${esc(String(row.nights || 0))}</td>
          <td>${parseCell}</td>
          <td><div class="ch1-badges">${badges}</div></td>
        </tr>`;
      })
      .join("");
    for (const th of document.querySelectorAll("#ch1RaiderTable th[data-sort]")) {
      th.setAttribute(
        "aria-sort",
        th.getAttribute("data-sort") === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      );
    }
  }

  function beatKindLabel(beat) {
    if (beat.sameNightAsFirstVisit) return "First night and first clear";
    if (beat.kind === "first-raid") return "First night";
    if (beat.kind === "first-full-clear") return "First full clear";
    if (beat.kind === "core-join") return "First raid";
    return "One-time achievement";
  }

  function beatStats(beat) {
    if (beat.kind === "core-join") {
      const names = (beat.people || []).map((p) => p.name).filter(Boolean);
      const who = names.length ? names.join(", ") : "";
      return [beat.raidName, who ? `the first wave of Core players arrived` : ""].filter(Boolean).join(" · ");
    }
    const parts = [];
    if (Number(beat.bossesTotal) > 0) parts.push(`${beat.bossesKilled || 0}/${beat.bossesTotal} bosses`);
    if (beat.hours) parts.push(hoursLabel(beat.hours));
    if (beat.attendeeCount) parts.push(`${beat.attendeeCount} raiders`);
    return parts.join(" · ");
  }

  function beatTitle(beat) {
    if (beat.kind === "core-join" && beat.people?.length) {
      const names = beat.people.map((p) => p.name).filter(Boolean);
      if (names.length === 1) return `${names[0]} joined`;
      if (names.length === 2) return `${names[0]} and ${names[1]} joined`;
      return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]} joined`;
    }
    return beat.label || "Milestone";
  }

  function panelShell({ id, art, artSrcset, artSizes, artWidth, artHeight, content, centered }) {
    const srcsetAttr = artSrcset ? ` srcset="${esc(artSrcset)}"` : "";
    const sizesAttr = artSizes ? ` sizes="${esc(artSizes)}"` : "";
    const w = Number(artWidth) > 0 ? Number(artWidth) : 1440;
    const h = Number(artHeight) > 0 ? Number(artHeight) : 960;
    return `<section class="ch1-panel${centered ? " ch1-panel--center" : ""}" id="${esc(id || "")}" data-panel>
      <img class="ch1-panel-bg" src="${esc(art || FALLBACK_ART)}"${srcsetAttr}${sizesAttr} alt="" width="${w}" height="${h}" loading="lazy" decoding="async" />
      <div class="ch1-panel-shade" aria-hidden="true"></div>
      <div class="ch1-panel-glow" aria-hidden="true"></div>
      <div class="ch1-panel-inner">${content}</div>
    </section>`;
  }

  function renderHeroPanel(chapter) {
    const kicker = [chapter.kicker || "Chapter 1", chapter.era || "The Burning Crusade Classic", chapter.faction || "Horde"]
      .filter(Boolean)
      .join(" · ");
    return panelShell({
      id: "ch1-intro",
      art: FALLBACK_ART,
      centered: true,
      content: `<div class="ch1-panel-hero">
        <p class="ch1-panel-kicker">${esc(kicker)}</p>
        <h2 class="ch1-panel-display">${esc(chapter.title || "From Strangers to Community")}</h2>
        <p class="ch1-panel-lede">${esc(chapter.closeout || "")}</p>
        <div class="ch1-panel-actions">
          <button type="button" class="ch1-pill ch1-pill--gold" data-ch1-scroll-timeline>Scroll through the timeline</button>
          <a class="ch1-pill" href="/auth/discord/login?next=${encodeURIComponent("/chapter-1")}">Login</a>
          <a class="ch1-pill" href="/join.html">Join Us</a>
        </div>
      </div>`,
    });
  }

  function renderPeopleChips(people, { labeled } = {}) {
    if (!people?.length) return "";
    const chips = `<ul class="ch1-chips">${people
      .map((p) => {
        const slug = classSlug(p.className);
        return `<li class="ch1-chip${slug ? ` class-${slug}` : ""}">${esc(p.name)}</li>`;
      })
      .join("")}</ul>`;
    if (!labeled) return chips;
    return `<div class="ch1-core-list">
      <p class="ch1-core-list-label">Core attended · ${people.length}</p>
      ${chips}
    </div>`;
  }

  function renderBeatPanel(beat, index) {
    const join = beat.kind === "core-join";
    const art = beat.image || FALLBACK_ART;
    const badgeSrc = beat.badgeIcon || art;
    const log = beat.wclUrl
      ? `<a class="ch1-pill ch1-pill--gold" href="${esc(beat.wclUrl)}" target="_blank" rel="noopener noreferrer">Warcraft Log</a>`
      : "";
    const chips = renderPeopleChips(beat.people, { labeled: !join });
    return panelShell({
      id: beat.id || `ch1-beat-${index}`,
      art,
      content: `<div class="ch1-panel-split">
        <div class="ch1-panel-copy">
          <p class="ch1-panel-date">${esc(formatDay(beat.calendarDay))}</p>
          <h2 class="ch1-panel-title">${esc(beatTitle(beat))}</h2>
          <p class="ch1-panel-stats">${esc(beatStats(beat))}</p>
          ${chips}
          ${log}
        </div>
        <aside class="ch1-panel-badge" aria-hidden="true">
          <img src="${esc(badgeSrc)}" alt="" width="420" height="420" loading="lazy" decoding="async" />
          <span class="ch1-pill ch1-pill--gold ch1-panel-badge-label">${esc(beatKindLabel(beat))}</span>
        </aside>
      </div>`,
    });
  }

  function renderStatsPanel(kpis) {
    const cards = [
      ["Raid nights", kpis.raidNights || 0],
      ["Raiders", kpis.uniqueRaiders || 0],
      ["Hours raided", kpis.totalRaidHours || 0],
      ["WCL reports", kpis.wclReports || 0],
      ["Items looted", kpis.itemsDistributed || 0],
    ]
      .map(
        ([label, value]) =>
          `<div class="ch1-stat-card"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`
      )
      .join("");
    return panelShell({
      id: "ch1-ledger",
      art: FALLBACK_ART,
      centered: true,
      content: `<div class="ch1-panel-block">
        <p class="ch1-panel-kicker">The ledger</p>
        <h2 class="ch1-panel-title ch1-panel-title--center">What we did together</h2>
        <div class="ch1-stat-grid">${cards}</div>
      </div>`,
    });
  }

  function renderRaidersPanel() {
    return panelShell({
      id: "ch1-roster",
      art: "/raid-images/ssc.png",
      centered: true,
      content: `<div class="ch1-panel-block ch1-panel-block--wide">
        <p class="ch1-panel-kicker">The roster</p>
        <h2 class="ch1-panel-title ch1-panel-title--center">Hours, parses, and badges</h2>
        <div class="ch1-table-wrap">
          <table class="ch1-table" id="ch1RaiderTable">
            <thead>
              <tr>
                <th data-sort="name">Raider</th>
                <th data-sort="class">Class</th>
                <th data-sort="hours">Hours</th>
                <th data-sort="nights">Nights</th>
                <th data-sort="parse">Highest parse</th>
                <th>Badges</th>
              </tr>
            </thead>
            <tbody id="ch1RaiderBody"></tbody>
          </table>
        </div>
      </div>`,
    });
  }

  function renderHofPanel(hof) {
    const cards = hof.length
      ? hof
          .map(
            (player) => `<article class="ch1-hof-card">
              <h3>${esc(player.winnerName)}</h3>
              <p>${esc(String(player.mvpCount || 0))} MVP win${Number(player.mvpCount) === 1 ? "" : "s"}${
                player.latestRaidName ? ` · ${esc(player.latestRaidName)}` : ""
              }</p>
              ${player.customQuote ? `<p class="ch1-quote">“${esc(player.customQuote)}”</p>` : ""}
            </article>`
          )
          .join("")
      : `<p class="ch1-empty">Hall of Fame records will appear here as MVP rounds are archived.</p>`;
    return panelShell({
      id: "hall-of-fame",
      art: "/raid-images/hyjal.png",
      centered: true,
      content: `<div class="ch1-panel-block">
        <p class="ch1-panel-kicker">The Eternal Hall</p>
        <h2 class="ch1-panel-title ch1-panel-title--center">Hall of Fame</h2>
        <div class="ch1-hof-grid">${cards}</div>
      </div>`,
    });
  }

  function renderChapterTwoPanel() {
    return panelShell({
      id: "ch1-chapter-two",
      art: "/wow-forever-hero.jpg",
      artSrcset:
        "/responsive/wow-forever-hero-768w.webp 768w, /responsive/wow-forever-hero-1024w.webp 1024w, /responsive/wow-forever-hero-1536w.webp 1536w, /wow-forever-hero.jpg 1672w",
      artSizes: "100vw",
      artWidth: 1672,
      artHeight: 941,
      centered: true,
      content: `<div class="ch1-panel-hero">
        <p class="ch1-panel-lede">World of Warcraft Forever is live. Pick your race, class, and spec — and walk into the tavern.</p>
        <div class="ch1-panel-actions">
          <a class="ch1-pill ch1-pill--gold" href="/wow-forever">Chapter 2 starts on Forever</a>
        </div>
      </div>`,
    });
  }

  function initScrollPanels() {
    const panels = [...main.querySelectorAll("[data-panel]")];
    if (!panels.length) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver !== "function") {
      main.classList.add("ch1-scroll--static");
      panels.forEach((el) => el.classList.add("is-active"));
      return;
    }

    document.documentElement.classList.add("ch1-scroll-snap");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-active");
            entry.target.classList.add("has-seen");
          } else {
            entry.target.classList.remove("is-active");
          }
        }
      },
      { threshold: 0.35, rootMargin: "0px 0px -10% 0px" }
    );
    panels.forEach((el) => observer.observe(el));
  }

  function render(payload) {
    const chapter = payload?.chapter || {};
    const kpis = payload?.kpis || {};
    const timeline = payload?.timeline || [];
    raiders = payload?.raiders || [];
    const hof = payload?.hallOfFame?.players || [];

    const beatPanels = timeline.map((beat, i) => renderBeatPanel(beat, i)).join("");

    main.innerHTML = `
      <div class="ch1-scroll" id="ch1Scroll">
        ${renderHeroPanel(chapter)}
        ${beatPanels}
        ${renderStatsPanel(kpis)}
        ${renderRaidersPanel()}
        ${renderHofPanel(hof)}
        ${renderChapterTwoPanel()}
      </div>
    `;

    initScrollPanels();
    renderRaiderRows();
    main.querySelector("[data-ch1-scroll-timeline]")?.addEventListener("click", () => {
      const next = document.getElementById("ch1-intro")?.nextElementSibling;
      if (!(next instanceof HTMLElement)) return;
      next.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("ch1RaiderTable")?.addEventListener("click", (event) => {
      const th = event.target.closest("th[data-sort]");
      if (!th) return;
      const key = th.getAttribute("data-sort");
      if (sortKey === key) sortDir = sortDir === "desc" ? "asc" : "desc";
      else {
        sortKey = key;
        sortDir = key === "name" || key === "class" ? "asc" : "desc";
      }
      renderRaiderRows();
    });

    if (window.location.hash === "#hall-of-fame") {
      document.getElementById("hall-of-fame")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function load() {
    try {
      const res = await fetch("/api/chapter-one", { credentials: "same-origin" });
      const payload = await res.json();
      if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${res.status}`);
      render(payload);
    } catch (error) {
      main.innerHTML = `<section class="card"><p class="ch1-error">Could not load Chapter 1: ${esc(error.message || error)}</p></section>`;
    }
  }

  load();
})();
