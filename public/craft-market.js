(() => {
  const state = {
    me: null,
    offers: [],
    requests: [],
    demands: [],
    catalog: [],
    catalogProfessions: [],
    catalogProfession: "",
    catalogLoaded: false,
    listingSearch: "",
    demandSearch: "",
    recipeSearch: "",
    catalogSearch: "",
    selectedRecipeIds: new Set(),
    selectedCatalogRecipeId: null,
    pendingOfferId: null,
    authUserId: "",
    itemMetaById: new Map(),
  };

  const el = {
    status: document.getElementById("cmStatus"),
    demands: document.getElementById("cmDemands"),
    requests: document.getElementById("cmRequests"),
    listings: document.getElementById("cmListings"),
    listingSearch: document.getElementById("cmListingSearch"),
    demandSearch: document.getElementById("cmDemandSearch"),
    openOfferBtn: document.getElementById("cmOpenOfferBtn"),
    openDemandBtn: document.getElementById("cmOpenDemandBtn"),
    loginHint: document.getElementById("cmLoginHint"),
    offerDialog: document.getElementById("cmOfferDialog"),
    offerDialogHint: document.getElementById("cmOfferDialogHint"),
    offerDialogClose: document.getElementById("cmOfferDialogClose"),
    recipeSearch: document.getElementById("cmRecipeSearch"),
    recipeList: document.getElementById("cmRecipeList"),
    offerStatus: document.getElementById("cmOfferStatus"),
    saveOffersBtn: document.getElementById("cmSaveOffersBtn"),
    demandDialog: document.getElementById("cmDemandDialog"),
    demandForm: document.getElementById("cmDemandForm"),
    catalogSearch: document.getElementById("cmCatalogSearch"),
    catalogProfessions: document.getElementById("cmCatalogProfessions"),
    catalogList: document.getElementById("cmCatalogList"),
    catalogMeta: document.getElementById("cmCatalogMeta"),
    demandNote: document.getElementById("cmDemandNote"),
    demandDialogStatus: document.getElementById("cmDemandDialogStatus"),
    dialog: document.getElementById("cmRequestDialog"),
    dialogBody: document.getElementById("cmRequestDialogBody"),
    dialogMats: document.getElementById("cmRequestDialogMats"),
    dialogStatus: document.getElementById("cmRequestDialogStatus"),
    requestNote: document.getElementById("cmRequestNote"),
    requestForm: document.getElementById("cmRequestForm"),
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(node, text, tone) {
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", tone === "error");
    node.classList.toggle("is-success", tone === "success");
  }

  function itemTipAttrs(itemId) {
    const id = Number(itemId) || 0;
    if (id <= 0) return "";
    const meta = state.itemMetaById.get(id);
    const tip = window.WowItemTooltip?.tooltipText?.(meta) || "";
    const title = tip ? ` title="${escapeHtml(tip)}"` : "";
    return ` data-loot-item-id="${id}"${title}`;
  }

  function itemNameHtml(itemId, label, className = "") {
    const text = escapeHtml(label || "Item");
    const attrs = itemTipAttrs(itemId);
    const cls = ["cm-item-tip", className].filter(Boolean).join(" ");
    if (!attrs) return `<span class="${cls}">${text}</span>`;
    return `<span class="loot-item-name ${cls}"${attrs}>${text}</span>`;
  }

  function matsHtml(reagents) {
    const list = Array.isArray(reagents) ? reagents : [];
    if (!list.length) return `<li class="cm-mats-empty">Mats unknown</li>`;
    return list
      .map((r) => {
        const qty = escapeHtml(r.quantity || 1);
        const name = itemNameHtml(r.itemId, r.name || "Item");
        return `<li>${qty}× ${name}</li>`;
      })
      .join("");
  }

  function itemLabel(row) {
    return String(row?.craftedItemName || row?.recipeName || "Craft").trim();
  }

  function collectItemIds(...lists) {
    const ids = new Set();
    for (const list of lists) {
      for (const row of list || []) {
        const craftedId = Number(row?.craftedItemId) || 0;
        if (craftedId > 0) ids.add(craftedId);
        for (const reagent of Array.isArray(row?.reagents) ? row.reagents : []) {
          const id = Number(reagent?.itemId) || 0;
          if (id > 0) ids.add(id);
        }
      }
    }
    return [...ids];
  }

  async function ensureItemTooltips(itemIds) {
    const missing = itemIds.filter((id) => !state.itemMetaById.has(id));
    if (!missing.length) return;
    const chunkSize = 80;
    for (let i = 0; i < missing.length; i += chunkSize) {
      const chunk = missing.slice(i, i + chunkSize);
      try {
        const url = `/api/wow-classic/items?ids=${encodeURIComponent(chunk.join(","))}`;
        const payload = window.plbSessionApiCache
          ? await window.plbSessionApiCache.getJson(url)
          : await fetch(url, { credentials: "include" }).then(async (res) => {
              const body = await res.json().catch(() => ({}));
              if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (${res.status})`);
              return body;
            });
        for (const row of Array.isArray(payload?.items) ? payload.items : []) {
          const id = Number(row?.itemId) || 0;
          if (id > 0) state.itemMetaById.set(id, row);
        }
      } catch {
        /* tooltips are best-effort */
      }
    }
  }

  function bindItemTooltips() {
    if (!window.WowItemTooltip?.bindLootTooltipHandlers) return;
    const roots = [el.listings, el.demands, el.requests, el.dialog, el.demandDialog, el.offerDialog, el.catalogList].filter(
      Boolean
    );
    for (const root of roots) {
      window.WowItemTooltip.bindLootTooltipHandlers(root, (id) => state.itemMetaById.get(Number(id)));
    }
  }

  function patchCatalogRecipe(detail) {
    const recipeId = Number(detail?.recipeId) || 0;
    if (!recipeId) return null;
    const idx = state.catalog.findIndex((r) => Number(r.recipeId) === recipeId);
    if (idx < 0) return null;
    const next = {
      ...state.catalog[idx],
      recipeName: detail.recipeName || state.catalog[idx].recipeName,
      craftedItemId: detail.craftedItemId ?? state.catalog[idx].craftedItemId,
      craftedItemName: detail.craftedItemName || state.catalog[idx].craftedItemName,
      profession: detail.profession || state.catalog[idx].profession,
      reagents: Array.isArray(detail.reagents) ? detail.reagents : state.catalog[idx].reagents,
    };
    state.catalog[idx] = next;
    return next;
  }

  const recipeResolveInflight = new Map();

  async function resolveCatalogRecipes(recipeIds) {
    const ids = [...new Set((recipeIds || []).map(Number).filter((id) => id > 0))];
    const missing = ids.filter((id) => {
      const row = state.catalog.find((r) => Number(r.recipeId) === id);
      return row && !(Number(row.craftedItemId) > 0);
    });
    if (!missing.length) return;
    const chunkSize = 20;
    for (let i = 0; i < missing.length; i += chunkSize) {
      const chunk = missing.slice(i, i + chunkSize);
      const key = chunk.join(",");
      if (recipeResolveInflight.has(key)) {
        await recipeResolveInflight.get(key);
        continue;
      }
      const promise = (async () => {
        try {
          const payload = await api(`/api/craft-market/recipes?ids=${encodeURIComponent(chunk.join(","))}`);
          const rows = Array.isArray(payload.recipes) ? payload.recipes : [];
          const itemIds = [];
          for (const row of rows) {
            patchCatalogRecipe(row);
            const itemId = Number(row.craftedItemId) || 0;
            if (itemId > 0) itemIds.push(itemId);
          }
          if (itemIds.length) await ensureItemTooltips(itemIds);
        } catch {
          /* tooltip resolve is best-effort */
        } finally {
          recipeResolveInflight.delete(key);
        }
      })();
      recipeResolveInflight.set(key, promise);
      await promise;
    }
  }

  async function ensureCatalogRowTooltip(recipeId, event) {
    const id = Number(recipeId) || 0;
    if (!id) return;
    let row = state.catalog.find((r) => Number(r.recipeId) === id);
    if (!row) return;
    if (!(Number(row.craftedItemId) > 0)) {
      await resolveCatalogRecipes([id]);
      row = state.catalog.find((r) => Number(r.recipeId) === id) || row;
      // Refresh the hovered row markup so data-loot-item-id is present.
      const tipEl = el.catalogList?.querySelector?.(`[data-catalog-recipe="${id}"] .cm-item-tip`);
      if (tipEl && Number(row.craftedItemId) > 0) {
        tipEl.setAttribute("data-loot-item-id", String(row.craftedItemId));
        tipEl.classList.add("loot-item-name");
      }
    }
    const itemId = Number(row.craftedItemId) || 0;
    if (!itemId || !window.WowItemTooltip?.showLootTooltip) return;
    if (!state.itemMetaById.has(itemId)) await ensureItemTooltips([itemId]);
    window.WowItemTooltip.showLootTooltip(event, itemId, (lookupId) => state.itemMetaById.get(Number(lookupId)));
  }

  function sellerPortrait(row, { pictureUrl, profileHref, name }) {
    const href = String(profileHref || "").trim();
    const picture = String(pictureUrl || "").trim();
    const label = escapeHtml(name || "Player");
    const img = picture
      ? `<img class="cm-seller-portrait" src="${escapeHtml(picture)}" alt="" width="40" height="40" loading="lazy" decoding="async" />`
      : `<span class="cm-seller-portrait is-empty" aria-hidden="true">${label.slice(0, 1)}</span>`;
    return href
      ? `<a class="cm-seller-portrait-link" href="${escapeHtml(href)}" title="Open profile" aria-label="Open profile of ${label}">${img}</a>`
      : img;
  }

  function updateAuthChrome() {
    const loggedIn = Boolean(state.authUserId);
    if (el.loginHint) el.loginHint.hidden = loggedIn;
    if (el.openOfferBtn) el.openOfferBtn.disabled = false;
    if (el.openDemandBtn) el.openDemandBtn.disabled = false;
  }

  function filteredOffers() {
    const q = state.listingSearch.trim().toLowerCase();
    const offers = Array.isArray(state.offers) ? state.offers : [];
    if (!q) return offers;
    return offers.filter((o) => {
      const hay = [
        o.craftedItemName,
        o.recipeName,
        o.profession,
        o.sellerDisplayName,
        o.characterName,
        o.storeName,
        o.storeCharacterName,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function filteredDemands() {
    const q = state.demandSearch.trim().toLowerCase();
    const rows = Array.isArray(state.demands) ? state.demands : [];
    if (!q) return rows;
    return rows.filter((d) => {
      const hay = [d.craftedItemName, d.recipeName, d.profession, d.buyerDisplayName, d.crafterDisplayName, d.buyerNote]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function renderListings() {
    if (!el.listings) return;
    const offers = filteredOffers();
    if (!offers.length) {
      el.listings.innerHTML = `<p class="subtle">No offers yet. Use <strong>Create offer</strong> to publish recipes you can craft.</p>`;
      return;
    }
    el.listings.innerHTML = offers
      .map((offer) => {
        const icon =
          window.plbProfessionIcons?.iconImg(offer.profession, { className: "glb-prof-card-icon", size: 36 }) || "";
        const canRequest = Boolean(state.authUserId) && offer.userId !== state.authUserId;
        const storeName = String(offer.storeName || "").trim();
        const charName = String(offer.storeCharacterName || offer.characterName || "").trim();
        return `<article class="cm-listing-card">
          <div class="cm-listing-seller">
            ${sellerPortrait(offer, {
              pictureUrl: offer.pictureUrl,
              profileHref: offer.profileHref,
              name: offer.storeCharacterName || offer.characterName || offer.sellerDisplayName,
            })}
            <div class="cm-listing-seller-copy">
              ${storeName ? `<p class="cm-store-name">${escapeHtml(storeName)}</p>` : ""}
              <p class="cm-listing-meta">
                ${escapeHtml(offer.sellerDisplayName || "Crafter")}
                ${charName ? ` · ${escapeHtml(charName)}` : ""}
              </p>
            </div>
          </div>
          <div class="cm-listing-head">
            ${icon}
            <div class="cm-listing-copy">
              <h4 class="cm-listing-title">${itemNameHtml(offer.craftedItemId, itemLabel(offer))}</h4>
              <p class="cm-listing-meta">${escapeHtml(offer.profession || "Profession")}</p>
            </div>
          </div>
          <ul class="cm-mats">${matsHtml(offer.reagents)}</ul>
          <div class="cm-listing-actions">
            ${
              canRequest
                ? `<button type="button" class="primary-btn" data-request-offer="${escapeHtml(offer.id)}">Request</button>`
                : offer.userId === state.authUserId
                  ? `<span class="subtle">Your offer</span>`
                  : `<span class="subtle">Log in to request</span>`
            }
          </div>
        </article>`;
      })
      .join("");
    bindItemTooltips();
  }

  function renderDemands() {
    if (!el.demands) return;
    const rows = filteredDemands();
    if (!rows.length) {
      el.demands.innerHTML = `<p class="subtle">No open demand. Use <strong>Post a demand</strong> when you need a craft.</p>`;
      return;
    }
    el.demands.innerHTML = rows
      .map((demand) => {
        const icon =
          window.plbProfessionIcons?.iconImg(demand.profession, { className: "glb-prof-icon", size: 28 }) || "";
        const mineBuyer = state.authUserId && demand.buyerUserId === state.authUserId;
        const mineCrafter = state.authUserId && demand.crafterUserId === state.authUserId;
        const canProvide =
          Boolean(state.authUserId) && demand.status === "open" && demand.buyerUserId !== state.authUserId;
        const actions = [];
        if (canProvide) {
          actions.push(
            `<button type="button" class="primary-btn cm-mini-btn" data-provide-demand="${escapeHtml(demand.id)}">Provide</button>`
          );
        }
        if (mineCrafter && demand.status === "claimed") {
          actions.push(
            `<button type="button" class="primary-btn cm-mini-btn" data-fulfill-demand="${escapeHtml(demand.id)}">Mark fulfilled</button>`
          );
        }
        if ((mineBuyer || mineCrafter) && (demand.status === "open" || demand.status === "claimed")) {
          actions.push(
            `<button type="button" class="secondary-btn cm-mini-btn" data-cancel-demand="${escapeHtml(demand.id)}">Cancel</button>`
          );
        }
        const statusLabel = demand.status === "claimed" ? "Claimed" : "Open";
        return `<article class="cm-request-card cm-demand-card">
          <div class="cm-request-main">
            <div class="cm-listing-seller">
              ${sellerPortrait(demand, {
                pictureUrl: demand.buyerPictureUrl,
                profileHref: demand.buyerProfileHref,
                name: demand.buyerDisplayName,
              })}
              <div class="cm-listing-seller-copy">
                <p class="cm-store-name">${escapeHtml(demand.buyerDisplayName || "Buyer")}</p>
                <p class="cm-listing-meta"><span class="cm-pill cm-pill--${escapeHtml(demand.status)}">${statusLabel}</span></p>
              </div>
            </div>
            <div class="cm-request-title-row">${icon}<strong>${itemNameHtml(demand.craftedItemId, itemLabel(demand))}</strong></div>
            <p class="cm-request-meta">
              ${escapeHtml(demand.profession || "Profession")}
              ${
                demand.status === "claimed" && demand.crafterDisplayName
                  ? ` · Provider: ${escapeHtml(demand.crafterDisplayName)}`
                  : ""
              }
            </p>
            ${demand.buyerNote ? `<p class="cm-request-note">${escapeHtml(demand.buyerNote)}</p>` : ""}
            <ul class="cm-mats">${matsHtml(demand.reagents)}</ul>
          </div>
          ${actions.length ? `<div class="cm-request-actions">${actions.join("")}</div>` : ""}
        </article>`;
      })
      .join("");
    bindItemTooltips();
  }

  function renderRequests() {
    if (!el.requests) return;
    const rows = Array.isArray(state.requests) ? state.requests : [];
    if (!rows.length) {
      el.requests.innerHTML = `<p class="subtle">No matched deals yet.</p>`;
      return;
    }
    el.requests.innerHTML = rows
      .map((req) => {
        const mineBuyer = state.authUserId && req.buyerUserId === state.authUserId;
        const mineCrafter = state.authUserId && req.crafterUserId === state.authUserId;
        const actions = [];
        if (mineCrafter) {
          actions.push(
            `<button type="button" class="primary-btn cm-mini-btn" data-fulfill="${escapeHtml(req.id)}">Mark fulfilled</button>`
          );
        }
        if (mineBuyer || mineCrafter) {
          actions.push(
            `<button type="button" class="secondary-btn cm-mini-btn" data-cancel="${escapeHtml(req.id)}">Cancel</button>`
          );
        }
        const icon =
          window.plbProfessionIcons?.iconImg(req.profession, { className: "glb-prof-icon", size: 28 }) || "";
        return `<article class="cm-request-card">
          <div class="cm-request-main">
            <div class="cm-request-title-row">${icon}<strong>${itemNameHtml(req.craftedItemId, itemLabel(req))}</strong></div>
            <p class="cm-request-meta">
              ${escapeHtml(req.buyerDisplayName || "Buyer")} → ${escapeHtml(req.crafterDisplayName || req.characterName || "Crafter")}
              ${req.characterName ? ` · ${escapeHtml(req.characterName)}` : ""}
            </p>
            ${req.buyerNote ? `<p class="cm-request-note">${escapeHtml(req.buyerNote)}</p>` : ""}
            <ul class="cm-mats">${matsHtml(req.reagents)}</ul>
          </div>
          ${actions.length ? `<div class="cm-request-actions">${actions.join("")}</div>` : ""}
        </article>`;
      })
      .join("");
    bindItemTooltips();
  }

  function filteredRecipes() {
    const recipes = Array.isArray(state.me?.recipes) ? state.me.recipes : [];
    const q = state.recipeSearch.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) => {
      const hay = [r.recipeName, r.profession, ...(r.characters || [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  function renderRecipePicker() {
    if (!el.recipeList) return;
    const recipes = filteredRecipes();
    if (!recipes.length) {
      el.recipeList.innerHTML = `<p class="subtle">No known recipes matched.</p>`;
      return;
    }
    el.recipeList.innerHTML = recipes
      .map((recipe) => {
        const checked = state.selectedRecipeIds.has(recipe.recipeId) ? "checked" : "";
        const icon =
          window.plbProfessionIcons?.iconImg(recipe.profession, { className: "glb-prof-icon", size: 22 }) || "";
        return `<label class="cm-recipe-row">
          <input type="checkbox" data-recipe-id="${escapeHtml(recipe.recipeId)}" ${checked} />
          <span class="cm-recipe-row-main">
            ${icon}
            <span>
              <span class="cm-recipe-name">${escapeHtml(recipe.recipeName)}</span>
              <span class="cm-recipe-sub">${escapeHtml(recipe.profession)} · ${escapeHtml((recipe.characters || []).join(", "))}</span>
            </span>
          </span>
        </label>`;
      })
      .join("");
  }

  function filteredCatalogRecipes() {
    const q = state.catalogSearch.trim().toLowerCase();
    const prof = String(state.catalogProfession || "").trim().toLowerCase();
    return (Array.isArray(state.catalog) ? state.catalog : []).filter((row) => {
      if (prof && String(row.profession || "").toLowerCase() !== prof) return false;
      if (!q) return true;
      const hay = [row.craftedItemName, row.recipeName, row.profession, row.category].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  function renderCatalogProfessions() {
    if (!el.catalogProfessions) return;
    const professions = Array.isArray(state.catalogProfessions) ? state.catalogProfessions : [];
    const buttons = [
      `<button type="button" class="cm-ah-prof-btn${!state.catalogProfession ? " is-active" : ""}" data-catalog-prof="" role="tab" aria-selected="${!state.catalogProfession ? "true" : "false"}">All</button>`,
      ...professions.map((name) => {
        const active = state.catalogProfession === name;
        return `<button type="button" class="cm-ah-prof-btn${active ? " is-active" : ""}" data-catalog-prof="${escapeHtml(name)}" role="tab" aria-selected="${active ? "true" : "false"}">${escapeHtml(name)}</button>`;
      }),
    ];
    el.catalogProfessions.innerHTML = buttons.join("");
  }

  function renderCatalog({ warm = true } = {}) {
    if (!el.catalogList) return;
    const rows = filteredCatalogRecipes();
    if (!rows.length) {
      el.catalogList.innerHTML = `<p class="subtle cm-ah-empty">No matching craftables</p>`;
      if (el.catalogMeta) el.catalogMeta.textContent = "0 items";
      return;
    }
    if (
      state.selectedCatalogRecipeId &&
      !rows.some((row) => Number(row.recipeId) === Number(state.selectedCatalogRecipeId))
    ) {
      state.selectedCatalogRecipeId = null;
    }
    if (!state.selectedCatalogRecipeId && rows[0]) {
      state.selectedCatalogRecipeId = Number(rows[0].recipeId);
    }
    const byCategory = new Map();
    for (const row of rows) {
      const cat = String(row.category || "General").trim() || "General";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(row);
    }
    const groups = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    el.catalogList.innerHTML = groups
      .map(([category, list]) => {
        const items = list
          .map((recipe) => {
            const selected = Number(state.selectedCatalogRecipeId) === Number(recipe.recipeId) ? " is-selected" : "";
            const label = recipe.craftedItemName || recipe.recipeName || "Item";
            const icon =
              window.plbProfessionIcons?.iconImg(recipe.profession, { className: "glb-prof-icon", size: 18 }) || "";
            return `<button type="button" class="cm-ah-item${selected}" data-catalog-recipe="${escapeHtml(recipe.recipeId)}" role="option" aria-selected="${selected ? "true" : "false"}">
              ${icon}
              <span class="cm-ah-item-copy">
                <span class="cm-ah-item-name">${itemNameHtml(recipe.craftedItemId, label)}</span>
                <span class="cm-ah-item-sub">${escapeHtml(recipe.profession || "")}</span>
              </span>
            </button>`;
          })
          .join("");
        return `<div class="cm-ah-category">
          <p class="cm-ah-category-label">${escapeHtml(category)}</p>
          <div class="cm-ah-category-items">${items}</div>
        </div>`;
      })
      .join("");
    if (el.catalogMeta) {
      const profLabel = state.catalogProfession || "All professions";
      el.catalogMeta.textContent = `${rows.length.toLocaleString()} items · ${profLabel} · hover for tooltip`;
    }
    bindItemTooltips();
    if (!warm) return;
    const warmIds = rows
      .filter((r) => !(Number(r.craftedItemId) > 0))
      .slice(0, 40)
      .map((r) => Number(r.recipeId) || 0)
      .filter((id) => id > 0);
    if (!warmIds.length) return;
    resolveCatalogRecipes(warmIds).then(() => {
      const resolved = warmIds.some((id) => {
        const row = state.catalog.find((r) => Number(r.recipeId) === id);
        return row && Number(row.craftedItemId) > 0;
      });
      if (resolved) renderCatalog({ warm: false });
    });
  }

  function openOfferDialog() {
    if (!state.authUserId) {
      setStatus(el.status, "Log in with Discord first, then Create offer.", "error");
      return;
    }
    const claims = Array.isArray(state.me?.claims) ? state.me.claims : [];
    if (!claims.length) {
      if (el.offerDialogHint) {
        el.offerDialogHint.innerHTML = `Claim a Forever Main/Twink on <a href="/profile.html">Profile</a> before offering crafts.`;
      }
      if (el.saveOffersBtn) el.saveOffersBtn.disabled = true;
    } else {
      if (el.offerDialogHint) {
        el.offerDialogHint.textContent = "Select everything you want listed, then Publish.";
      }
      if (el.saveOffersBtn) el.saveOffersBtn.disabled = false;
    }
    renderRecipePicker();
    setStatus(el.offerStatus, "", null);
    if (typeof el.offerDialog?.showModal === "function") el.offerDialog.showModal();
  }

  async function openDemandDialog() {
    if (!state.authUserId) {
      setStatus(el.status, "Log in with Discord first, then Post a demand.", "error");
      return;
    }
    state.selectedCatalogRecipeId = null;
    state.catalogSearch = "";
    if (el.catalogSearch) el.catalogSearch.value = "";
    if (el.demandNote) el.demandNote.value = "";
    setStatus(el.demandDialogStatus, "Loading craftable catalog…", null);
    if (typeof el.demandDialog?.showModal === "function") el.demandDialog.showModal();
    try {
      await loadCatalog();
      setStatus(el.demandDialogStatus, "", null);
    } catch (error) {
      setStatus(el.demandDialogStatus, error?.message || "Failed to load craftables.", "error");
    }
  }

  function openRequestDialog(offerId) {
    const offer = state.offers.find((o) => Number(o.id) === Number(offerId));
    if (!offer || !el.dialog) return;
    state.pendingOfferId = Number(offer.id);
    if (el.dialogBody) {
      const from = offer.storeName || offer.sellerDisplayName || offer.characterName || "crafter";
      el.dialogBody.textContent = `Request ${itemLabel(offer)} from ${from}? This creates a matched deal and Discord-tags both of you.`;
    }
    if (el.dialogMats) el.dialogMats.innerHTML = matsHtml(offer.reagents);
    if (el.requestNote) el.requestNote.value = "";
    setStatus(el.dialogStatus, "", null);
    if (typeof el.dialog.showModal === "function") el.dialog.showModal();
    bindItemTooltips();
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) {
      const err = new Error(payload?.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return payload;
  }

  async function loadCatalog(force = false) {
    if (state.catalogLoaded && !force) {
      renderCatalogProfessions();
      renderCatalog();
      return;
    }
    const payload = await api("/api/craft-market/catalog");
    state.catalog = Array.isArray(payload.recipes) ? payload.recipes : [];
    state.catalogProfessions = Array.isArray(payload.professions)
      ? payload.professions
      : [...new Set(state.catalog.map((r) => r.profession).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (!state.catalogProfession && state.catalogProfessions.includes("Alchemy")) {
      state.catalogProfession = "Alchemy";
    } else if (!state.catalogProfession && state.catalogProfessions[0]) {
      state.catalogProfession = state.catalogProfessions[0];
    }
    state.catalogLoaded = true;
    renderCatalogProfessions();
    renderCatalog();
  }

  async function loadPublic() {
    setStatus(el.status, "Loading Market Hall…", null);
    const payload = await api("/api/craft-market");
    state.offers = Array.isArray(payload.offers) ? payload.offers : [];
    state.requests = Array.isArray(payload.requests) ? payload.requests : [];
    state.demands = Array.isArray(payload.demands) ? payload.demands : [];
    await ensureItemTooltips(collectItemIds(state.offers, state.requests, state.demands));
    setStatus(
      el.status,
      `${state.offers.length} offers · ${state.demands.filter((d) => d.status === "open").length} open demand · ${state.requests.length} matched`,
      "success"
    );
    renderListings();
    renderDemands();
    renderRequests();
  }

  async function loadMe() {
    try {
      const payload = await api("/api/craft-market/me");
      state.me = payload;
      state.authUserId = String(payload.seller?.userId || "").trim();
      state.selectedRecipeIds = new Set(
        (Array.isArray(payload.selectedRecipeIds) ? payload.selectedRecipeIds : []).map(Number)
      );
      updateAuthChrome();
      renderListings();
      renderDemands();
      renderRequests();
    } catch (error) {
      if (error?.status === 401) {
        state.me = null;
        state.authUserId = "";
        updateAuthChrome();
        return;
      }
      throw error;
    }
  }

  async function saveOffers() {
    setStatus(el.offerStatus, "Publishing offers…", null);
    try {
      await api("/api/craft-market/me/seller", {
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      });
      const payload = await api("/api/craft-market/me/offers", {
        method: "PUT",
        body: JSON.stringify({ recipeIds: [...state.selectedRecipeIds] }),
      });
      state.me = { ...state.me, seller: payload.seller || state.me?.seller, offers: payload.offers, selectedRecipeIds: payload.selectedRecipeIds };
      state.selectedRecipeIds = new Set((payload.selectedRecipeIds || []).map(Number));
      setStatus(el.offerStatus, `Published ${state.selectedRecipeIds.size} offers.`, "success");
      await loadPublic();
      el.offerDialog?.close();
    } catch (error) {
      setStatus(el.offerStatus, error?.message || "Failed to publish offers.", "error");
    }
  }

  async function submitRequest(note) {
    if (!state.pendingOfferId) return;
    setStatus(el.dialogStatus, "Sending request…", null);
    try {
      await api("/api/craft-market/requests", {
        method: "POST",
        body: JSON.stringify({ offerId: state.pendingOfferId, note }),
      });
      setStatus(el.dialogStatus, "Request posted.", "success");
      el.dialog?.close();
      await loadPublic();
    } catch (error) {
      setStatus(el.dialogStatus, error?.message || "Failed to create request.", "error");
    }
  }

  async function submitDemand(note) {
    if (!state.selectedCatalogRecipeId) {
      setStatus(el.demandDialogStatus, "Pick an item from the catalog.", "error");
      return;
    }
    setStatus(el.demandDialogStatus, "Posting demand…", null);
    try {
      await api("/api/craft-market/demands", {
        method: "POST",
        body: JSON.stringify({ recipeId: state.selectedCatalogRecipeId, note }),
      });
      setStatus(el.demandDialogStatus, "Demand posted.", "success");
      el.demandDialog?.close();
      await loadPublic();
    } catch (error) {
      setStatus(el.demandDialogStatus, error?.message || "Failed to post demand.", "error");
    }
  }

  let catalogTimer = null;

  function wire() {
    el.listingSearch?.addEventListener("input", () => {
      state.listingSearch = el.listingSearch.value || "";
      renderListings();
    });
    el.demandSearch?.addEventListener("input", () => {
      state.demandSearch = el.demandSearch.value || "";
      renderDemands();
    });
    el.openOfferBtn?.addEventListener("click", () => openOfferDialog());
    el.openDemandBtn?.addEventListener("click", () => openDemandDialog());
    el.offerDialogClose?.addEventListener("click", () => el.offerDialog?.close());
    el.recipeSearch?.addEventListener("input", () => {
      state.recipeSearch = el.recipeSearch.value || "";
      renderRecipePicker();
    });
    el.saveOffersBtn?.addEventListener("click", () => saveOffers());
    el.recipeList?.addEventListener("change", (event) => {
      const input = event.target?.closest?.("input[data-recipe-id]");
      if (!input) return;
      const id = Number(input.getAttribute("data-recipe-id"));
      if (!Number.isFinite(id)) return;
      if (input.checked) state.selectedRecipeIds.add(id);
      else state.selectedRecipeIds.delete(id);
    });
    el.catalogSearch?.addEventListener("input", () => {
      state.catalogSearch = el.catalogSearch.value || "";
      clearTimeout(catalogTimer);
      catalogTimer = setTimeout(() => renderCatalog(), 120);
    });
    el.catalogProfessions?.addEventListener("click", (event) => {
      const btn = event.target?.closest?.("[data-catalog-prof]");
      if (!btn) return;
      state.catalogProfession = btn.getAttribute("data-catalog-prof") || "";
      state.selectedCatalogRecipeId = null;
      renderCatalogProfessions();
      renderCatalog();
    });
    el.catalogList?.addEventListener("click", (event) => {
      const btn = event.target?.closest?.("[data-catalog-recipe]");
      if (!btn || !el.catalogList.contains(btn)) return;
      state.selectedCatalogRecipeId = Number(btn.getAttribute("data-catalog-recipe")) || null;
      renderCatalog({ warm: false });
    });
    el.catalogList?.addEventListener("dblclick", (event) => {
      const btn = event.target?.closest?.("[data-catalog-recipe]");
      if (!btn || !el.catalogList.contains(btn)) return;
      state.selectedCatalogRecipeId = Number(btn.getAttribute("data-catalog-recipe")) || null;
      if (state.selectedCatalogRecipeId) {
        submitDemand(String(el.demandNote?.value || "").trim());
      }
    });
    el.catalogList?.addEventListener("mouseover", (event) => {
      const btn = event.target?.closest?.("[data-catalog-recipe]");
      if (!btn || !el.catalogList.contains(btn)) return;
      if (btn.dataset.tipBound === "1") return;
      btn.dataset.tipBound = "1";
      ensureCatalogRowTooltip(btn.getAttribute("data-catalog-recipe"), event).finally(() => {
        // Allow another resolve attempt later if the first failed.
        setTimeout(() => {
          delete btn.dataset.tipBound;
        }, 1500);
      });
    });
    el.catalogList?.addEventListener("mousemove", (event) => {
      if (!window.WowItemTooltip?.positionLootTooltip) return;
      const tipEl = event.target?.closest?.("[data-loot-item-id]");
      if (!tipEl || !el.catalogList.contains(tipEl)) return;
      window.WowItemTooltip.positionLootTooltip(event);
    });
    el.catalogList?.addEventListener("mouseleave", () => {
      window.WowItemTooltip?.hideLootTooltip?.();
    });
    el.listings?.addEventListener("click", (event) => {
      const btn = event.target?.closest?.("[data-request-offer]");
      if (!btn) return;
      openRequestDialog(btn.getAttribute("data-request-offer"));
    });
    el.demands?.addEventListener("click", async (event) => {
      const provide = event.target?.closest?.("[data-provide-demand]");
      const fulfill = event.target?.closest?.("[data-fulfill-demand]");
      const cancel = event.target?.closest?.("[data-cancel-demand]");
      try {
        if (provide) {
          setStatus(el.status, "Claiming demand…", null);
          await api(`/api/craft-market/demands/${encodeURIComponent(provide.getAttribute("data-provide-demand"))}/provide`, {
            method: "POST",
            body: "{}",
          });
          await loadPublic();
        } else if (fulfill) {
          await api(`/api/craft-market/demands/${encodeURIComponent(fulfill.getAttribute("data-fulfill-demand"))}/fulfilled`, {
            method: "POST",
            body: "{}",
          });
          await loadPublic();
        } else if (cancel) {
          await api(`/api/craft-market/demands/${encodeURIComponent(cancel.getAttribute("data-cancel-demand"))}/cancel`, {
            method: "POST",
            body: "{}",
          });
          await loadPublic();
        }
      } catch (error) {
        setStatus(el.status, error?.message || "Demand update failed.", "error");
      }
    });
    el.requests?.addEventListener("click", async (event) => {
      const fulfill = event.target?.closest?.("[data-fulfill]");
      const cancel = event.target?.closest?.("[data-cancel]");
      try {
        if (fulfill) {
          await api(`/api/craft-market/requests/${encodeURIComponent(fulfill.getAttribute("data-fulfill"))}/fulfilled`, {
            method: "POST",
            body: "{}",
          });
          await loadPublic();
        } else if (cancel) {
          await api(`/api/craft-market/requests/${encodeURIComponent(cancel.getAttribute("data-cancel"))}/cancel`, {
            method: "POST",
            body: "{}",
          });
          await loadPublic();
        }
      } catch (error) {
        setStatus(el.status, error?.message || "Request update failed.", "error");
      }
    });
    el.requestForm?.addEventListener("submit", (event) => {
      const submitter = event.submitter;
      const value = submitter?.value || "cancel";
      if (value !== "confirm") return;
      event.preventDefault();
      submitRequest(String(el.requestNote?.value || "").trim());
    });
    el.demandForm?.addEventListener("submit", (event) => {
      const submitter = event.submitter;
      const value = submitter?.value || "cancel";
      if (value !== "confirm") return;
      event.preventDefault();
      submitDemand(String(el.demandNote?.value || "").trim());
    });
  }

  async function init() {
    wire();
    updateAuthChrome();
    try {
      await loadPublic();
      await loadMe();
    } catch (error) {
      setStatus(el.status, error?.message || "Failed to load Market Hall.", "error");
    }
  }

  init();
})();
