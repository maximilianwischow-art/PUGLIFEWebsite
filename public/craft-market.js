(() => {
  const state = {
    me: null,
    offers: [],
    requests: [],
    listingSearch: "",
    recipeSearch: "",
    selectedRecipeIds: new Set(),
    pendingOfferId: null,
    authUserId: "",
    itemMetaById: new Map(),
  };

  const el = {
    status: document.getElementById("cmStatus"),
    requests: document.getElementById("cmRequests"),
    listings: document.getElementById("cmListings"),
    listingSearch: document.getElementById("cmListingSearch"),
    sellerCard: document.getElementById("cmSellerCard"),
    sellerEnabled: document.getElementById("cmSellerEnabled"),
    sellerHint: document.getElementById("cmSellerHint"),
    offerTools: document.getElementById("cmOfferTools"),
    recipeSearch: document.getElementById("cmRecipeSearch"),
    recipeList: document.getElementById("cmRecipeList"),
    offerStatus: document.getElementById("cmOfferStatus"),
    saveOffersBtn: document.getElementById("cmSaveOffersBtn"),
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

  function collectItemIds(offers, requests) {
    const ids = new Set();
    for (const row of [...(offers || []), ...(requests || [])]) {
      const craftedId = Number(row?.craftedItemId) || 0;
      if (craftedId > 0) ids.add(craftedId);
      for (const reagent of Array.isArray(row?.reagents) ? row.reagents : []) {
        const id = Number(reagent?.itemId) || 0;
        if (id > 0) ids.add(id);
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
    const roots = [el.listings, el.requests, el.dialog].filter(Boolean);
    for (const root of roots) {
      window.WowItemTooltip.bindLootTooltipHandlers(root, (id) => state.itemMetaById.get(Number(id)));
    }
  }

  function renderRequests() {
    if (!el.requests) return;
    const rows = Array.isArray(state.requests) ? state.requests : [];
    if (!rows.length) {
      el.requests.innerHTML = `<p class="subtle">No open craft requests right now.</p>`;
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

  function sellerPortrait(offer) {
    const href = String(offer.profileHref || "").trim();
    const picture = String(offer.pictureUrl || "").trim();
    const label = escapeHtml(offer.storeCharacterName || offer.characterName || offer.sellerDisplayName || "Crafter");
    const img = picture
      ? `<img class="cm-seller-portrait" src="${escapeHtml(picture)}" alt="" width="40" height="40" loading="lazy" decoding="async" />`
      : `<span class="cm-seller-portrait is-empty" aria-hidden="true">${label.slice(0, 1)}</span>`;
    return href
      ? `<a class="cm-seller-portrait-link" href="${escapeHtml(href)}" title="Open profile" aria-label="Open profile of ${label}">${img}</a>`
      : img;
  }

  function renderListings() {
    if (!el.listings) return;
    const offers = filteredOffers();
    if (!offers.length) {
      el.listings.innerHTML = `<p class="subtle">No craft listings yet. Log in and publish offers below.</p>`;
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
            ${sellerPortrait(offer)}
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

  function renderSeller() {
    if (!el.sellerCard) return;
    if (!state.me) {
      el.sellerCard.hidden = true;
      return;
    }
    el.sellerCard.hidden = false;
    const claims = Array.isArray(state.me.claims) ? state.me.claims : [];
    const enabled = Boolean(state.me.seller?.enabled);
    if (el.sellerEnabled) el.sellerEnabled.checked = enabled;
    if (!claims.length) {
      if (el.sellerHint) {
        el.sellerHint.innerHTML = `Claim a Forever Main/Twink on <a href="/profile.html">Profile</a> before offering crafts.`;
      }
      if (el.offerTools) el.offerTools.hidden = true;
      return;
    }
    if (el.sellerHint) {
      el.sellerHint.textContent = enabled
        ? "Select the recipes you want listed. Buyers can request them immediately."
        : "Enable offering to publish selected recipes on the Market Hall.";
    }
    if (el.offerTools) el.offerTools.hidden = !enabled;
    renderRecipePicker();
  }

  function openRequestDialog(offerId) {
    const offer = state.offers.find((o) => Number(o.id) === Number(offerId));
    if (!offer || !el.dialog) return;
    state.pendingOfferId = Number(offer.id);
    if (el.dialogBody) {
      const from = offer.storeName || offer.sellerDisplayName || offer.characterName || "crafter";
      el.dialogBody.textContent = `Request ${itemLabel(offer)} from ${from}? This posts to Market Hall and Discord.`;
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

  async function loadPublic() {
    setStatus(el.status, "Loading Market Hall…", null);
    const payload = await api("/api/craft-market");
    state.offers = Array.isArray(payload.offers) ? payload.offers : [];
    state.requests = Array.isArray(payload.requests) ? payload.requests : [];
    await ensureItemTooltips(collectItemIds(state.offers, state.requests));
    setStatus(
      el.status,
      `${state.offers.length} listings · ${state.requests.length} open requests`,
      "success"
    );
    renderListings();
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
      renderSeller();
      renderListings();
      renderRequests();
    } catch (error) {
      if (error?.status === 401) {
        state.me = null;
        state.authUserId = "";
        if (el.sellerCard) el.sellerCard.hidden = true;
        return;
      }
      throw error;
    }
  }

  async function saveOffers() {
    setStatus(el.offerStatus, "Saving offers…", null);
    try {
      const payload = await api("/api/craft-market/me/offers", {
        method: "PUT",
        body: JSON.stringify({ recipeIds: [...state.selectedRecipeIds] }),
      });
      state.me = { ...state.me, offers: payload.offers, selectedRecipeIds: payload.selectedRecipeIds };
      state.selectedRecipeIds = new Set((payload.selectedRecipeIds || []).map(Number));
      setStatus(el.offerStatus, `Saved ${state.selectedRecipeIds.size} offers.`, "success");
      await loadPublic();
      renderSeller();
    } catch (error) {
      setStatus(el.offerStatus, error?.message || "Failed to save offers.", "error");
    }
  }

  async function toggleSeller(enabled) {
    try {
      const payload = await api("/api/craft-market/me/seller", {
        method: "POST",
        body: JSON.stringify({ enabled: Boolean(enabled) }),
      });
      state.me = { ...state.me, seller: payload.seller };
      renderSeller();
      await loadPublic();
    } catch (error) {
      if (el.sellerEnabled) el.sellerEnabled.checked = !enabled;
      setStatus(el.offerStatus, error?.message || "Failed to update seller status.", "error");
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

  function wire() {
    el.listingSearch?.addEventListener("input", () => {
      state.listingSearch = el.listingSearch.value || "";
      renderListings();
    });
    el.recipeSearch?.addEventListener("input", () => {
      state.recipeSearch = el.recipeSearch.value || "";
      renderRecipePicker();
    });
    el.sellerEnabled?.addEventListener("change", () => toggleSeller(el.sellerEnabled.checked));
    el.saveOffersBtn?.addEventListener("click", () => saveOffers());
    el.recipeList?.addEventListener("change", (event) => {
      const input = event.target?.closest?.("input[data-recipe-id]");
      if (!input) return;
      const id = Number(input.getAttribute("data-recipe-id"));
      if (!Number.isFinite(id)) return;
      if (input.checked) state.selectedRecipeIds.add(id);
      else state.selectedRecipeIds.delete(id);
    });
    el.listings?.addEventListener("click", (event) => {
      const btn = event.target?.closest?.("[data-request-offer]");
      if (!btn) return;
      openRequestDialog(btn.getAttribute("data-request-offer"));
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
  }

  async function init() {
    wire();
    try {
      await loadPublic();
      await loadMe();
    } catch (error) {
      setStatus(el.status, error?.message || "Failed to load Market Hall.", "error");
    }
  }

  init();
})();
