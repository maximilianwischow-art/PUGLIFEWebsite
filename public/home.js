function initBackgroundStars() {
  const el = document.getElementById("stars");
  if (!el || el.childElementCount > 0) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 70; i += 1) {
    const s = document.createElement("div");
    s.className = "star";
    const sz = Math.random() * 1.8 + 0.4;
    const o = 0.08 + Math.random() * 0.35;
    s.style.cssText = `width:${sz}px;height:${sz}px;top:${Math.random() * 100}%;left:${Math.random() * 100}%;--d:${2 + Math.random() * 4}s;--dl:${Math.random() * 4}s;--o:${o}`;
    frag.appendChild(s);
  }
  el.appendChild(frag);
}

function formatPhaseCountdown(totalSec) {
  if (totalSec <= 0) return "Live now";
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

function startPhase2Countdown() {
  const output = document.getElementById("phase2CountdownValue");
  if (!output) return;

  const update = () => {
    const now = Math.floor(Date.now() / 1000);
    const releaseTs = Math.floor(new Date(2026, 4, 14, 0, 0, 0).getTime() / 1000);
    output.textContent = formatPhaseCountdown(releaseTs - now);
  };

  update();
  setInterval(update, 1000);
}

initBackgroundStars();
startPhase2Countdown();
