/**
 * Session-scoped GET JSON cache (tab lifetime): 5-minute freshness window with stale-while-revalidate.
 * Only stores successful responses (HTTP ok, not `{ ok: false }`). Cleared on logout via `clearAll()`.
 */
(function () {
  const PREFIX = "plb-api-v1:";
  const TTL_MS = 5 * 60 * 1000;
  const inFlight = new Set();

  function shouldBypassCache(url) {
    try {
      const u = new URL(url, window.location.origin);
      const p = u.pathname;
      if (p.startsWith("/api/auth/")) return true;
      if (p === "/api/voting/current") return true;
      if (p === "/api/raid-helper/future-events") return true;
      if (p === "/api/nether-vortex/needs") return true;
      return false;
    } catch {
      return true;
    }
  }

  function cacheKey(url, credentials) {
    return `${PREFIX}${credentials}:${url}`;
  }

  function readEntry(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.at !== "number" || o.body === undefined) return null;
      return o;
    } catch {
      return null;
    }
  }

  function writeEntry(key, body) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), body }));
    } catch {
      /* QuotaExceeded / private mode */
    }
  }

  function shouldStoreBody(body) {
    if (body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "ok") && body.ok === false) {
      return false;
    }
    return true;
  }

  async function parseSuccess(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
      throw new Error(msg);
    }
    if (body && typeof body === "object" && body.ok === false) {
      throw new Error(typeof body.error === "string" ? body.error : "Request failed");
    }
    return body;
  }

  async function directGetJson(url, fetchInit) {
    const res = await fetch(url, { method: "GET", ...fetchInit });
    return parseSuccess(res);
  }

  async function revalidate(url, keyStr, fetchInit) {
    if (inFlight.has(keyStr)) return;
    inFlight.add(keyStr);
    try {
      const res = await fetch(url, { method: "GET", ...fetchInit });
      const body = await res.json().catch(() => null);
      if (res.ok && body != null && shouldStoreBody(body)) {
        writeEntry(keyStr, body);
      }
    } finally {
      inFlight.delete(keyStr);
    }
  }

  /**
   * @param {string} url
   * @param {RequestInit & { skipCache?: boolean }} [init]
   */
  async function getJson(url, init) {
    const initObj = init || {};
    const { skipCache, ...fetchInit } = initObj;
    const method = String(fetchInit.method || "GET").toUpperCase();
    if (method !== "GET") {
      const res = await fetch(url, fetchInit);
      return parseSuccess(res);
    }

    const cred =
      fetchInit.credentials !== undefined ? String(fetchInit.credentials) : "same-origin";

    if (skipCache || shouldBypassCache(url)) {
      return directGetJson(url, fetchInit);
    }

    const key = cacheKey(url, cred);
    const cached = readEntry(key);
    if (cached) {
      void revalidate(url, key, fetchInit);
      return cached.body;
    }

    const body = await directGetJson(url, fetchInit);
    if (shouldStoreBody(body)) writeEntry(key, body);
    return body;
  }

  function clearAll() {
    const prefixes = [PREFIX, "plb-lb-sess-v1:"];
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k) continue;
      if (prefixes.some((p) => k.startsWith(p))) keys.push(k);
    }
    for (const k of keys) {
      try {
        sessionStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }

  window.plbSessionApiCache = {
    getJson,
    clearAll,
    TTL_MS,
  };
})();
