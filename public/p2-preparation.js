function clampInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function pct(current, required) {
  if (required <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((current / required) * 100)));
}

async function updateMaterialCurrent(id, current) {
  const res = await fetch("/api/p2-preparation/materials/current", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, current }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error || "Update failed");
  }
}

function renderTable(rows, canEdit) {
  const host = document.getElementById("p2Table");
  const totalRequired = rows.reduce((sum, r) => sum + r.required, 0);
  const totalCurrentCapped = rows.reduce((sum, r) => sum + Math.min(r.required, clampInt(r.current)), 0);
  const overallPct = pct(totalCurrentCapped, totalRequired);

  host.innerHTML = `
    <table class="p2-table">
      <thead>
        <tr>
          <th>Material</th>
          <th>Required</th>
          <th>Current</th>
          <th>Progress</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const progress = pct(clampInt(row.current), row.required);
            return `
              <tr>
                <td>${row.name}</td>
                <td>${row.required}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    class="p2-current-input"
                    data-material-id="${row.id}"
                    value="${clampInt(row.current)}"
                    ${canEdit ? "" : "disabled"}
                  />
                </td>
                <td>
                  <div class="p2-progress-cell">
                    <div class="p2-progress-bar"><span style="width:${progress}%"></span></div>
                    <span>${progress}%</span>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;

  const overallText = document.getElementById("p2OverallText");
  const overallBar = document.getElementById("p2OverallBar");
  overallText.textContent = `${overallPct}% · ${totalCurrentCapped}/${totalRequired}`;
  overallBar.style.width = `${overallPct}%`;

  const noteId = "p2EditNote";
  const prev = document.getElementById(noteId);
  if (prev) prev.remove();
  const note = document.createElement("p");
  note.id = noteId;
  note.className = "subtle";
  note.textContent = canEdit
    ? "Editor mode: you can update current values."
    : "Read-only mode: only authorized Discord editor can update current values.";
  host.insertAdjacentElement("beforebegin", note);

  if (!canEdit) return;
  host.querySelectorAll(".p2-current-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const id = String(input.getAttribute("data-material-id") || "");
      const value = clampInt(input.value);
      input.disabled = true;
      try {
        await updateMaterialCurrent(id, value);
        await loadAndRender();
      } catch (error) {
        window.alert(error?.message || "Failed to update current value");
        await loadAndRender();
      }
    });
  });
}

async function loadAndRender() {
  const res = await fetch("/api/p2-preparation/materials", { credentials: "include" });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false || !Array.isArray(payload?.materials)) {
    throw new Error(payload?.error || "Failed to load material tracker");
  }
  renderTable(payload.materials, Boolean(payload.canEdit));
}

loadAndRender().catch((error) => {
  const host = document.getElementById("p2Table");
  host.innerHTML = `<div class="subtle">${String(error?.message || "Failed to load")}</div>`;
});
