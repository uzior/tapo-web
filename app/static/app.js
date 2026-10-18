"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  stream: "hd",
  hls: null,
  liveOn: false,
  manualRecId: null,
  online: false,
  ptz: false,
};

// ---------- helpers ----------
async function api(path, opts) {
  if (state.shuttingDown) throw new Error("Serwer kończy pracę.");
  const res = await fetch(path, opts);
  let body = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body && (body.detail || body.reason)) ||
      (res.status >= 500 ? "Błąd serwera" : `Błąd żądania (HTTP ${res.status})`);
    throw new Error(msg);
  }
  return body;
}

let toastTimer = null;
function toast(msg, kind = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (kind ? " " + kind : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3600);
}

function fmtSize(b) {
  if (b == null) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  const digits = i > 0 && Math.round(b * 10) / 10 < 10 ? 1 : 0;
  return b.toLocaleString("pl-PL", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " " + u[i];
}
function fmtDur(s) {
  if (s == null) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

// ---------- tabs ----------
function showTab(name) {
  const tab = $(`.tab[data-tab="${name}"]`);
  if (!tab) return;
  $$(".tab").forEach((t) => t.classList.remove("active"));
  $$(".panel").forEach((p) => p.classList.remove("active"));
  tab.classList.add("active");
  $("#tab-" + name).classList.add("active");
  if (name === "library") loadLibrary();
  if (name === "sd") loadSd();
  if (name === "animals") loadAnimals();
}
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    history.replaceState(null, "", "#" + tab.dataset.tab);
    showTab(tab.dataset.tab);
  });
});

// ---------- status ----------
async function refreshStatus() {
  if (state.shuttingDown) return;
  try {
    const s = await api("/api/status");
    state.online = s.online;
    state.ptz = s.ptz;
    $("#statusdot").className = "dot " + (s.online ? "online" : "offline");
    $("#statustext").textContent = s.online ? "Kamera połączona" : "Brak połączenia z kamerą";
    const meta = [];
    if (s.host) meta.push(s.host);
    if (s.model) meta.push(s.model);
    if (s.firmware) meta.push("fw " + s.firmware);
    $("#statusmeta").textContent = meta.length ? "· " + meta.join(" · ") : "";
    $("#ptz-group").hidden = !s.ptz;
    $("#cont-toggle").checked = !!s.continuous;
    $("#cont-label").textContent = s.continuous ? "Włączone" : "Wyłączone";
  } catch (e) {
    $("#statusdot").className = "dot offline";
    $("#statustext").textContent = "Nie udało się odczytać statusu";
  }
}

$("#btn-discover").addEventListener("click", async () => {
  $("#statustext").textContent = "Wyszukiwanie…";
  try {
    await api("/api/discover", { method: "POST" });
  } catch (e) { toast(e.message, "err"); }
  refreshStatus();
});

// ---------- stream selector ----------
$("#stream-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  $$("#stream-seg button").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  state.stream = b.dataset.stream;
  if (state.liveOn) startLive(); // restart on the newly selected stream
});

// ---------- live ----------
function startLive() {
  const video = $("#live");
  const url = `/live/${state.stream}/index.m3u8`;
  stopHls();
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, maxBufferLength: 6 });
    state.hls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else { toast("Błąd podglądu: " + (data.details || ""), "err"); stopLive(); }
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url; // Safari native HLS
    video.play().catch(() => {});
  } else {
    toast("Ta przeglądarka nie obsługuje HLS", "err");
    return;
  }
  state.liveOn = true;
  $("#live-overlay").hidden = true;
}
function stopHls() {
  if (state.hls) { try { state.hls.destroy(); } catch (e) {} state.hls = null; }
}
function stopLive() {
  stopHls();
  const video = $("#live");
  video.pause();
  video.removeAttribute("src");
  video.load();
  state.liveOn = false;
  $("#live-overlay").hidden = false;
  api(`/api/live/${state.stream}/stop`, { method: "POST" }).catch(() => {});
}
$("#btn-play").addEventListener("click", startLive);
$("#btn-live-start").addEventListener("click", startLive);
$("#btn-live-stop").addEventListener("click", stopLive);

// ---------- snapshot ----------
$("#btn-snap").addEventListener("click", async () => {
  toast("Wykonywanie zdjęcia…");
  try {
    const res = await fetch(`/api/snapshot?stream=${state.stream}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "niepowodzenie");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snapshot_${Date.now()}.jpg`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Zapisano zdjęcie", "ok");
  } catch (e) { toast(e.message, "err"); }
});

// ---------- manual recording ----------
$("#btn-rec-start").addEventListener("click", async () => {
  try {
    const r = await api(`/api/record/start?stream=${state.stream}`, { method: "POST" });
    state.manualRecId = r.id;
    $("#btn-rec-start").disabled = true;
    $("#btn-rec-stop").disabled = false;
    $("#rec-badge").hidden = false;
    $("#rec-hint").textContent = "Trwa nagrywanie → " + r.target;
    toast("Rozpoczęto nagrywanie", "ok");
  } catch (e) { toast(e.message, "err"); }
});
$("#btn-rec-stop").addEventListener("click", async () => {
  if (!state.manualRecId) return;
  try {
    await api(`/api/record/stop?id=${encodeURIComponent(state.manualRecId)}`, { method: "POST" });
    toast("Zatrzymano nagrywanie", "ok");
  } catch (e) { toast(e.message, "err"); }
  state.manualRecId = null;
  $("#btn-rec-start").disabled = false;
  $("#btn-rec-stop").disabled = true;
  $("#rec-badge").hidden = true;
  $("#rec-hint").textContent = "Zapisuje obraz i dźwięk w lokalnym pliku MP4.";
});

// ---------- continuous DVR ----------
$("#cont-toggle").addEventListener("change", async (e) => {
  const on = e.target.checked;
  try {
    if (on) await api(`/api/continuous/start?stream=${state.stream}`, { method: "POST" });
    else await api(`/api/continuous/stop`, { method: "POST" });
    $("#cont-label").textContent = on ? "Włączone" : "Wyłączone";
    toast(on ? "Włączono nagrywanie ciągłe" : "Zatrzymano nagrywanie ciągłe", "ok");
  } catch (err) {
    e.target.checked = !on;
    toast(err.message, "err");
  }
});

// ---------- PTZ ----------
$$(".ptzpad button[data-dir]").forEach((b) => {
  b.addEventListener("click", async () => {
    try { await api(`/api/ptz?direction=${b.dataset.dir}`, { method: "POST" }); }
    catch (e) { toast(e.message, "err"); }
  });
});

// ---------- library ----------
async function loadLibrary() {
  const grid = $("#lib-grid");
  try {
    const data = await api("/api/recordings");
    const recs = data.recordings || [];
    $("#lib-empty").hidden = recs.length > 0;
    grid.innerHTML = "";
    for (const r of recs) grid.appendChild(card(r));
  } catch (e) { toast(e.message, "err"); }
}

function card(r) {
  const el = document.createElement("div");
  el.className = "card";
  const res = r.width && r.height ? `${r.width}×${r.height}` : "";
  el.innerHTML = `
    <div class="thumb" style="background-image:url('/api/recordings/${encodeURIComponent(r.name)}/thumb')">
      <span class="badge ${r.kind}">${r.kind === "continuous" ? "DVR" : "Ręczne"}</span>
      ${r.duration != null ? `<span class="dur">${fmtDur(r.duration)}</span>` : ""}
    </div>
    <div class="body">
      <div class="fname">${r.name}</div>
      <div class="cmeta">
        <span>${r.created}</span><span>${fmtSize(r.size)}</span>${res ? `<span>${res}</span>` : ""}
      </div>
      <div class="actions">
        <button class="btn play">▶ Odtwórz</button>
        <a class="btn ghost dl" href="/api/recordings/${encodeURIComponent(r.name)}/download">⬇</a>
        <button class="btn danger del">🗑</button>
      </div>
    </div>`;
  el.querySelector(".thumb").addEventListener("click", () => openPlayer(r.name));
  el.querySelector(".play").addEventListener("click", () => openPlayer(r.name));
  el.querySelector(".del").addEventListener("click", async () => {
    if (!confirm(`Usunąć ${r.name}?`)) return;
    try {
      await api(`/api/recordings/${encodeURIComponent(r.name)}`, { method: "DELETE" });
      toast("Usunięto", "ok");
      loadLibrary();
    } catch (e) { toast(e.message, "err"); }
  });
  return el;
}

$("#btn-lib-refresh").addEventListener("click", loadLibrary);

// ---------- player modal ----------
function openPlayer(name) {
  $("#modal-title").textContent = name;
  const p = $("#player");
  p.src = `/api/recordings/${encodeURIComponent(name)}/play`;
  $("#modal-download").href = `/api/recordings/${encodeURIComponent(name)}/download`;
  $("#modal-download").hidden = false;
  $("#modal-sd-download").hidden = true;
  $("#modal-fetch").hidden = true;
  $("#modal").hidden = false;
  p.play().catch(() => {});
}
function closePlayer() {
  closeSdPlayer();
  const p = $("#player");
  p.pause();
  p.removeAttribute("src");
  p.load();
  $("#modal").hidden = true;
}
$("#modal-close").addEventListener("click", closePlayer);
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closePlayer(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closePlayer(); });

// ---------- SD card ----------
// Recordings are listed through the camera's control API and pulled from its
// media port (~10x realtime). "Lire" plays an HLS stream that grows while the
// clip is being fetched; the finished MP4 is kept as a local copy for instant
// replay and download. Thumbnails are the camera's own snapshots (lazy-loaded).
const sd = {
  days: [], date: null, month: null, clips: [],
  pollTimer: null,
  filter: "all", aniDays: {}, aniTimer: null,
  wantFile: new Set(),   // clip ids whose file the user asked to save once fetched
  player: null,          // { id, hls, timer, started }
};

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const sdDate = (ymd) => new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
const jobActive = (j) => !!j && ["queued", "connecting", "streaming", "finalizing"].includes(j.state);
const sdClip = (id) => sd.clips.find((c) => c.id === id);

async function loadSd(force = false) {
  const card = $("#sd-card");
  card.className = "sd-card";
  card.textContent = "Łączenie z kamerą…";
  const q = force ? "?force=true" : "";
  try {
    const st = await api("/api/sd/status" + q);
    renderSdCard(st);
    if (!st.available) { $("#sd-layout").hidden = true; return; }
    sd.days = (await api("/api/sd/days" + q)).days || [];
    $("#sd-layout").hidden = false;
    if (!sd.days.length) {
      sd.date = null; sd.clips = [];
      renderCalendar(); renderDay();
      return;
    }
    if (!sd.date || !sd.days.includes(sd.date)) sd.date = sd.days[sd.days.length - 1];
    sd.month = sd.date.slice(0, 6);
    api("/api/sd/animals/days").then((d) => { sd.aniDays = d.days || {}; renderCalendar(); }).catch(() => {});
    renderCalendar();
    await loadDay(sd.date, force);
  } catch (e) {
    $("#sd-layout").hidden = true;
    card.className = "sd-card err";
    card.replaceChildren(
      h("div", { text: "Nie można odczytać karty SD: " + e.message }),
      h("button", { class: "btn ghost retry", text: "Spróbuj ponownie", onclick: () => loadSd(true) }));
  }
}

function renderSdCard(st) {
  const card = $("#sd-card");
  if (!st.available) {
    card.className = "sd-card err";
    card.replaceChildren(
      h("div", { class: "sd-card-line" }, h("span", { class: "pill bad", text: "Niedostępna" }),
        h("span", { text: st.reason || "Karta SD inaccessible." })),
      h("button", { class: "btn ghost retry", text: "Spróbuj ponownie", onclick: () => loadSd(true) }));
    return;
  }
  const c = st.card || {}, local = st.cached || {};
  const used = c.total ? Math.min(100, Math.round(100 * (c.total - (c.free || 0)) / c.total)) : null;
  const line = h("div", { class: "sd-card-line" },
    h("span", { class: "pill", text: "Karta działa" }),
    c.total != null && h("span", {}, "Pojemność ", h("b", { text: fmtSize(c.total) })),
    c.free != null && h("span", {}, "Wolne miejsce ", h("b", { text: fmtSize(c.free) })),
    c.loop && h("span", { text: "Nagrywanie w pętli" }),
    c.oldest && h("span", {}, "Nagrania od ", h("b", { text: new Date(c.oldest * 1000).toLocaleDateString("pl-PL") })),
    h("span", {}, "Kopie lokalne ", h("b", { text: `${local.count || 0}` }),
      local.bytes ? ` (${fmtSize(local.bytes)})` : ""));
  card.replaceChildren(line);
  if (used != null) card.append(h("div", { class: "meter", title: `${used}% zajęte` }, h("div", { style: `width:${used}%` })));
}

// ---- calendar
function renderCalendar() {
  const grid = $("#cal-grid");
  const months = [...new Set(sd.days.map((d) => d.slice(0, 6)))];
  if (!sd.month) sd.month = months[months.length - 1] || null;
  if (!sd.month) { grid.replaceChildren(); $("#cal-title").textContent = "-"; return; }
  const y = +sd.month.slice(0, 4), m = +sd.month.slice(4, 6) - 1;
  $("#cal-title").textContent = new Date(y, m, 1).toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  $("#cal-prev").disabled = !months.some((x) => x < sd.month);
  $("#cal-next").disabled = !months.some((x) => x > sd.month);
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;      // Monday-first
  const count = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h("span", { class: "pad" }));
  for (let d = 1; d <= count; d++) {
    const ymd = sd.month + String(d).padStart(2, "0");
    const has = sd.days.includes(ymd);
    cells.push(h("button", {
      class: (has ? "has" : "") + (ymd === sd.date ? " sel" : "") + ((sd.aniDays[ymd] || {}).animals ? " ani" : ""), text: String(d),
      disabled: !has, "aria-pressed": ymd === sd.date ? "true" : "false",
      "aria-label": sdDate(ymd).toLocaleDateString("pl-PL", { day: "numeric", month: "long" }) + (has ? "" : " (brak nagrań)"),
      onclick: () => { sd.date = ymd; renderCalendar(); loadDay(ymd); },
    }));
  }
  grid.replaceChildren(...cells);
}
function shiftMonth(dir) {
  const months = [...new Set(sd.days.map((d) => d.slice(0, 6)))];
  const next = dir < 0 ? months.filter((x) => x < sd.month).pop() : months.find((x) => x > sd.month);
  if (next) { sd.month = next; renderCalendar(); }
}
$("#cal-prev").addEventListener("click", () => shiftMonth(-1));
$("#cal-next").addEventListener("click", () => shiftMonth(1));

// ---- day view
async function loadDay(date, force = false) {
  $("#sd-day-title").textContent = sdDate(date).toLocaleDateString("pl-PL",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("#sd-day-meta").textContent = "Wczytywanie…";
  sd.clips = [];
  renderDay();
  $("#sd-empty").hidden = true;
  try {
    const data = await api(`/api/sd/recordings?date=${date}` + (force ? "&force=true" : ""));
    if (date !== sd.date) return;            // the user already picked another day
    sd.clips = data.clips || [];
    renderDay();
    if (sd.clips.some((c) => jobActive(c.job))) startSdPolling();
  } catch (e) {
    if (date !== sd.date) return;
    $("#sd-day-meta").textContent = "";
    $("#sd-clips").replaceChildren(h("div", { class: "empty" },
      h("div", { text: "Nie można wczytać nagrań z tego dnia: " + e.message }),
      h("button", { class: "btn ghost retry", text: "Spróbuj ponownie", onclick: () => loadDay(date, true) })));
  }
}

function renderDay() {
  const total = sd.clips.reduce((a, c) => a + c.duration, 0);
  $("#sd-day-meta").textContent = sd.clips.length
    ? `Nagrania: ${sd.clips.length} · ${fmtDur(total)} materiału` : "";
  $("#sd-empty").hidden = sd.clips.length > 0;
  if (!sd.date) $("#sd-day-title").textContent = "Brak nagrań na karcie";

  renderSdFilters();
  $("#sd-timeline").replaceChildren(...sd.clips.map((c) => h("button", {
    class: "tl-seg" + (c.type === 1 ? " cont" : "") + (c.cached ? " local" : "") + (c.analysis && c.analysis.animal ? " animal" : ""),
    "data-id": c.id, title: `${c.time} · ${fmtDur(c.duration)}`, "aria-label": `Nagranie z ${c.time}`,
    style: `left:${(100 * c.day_second / 86400).toFixed(3)}%;width:${(100 * c.duration / 86400).toFixed(3)}%`,
    onclick: () => openSdPlayer(c.id),
    onmouseenter: () => hotClip(c.id, true), onmouseleave: () => hotClip(c.id, false),
  })));

  const rows = [];
  let hour = null;
  for (const c of sd.clips.filter(sdMatchesFilter)) {
    const hh = c.time.slice(0, 2);
    if (hh !== hour) { hour = hh; rows.push(h("div", { class: "clip-hour", text: `${hh} h` })); }
    rows.push(clipRow(c));
  }
  $("#sd-clips").replaceChildren(...rows);
}

function hotClip(id, on) {
  document.querySelectorAll(`[data-id="${id}"]`).forEach((el) => el.classList.toggle("hot", on));
}

function clipRow(c) {
  const job = c.job, busy = jobActive(job);
  const tags = [h("span", { class: "tag " + (c.type === 1 ? "cont" : "det"), text: c.type_label })];
  const an = c.analysis;
  if (an && an.status === "done") {
    for (const d of an.detections) tags.push(h("button", {
      class: "tag " + (d.group === "animal" ? "animal" : "person"),
      title: `${d.hits} klatek, widoczne od ${fmtDur(d.first)} do ${fmtDur(d.last)} — kliknij, aby odtworzyć od tego momentu`,
      text: `${d.emoji} ${d.label}` + (d.group === "animal" && d.key !== "animal" ? ` ${Math.round(d.score * 100)} %` : ""),
      onclick: () => openSdPlayer(c.id, Math.max(0, d.first - 2)) }),
      untagButton(c.id, d, () => { an.detections = an.detections.filter((x) => x !== d);
        an.animal = an.detections.some((x) => x.group === "animal"); renderDay(); }));
    if (!an.detections.length) tags.push(h("span", { class: "tag none", text: "przeanalizowano · brak wykryć" }));
  } else if (an && an.status === "error") tags.push(h("span", { class: "tag err", text: "analiza: " + (an.error || "niepowodzenie") }));
  if (c.analyzing) tags.push(h("span", { class: "tag", text: c.analyzing === "running" ? "🔎 trwa analiza…" : "oczekuje na analizę" }));
  if (c.cached) tags.push(h("span", { class: "tag local", text: "kopia lokalna" + (c.size ? " · " + fmtSize(c.size) : "") }));
  if (job && job.state === "error") tags.push(h("span", { class: "tag err", text: job.error || "niepowodzenie" }));

  const actions = [h("button", { class: "btn", "data-act": "play", text: "▶ Odtwórz", onclick: () => openSdPlayer(c.id) })];
  if (c.cached) {
    actions.push(h("a", { class: "btn ghost", "data-act": "dl", text: "⬇", title: "Pobierz plik MP4", "aria-label": "Pobierz",
      href: `/api/sd/clips/${c.id}/download`, download: true }));
    actions.push(h("button", { class: "btn ghost", "data-act": "del", text: "🗑", title: "Usuń kopię lokalną (nagranie pozostaje na karcie SD)",
      "aria-label": "Usuń kopię lokalną", onclick: () => deleteSdLocal(c.id) }));
  } else if (busy) {
    actions.push(h("button", { class: "btn ghost", "data-act": "cancel", text: "✕ Anuluj", onclick: () => cancelSdJob(c.id) }));
  } else {
    actions.push(h("button", { class: "btn ghost", "data-act": "dl", text: "⬇", title: "Pobierz nagranie z kamery, a następnie zapisz plik",
      "aria-label": "Pobierz", onclick: () => downloadSdClip(c.id) }));
  }

  const aniFrame = c.analysis && c.analysis.animal && c.analysis.frame;
  const img = h("img", { src: aniFrame ? `/api/sd/clips/${c.id}/animal` : `/api/sd/clips/${c.id}/thumb`, loading: "lazy", alt: "", width: 96, height: 54,
    onerror: (e) => retryThumb(e.target, c.id) });   // camera busy -> ask again; ▶ shows through meanwhile
  const thumb = h("button", { class: "clip-thumb", "aria-label": `Odtwórz nagranie z ${c.time}`,
    onclick: () => openSdPlayer(c.id) }, h("span", { text: "▶" }), img);

  const row = h("div", { class: "clip" + (c.analysis && c.analysis.animal ? " ani" : ""), "data-id": c.id,
      onmouseenter: () => hotClip(c.id, true), onmouseleave: () => hotClip(c.id, false) },
    thumb,
    h("div", { class: "clip-main" },
      h("div", { class: "clip-time" }, `${c.time} → ${c.time_end}`, h("small", { text: fmtDur(c.duration) })),
      h("div", { class: "clip-tags" }, tags)),
    h("div", { class: "clip-actions" }, actions));
  if (busy) {
    const pct = job.total ? Math.min(100, 100 * job.progress / job.total) : 0;
    row.append(h("div", { class: "clip-progress" },
      h("div", { class: "fetchbar-track" }, h("div", { class: "fetchbar-fill", style: `width:${pct}%` })),
      h("span", { text: jobText(job) })));
  }
  return row;
}

function retryThumb(img, id) {
  const n = +(img.dataset.tries || 0) + 1;
  if (n > 4 || !img.isConnected) { img.remove(); return; }
  img.dataset.tries = n;
  img.style.visibility = "hidden";
  setTimeout(() => {
    if (!img.isConnected) return;
    img.onload = () => { img.style.visibility = ""; };
    img.src = `/api/sd/clips/${id}/thumb?r=${n}`;
  }, 3000 * n);
}

function jobText(job) {
  const speed = ((job.bytes_per_second || 0) / 1000000).toLocaleString("pl-PL", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) + " MB/s";
  const idle = job.idle_seconds >= 3
    ? ` · Brak nowych danych od ${Math.floor(job.idle_seconds)} s` : "";
  switch (job.state) {
    case "queued": return "W kolejce…";
    case "connecting": return "Łączenie z kamerą…";
    case "streaming": return `Pobieranie z kamery… ${fmtDur(job.progress)} / ${fmtDur(job.total)} · ${speed}${idle}`;
    case "finalizing": return "Kończenie zapisu MP4…";
    default: return "";
  }
}

function refreshClip(id) {
  const c = sdClip(id);
  const old = document.querySelector(`.clip[data-id="${id}"]`);
  if (c && old) {
    // Patch the live row instead of replacing it: keyboard focus and the already
    // loaded thumbnail survive the 1-2 s progress ticks.
    const fresh = clipRow(c);
    const focused = old.contains(document.activeElement) ? document.activeElement.dataset.act : null;
    for (const sel of [".clip-tags", ".clip-actions", ".clip-progress"]) {
      const a = old.querySelector(sel), b = fresh.querySelector(sel);
      if (a && b) a.replaceWith(b); else if (a) a.remove(); else if (b) old.append(b);
    }
    if (focused) {
      const again = old.querySelector(`[data-act="${focused}"]`) || old.querySelector("[data-act]");
      if (again) again.focus();
    }
  }
  const seg = document.querySelector(`.tl-seg[data-id="${id}"]`);
  if (c && seg) seg.classList.toggle("local", !!c.cached);
}

function applyJob(id, job) {
  // Fold a job snapshot into the clip model; returns true when the fetch just completed.
  const c = sdClip(id);
  const finished = job.state === "done" || job.cached === true;
  if (c) {
    const was = c.cached;
    c.cached = finished || c.cached;
    c.job = finished || job.state === "none" || job.state === "cancelled" ? null : job;
    refreshClip(id);
    if (finished && !was) {
      // pick up the file size for the "kopia lokalna" tag (sizes are read from the local
      // disk on every call: no need to force a new camera listing)
      api(`/api/sd/recordings?date=${sd.date}`).then((d) => {
        const fresh = (d.clips || []).find((x) => x.id === id);
        if (fresh && sdClip(id)) { sdClip(id).size = fresh.size; refreshClip(id); }
      }).catch(() => {});
    }
  }
  if (finished && sd.wantFile.delete(id)) saveSdFile(id);
  if (["error", "cancelled", "none"].includes(job.state)) sd.wantFile.delete(id);   // never poll forever
  if (finished) api("/api/sd/status").then(renderSdCard).catch(() => {});            // local-copies counter
  return finished;
}

function saveSdFile(id) {
  const a = h("a", { href: `/api/sd/clips/${id}/download`, download: true });
  document.body.append(a); a.click(); a.remove();
  toast("Rozpoczęto pobieranie pliku MP4", "ok");
}

async function downloadSdClip(id) {
  try {
    const job = await api(`/api/sd/clips/${id}/fetch?kind=download`, { method: "POST" });
    sd.wantFile.add(id);
    if (!applyJob(id, job)) { toast("Rozpoczęto pobieranie z kamery. Plik zostanie zapisany po jego zakończeniu."); startSdPolling(); }
  } catch (e) { sd.wantFile.delete(id); toast(e.message, "err"); }
}

async function cancelSdJob(id) {
  sd.wantFile.delete(id);
  try { await api(`/api/sd/clips/${id}/cancel`, { method: "POST" }); } catch (e) {}
  const c = sdClip(id);
  if (c) { c.job = null; refreshClip(id); }
}

async function deleteSdLocal(id) {
  if (!confirm("Usunąć lokalną kopię tego nagrania?\n(Nagranie pozostanie na karcie SD kamery.)")) return;
  try {
    await api(`/api/sd/clips/${id}`, { method: "DELETE" });
    const c = sdClip(id);
    if (c) { c.cached = false; c.size = null; refreshClip(id); }
    toast("Usunięto kopię lokalną", "ok");
  } catch (e) { toast(e.message, "err"); }
}

// ---- background polling of fetch jobs (list rows)
function startSdPolling() {
  if (sd.pollTimer) return;
  sd.pollTimer = setInterval(pollSdJobs, 2000);
}
async function pollSdJobs() {
  const tracked = sd.clips.filter((c) => jobActive(c.job)).map((c) => c.id);
  for (const id of sd.wantFile) if (!tracked.includes(id)) tracked.push(id);
  if (!tracked.length) { clearInterval(sd.pollTimer); sd.pollTimer = null; return; }
  for (const id of tracked) {
    if (sd.player && sd.player.id === id) continue;      // the player polls this one itself
    try { applyJob(id, await api(`/api/sd/clips/${id}/job`)); } catch (e) {}
  }
}

// ---- SD player (HLS while fetching, MP4 once local)
// Every open gets its own `pl` object: late answers of a previous open (even of
// the same clip) are recognised by identity and dropped.
async function openSdPlayer(id, startAt = 0) {
  const c = sdClip(id);
  if (!c) return;
  closeSdPlayer();
  sdSeekOnce(startAt);
  $("#modal-title").textContent = c.title ||
    `Karta SD · ${sdDate(sd.date).toLocaleDateString("pl-PL")} ${c.time} (${fmtDur(c.duration)})`;
  $("#modal").hidden = false;
  const pl = sd.player = { id, hls: null, timer: null, started: false, noHls: false, dead: false };
  setSdModalState(c, c.job);
  if (c.cached) { playSdFile(id); return; }
  try {
    const job = await api(`/api/sd/clips/${id}/fetch?kind=play`, { method: "POST" });
    if (sd.player !== pl) {
      // closed (or replaced) before the answer: nobody watches this fetch any more
      if (jobActive(job) && job.kind === "play" && !sd.wantFile.has(id) && !(sd.player && sd.player.id === id)) cancelSdJob(id);
      return;
    }
    sd.clips.forEach((x) => { if (x.id !== id && x.job && x.job.kind === "play") { x.job = null; refreshClip(x.id); } });
    onSdPlayerJob(pl, job);
    pollSdPlayer(pl);
  } catch (e) {
    toast(e.message, "err");
    if (sd.player === pl) closePlayer();                  // a late failure of A must not close B
  }
}

function untagButton(clipId, d, after) {
  return h("button", { class: "tag-x", title: `Błędne rozpoznanie „${d.label}”: usuń etykietę`,
    "aria-label": `Usuń etykietę ${d.label}`, text: "✕",
    onclick: async (e) => {
      e.stopPropagation();
      if (!confirm(`Usunąć etykietę „${d.label}” z tego nagrania?`)) return;
      try {
        await api(`/api/sd/clips/${clipId}/untag?key=${encodeURIComponent(d.key)}`, { method: "POST" });
        toast("Usunięto etykietę", "ok");
        after();
      } catch (err) { toast(err.message, "err"); }
    } });
}

function sdSeekOnce(t) {
  const video = $("#player");
  if (!(t > 0)) return;
  const go = () => { try { if (video.duration > t || !isFinite(video.duration)) video.currentTime = t; } catch (e) {} };
  video.addEventListener("loadedmetadata", go, { once: true });
}

// ---- animal detection (DeepFaune, local): filters, day analysis, live refresh
function sdMatchesFilter(c) {
  const f = sd.filter, dets = (c.analysis && c.analysis.detections) || [];
  if (f === "all") return true;
  if (f === "animals") return dets.some((d) => d.group === "animal");
  return dets.some((d) => d.key === f);
}
function renderSdFilters() {
  const counts = new Map();
  let animals = 0;
  for (const c of sd.clips) {
    const dets = (c.analysis && c.analysis.detections) || [];
    if (dets.some((d) => d.group === "animal")) animals++;
    for (const d of dets) counts.set(d.key, { n: ((counts.get(d.key) || {}).n || 0) + 1, d });
  }
  const chip = (key, text) => h("button", { class: "chip" + (sd.filter === key ? " on" : ""), text,
    "aria-pressed": sd.filter === key ? "true" : "false", onclick: () => { sd.filter = key; renderDay(); } });
  const chips = [chip("all", `Wszystkie ${sd.clips.length}`)];
  if (counts.size) chips.push(chip("animals", `🐾 Zwierzęta ${animals}`));
  for (const [key, { n, d }] of counts) chips.push(chip(key, `${d.emoji} ${d.label} ${n}`));
  if (sd.filter !== "all" && sd.filter !== "animals" && !counts.has(sd.filter)) sd.filter = "all";
  $("#sd-filters").replaceChildren(...chips);
  const done = sd.clips.filter((c) => c.analysis && c.analysis.status === "done").length;
  const pending = sd.clips.filter((c) => c.analyzing).length;
  $("#sd-analyze-status").textContent = pending ? `Analiza: ${done} / ${sd.clips.length} (pozostało: ${pending})…`
    : done ? `Przeanalizowano ${done} / ${sd.clips.length}` : "";
  $("#btn-analyze").hidden = !sd.clips.length || (done === sd.clips.length && !pending);
  if (pending && !sd.aniTimer) sd.aniTimer = setInterval(refreshAnalysis, 6000);
  if (!pending && sd.aniTimer) { clearInterval(sd.aniTimer); sd.aniTimer = null; }
}
async function refreshAnalysis() {
  if (!sd.date || !$("#tab-sd").classList.contains("active")) return;
  try {
    const date = sd.date, data = await api(`/api/sd/recordings?date=${date}`);
    if (date !== sd.date) return;
    const fresh = new Map((data.clips || []).map((c) => [c.id, c]));
    let changed = false;
    for (const c of sd.clips) {
      const f = fresh.get(c.id);
      if (!f) continue;
      if (JSON.stringify([c.analysis, c.analyzing, c.cached]) !== JSON.stringify([f.analysis, f.analyzing, f.cached])) {
        Object.assign(c, { analysis: f.analysis, analyzing: f.analyzing, cached: f.cached, size: f.size });
        changed = true;
      }
    }
    if (changed && !sd.player) renderDay(); else renderSdFilters();
    if (changed) api("/api/sd/animals/days").then((d) => { sd.aniDays = d.days || {}; renderCalendar(); }).catch(() => {});
  } catch (e) {}
}
$("#btn-analyze").addEventListener("click", async () => {
  try {
    const st = await api("/api/sd/animals/status");
    if (!st.available) { toast("Moduł rozpoznawania zwierząt nie jest zainstalowany.", "err"); return; }
    const r = await api(`/api/sd/animals/analyze?date=${sd.date}`, { method: "POST" });
    toast(r.queued ? `Nagrania w kolejce: ${r.queued} (≈ ${Math.ceil(r.queued * 25 / 60)} min, w tle)` : "Wszystkie nagrania zostały już przeanalizowane", "ok");
    refreshAnalysis();
    if (!sd.aniTimer) sd.aniTimer = setInterval(refreshAnalysis, 6000);
  } catch (e) { toast(e.message, "err"); }
});

function pollSdPlayer(pl) {
  if (pl.timer || sd.player !== pl) return;
  const c = sdClip(pl.id);
  if (!c || !jobActive(c.job)) return;
  pl.timer = setInterval(async () => {
    try {
      const job = await api(`/api/sd/clips/${pl.id}/job`);
      if (sd.player === pl) onSdPlayerJob(pl, job);       // drop answers that outlived their player
    } catch (e) {}
  }, 1000);
}

function playSdFile(id) {
  const video = $("#player");
  video.src = `/api/sd/clips/${id}/play`;
  video.play().catch(() => {});
  if (sd.player) sd.player.started = true;
}

function onSdPlayerJob(pl, job) {
  if (sd.player !== pl || !job || job.id !== pl.id) return;
  const id = pl.id;
  const finished = applyJob(id, job);
  setSdModalState(sdClip(id), job);
  if (["error", "cancelled", "none"].includes(job.state)) {
    if (job.state === "error") toast(job.error || "Nie udało się pobrać nagrania", "err");
    clearInterval(pl.timer); pl.timer = null;
    pl.dead = true;                                       // the server deleted the HLS output:
    if (pl.hls) { try { pl.hls.stopLoad(); } catch (e) {} }   // play out the buffer, never reload
    if (!pl.started) closePlayer();
    return;
  }
  if (!pl.started && !pl.noHls && job.hls_ready) startSdHls(pl);
  if (finished) {
    clearInterval(pl.timer); pl.timer = null;
    if (!pl.started) playSdFile(id);                      // short clip, or HLS gave up: play the MP4
    else if (pl.hls) pl.timer = setInterval(() => {       // keep the HLS copy alive while paused
      if (sd.player === pl) api(`/api/sd/clips/${id}/job`).catch(() => {});
    }, 120000);
  }
}

function startSdHls(pl) {
  pl.started = true;
  const video = $("#player");
  const url = `/sdplay/${pl.id}/index.m3u8`;
  if (!(window.Hls && Hls.isSupported())) {               // Safari: native HLS
    video.src = url;
    video.play().catch(() => {});
    return;
  }
  const hls = pl.hls = new Hls({ startPosition: 0, maxBufferLength: 30, liveDurationInfinity: false });
  let recoveries = 0;
  hls.loadSource(url);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal || sd.player !== pl) return;
    if (pl.dead) { hls.stopLoad(); return; }
    const D = Hls.ErrorDetails;
    const manifest = [D.MANIFEST_LOAD_ERROR, D.MANIFEST_LOAD_TIMEOUT, D.MANIFEST_PARSING_ERROR].includes(data.details);
    if (!manifest && ++recoveries <= 2 && data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
    else if (!manifest && recoveries <= 2 && data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    else sdHlsGaveUp(pl);                                 // never loop: play the MP4 once complete
  });
}

function sdHlsGaveUp(pl) {
  if (sd.player !== pl) return;
  if (pl.hls) { try { pl.hls.destroy(); } catch (e) {} pl.hls = null; }
  pl.noHls = true;
  const c = sdClip(pl.id);
  if (c && c.cached) { playSdFile(pl.id); return; }
  pl.started = false;                                     // onSdPlayerJob() plays the MP4 when done
  $("#modal-fetch-text").textContent = "Odtwarzanie rozpocznie się po zakończeniu pobierania…";
}

function setSdModalState(c, job) {
  const cached = !!(c && c.cached);
  const link = $("#modal-download"), btn = $("#modal-sd-download"), bar = $("#modal-fetch");
  link.hidden = !cached;
  if (cached && c) link.href = `/api/sd/clips/${c.id}/download`;
  btn.hidden = cached;
  const waiting = c && sd.wantFile.has(c.id);
  btn.disabled = !!waiting;
  btn.textContent = waiting ? "⬇ Zapis pliku po zakończeniu pobierania…" : "⬇ Pobierz";
  const busy = jobActive(job);
  bar.hidden = !busy;
  if (busy) {
    $("#modal-fetch-fill").style.width = (job.total ? Math.min(100, 100 * job.progress / job.total) : 0) + "%";
    $("#modal-fetch-text").textContent = sd.player && sd.player.noHls
      ? "Odtwarzanie rozpocznie się po zakończeniu pobierania… " + jobText(job) : jobText(job);
  }
}

$("#modal-sd-download").addEventListener("click", async () => {
  const pl = sd.player;
  if (!pl) return;
  try {
    const job = await api(`/api/sd/clips/${pl.id}/fetch?kind=download`, { method: "POST" });
    sd.wantFile.add(pl.id);
    if (sd.player === pl) { pl.dead = false; onSdPlayerJob(pl, job); pollSdPlayer(pl); }   // (re)start this player's poll
    else { applyJob(pl.id, job); startSdPolling(); }
  } catch (e) { toast(e.message, "err"); }
});

function closeSdPlayer() {
  const pl = sd.player;
  if (!pl) return;
  sd.player = null;
  if (pl.timer) clearInterval(pl.timer);
  if (pl.hls) { try { pl.hls.destroy(); } catch (e) {} }
  const c = sdClip(pl.id);
  // A play-only fetch has no audience any more: free the camera. A requested
  // download keeps going in the background (and the row shows its progress).
  if (c && jobActive(c.job) && c.job.kind === "play" && !sd.wantFile.has(pl.id)) cancelSdJob(pl.id);
  else if (c && jobActive(c.job)) startSdPolling();
  $("#modal-fetch").hidden = true;
  $("#modal-sd-download").hidden = true;
  $("#modal-download").hidden = false;
}

// ---------- Zwierzęta: every detection, across all days (clips kept locally for good) ----------
const ani = { key: null, species: [], clips: [] };

async function loadAnimals() {
  try {
    const d = await api("/api/animals/species");
    ani.species = d.species || [];
    const st = d.status || {};
    $("#ani-status").textContent = !st.available ? "Moduł rozpoznawania zwierząt nie jest zainstalowany"
      : (st.current || st.queued) ? `Trwa analiza automatyczna — w kolejce: ${st.queued + (st.current ? 1 : 0)}`
      : d.auto ? "Analiza automatyczna włączona — wszystko aktualne" : "";
    const total = ani.species.reduce((a, x) => a + x.count, 0);
    const item = (key, emoji, label, count, last) => h("button", {
      class: "ani-sp" + (ani.key === key ? " sel" : ""), "aria-pressed": ani.key === key ? "true" : "false",
      onclick: () => { ani.key = key; loadAnimals(); } },
      h("span", { class: "emo", text: emoji }),
      h("span", {}, label, last ? h("small", { text: "wykryto " + new Date(last * 1000).toLocaleDateString("pl-PL") }) : null),
      h("span", { class: "cnt", text: String(count) }));
    if (!ani.key) ani.key = (location.hash.split("/")[1] || "all");   // deep link: /#animals/mustelid
    $("#ani-species").replaceChildren(item("all", "🐾", "Wszystkie zwierzęta", total, 0),
      ...ani.species.map((x) => item(x.key, x.emoji, x.label, x.count, x.last)));
    $("#ani-empty").hidden = ani.species.length > 0;
    await loadAnimalClips();
  } catch (e) { toast(e.message, "err"); }
}

async function loadAnimalClips() {
  const key = ani.key;
  const d = await api(`/api/animals/clips?key=${encodeURIComponent(key)}`);
  if (key !== ani.key) return;
  ani.clips = d.clips || [];
  const sp = ani.species.find((x) => x.key === key);
  $("#ani-title").textContent = sp ? `${sp.emoji} ${sp.label}` : "🐾 Wszystkie zwierzęta";
  $("#ani-meta").textContent = ani.clips.length ? `Nagrania: ${ani.clips.length}` : "";
  const rows = [];
  let day = null;
  for (const c of ani.clips) {
    if (c.day !== day) { day = c.day; rows.push(h("div", { class: "clip-hour",
      text: sdDate(c.day).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) })); }
    rows.push(animalRow(c));
  }
  $("#ani-clips").replaceChildren(...rows);
}

function animalRow(c) {
  const play = (t) => playAnimalClip(c, t);
  const tags = c.detections.flatMap((d) => [h("button", {
    class: "tag " + (d.group === "animal" ? "animal" : "person"),
    title: `${d.hits} klatek, widoczne od ${fmtDur(d.first)} do ${fmtDur(d.last)}`,
    text: `${d.emoji} ${d.label}` + (d.group === "animal" && d.key !== "animal" ? ` ${Math.round(d.score * 100)} %` : ""),
    onclick: () => play(Math.max(0, d.first - 2)) }), untagButton(c.id, d, loadAnimals)]);
  tags.push(h("span", { class: "tag " + (c.cached ? "local" : "none"), text: c.cached ? "kopia lokalna" : "na karcie SD" }));
  const img = h("img", { src: c.frame ? `/api/sd/clips/${c.id}/animal` : `/api/sd/clips/${c.id}/thumb`, loading: "lazy", alt: "",
    onerror: (e) => e.target.remove() });
  const actions = [h("button", { class: "btn", text: "▶ Odtwórz", onclick: () => play(Math.max(0, c.first - 2)) })];
  if (c.cached) actions.push(h("a", { class: "btn ghost", text: "⬇", "aria-label": "Pobierz", title: "Pobierz MP4",
    href: `/api/sd/clips/${c.id}/download`, download: true }));
  return h("div", { class: "clip ani", "data-id": c.id },
    h("button", { class: "clip-thumb", "aria-label": `Odtwórz nagranie z ${c.date} ${c.time}`, onclick: () => play(Math.max(0, c.first - 2)) },
      h("span", { text: "▶" }), img),
    h("div", { class: "clip-main" },
      h("div", { class: "clip-time" }, `${c.date} · ${c.time}`, h("small", { text: fmtDur(c.duration) })),
      h("div", { class: "clip-tags" }, tags)),
    h("div", { class: "clip-actions" }, actions));
}

function playAnimalClip(c, startAt) {
  // reuse the SD player: it plays the local MP4, or fetches the clip if it is still on the card
  let model = sdClip(c.id);
  if (!model) { model = { ...c, job: null, type: 2, type_label: "", time_end: "" }; sd.clips.push(model); }
  model.cached = c.cached;
  model.title = `${c.detections.map((d) => d.emoji).join(" ")} ${c.date} ${c.time} (${fmtDur(c.duration)})`;
  openSdPlayer(c.id, startAt);
}
$("#btn-ani-refresh").addEventListener("click", loadAnimals);

$("#btn-sd-refresh").addEventListener("click", () => loadSd(true));

// ---------- poll active recordings so the UI recovers state on reload ----------
async function syncRecordings() {
  try {
    const s = await api("/api/record/status");
    const manual = (s.active || []).find((r) => r.kind === "manual");
    if (manual && !state.manualRecId) {
      state.manualRecId = manual.id;
      $("#btn-rec-start").disabled = true;
      $("#btn-rec-stop").disabled = false;
      $("#rec-badge").hidden = false;
    }
  } catch (e) {}
}

// ---------- settings / first run ----------
async function openSetup() {
  try {
    const st = await api("/api/setup");
    if (!st.can_edit) { toast("Dane logowania można zmienić tylko na komputerze, na którym działa aplikacja.", "err"); return; }
    const f = $("#setup-form");
    f.host.value = st.host || ""; f.subnet.value = st.subnet || ""; f.user.value = st.user || "";
    f.password.value = ""; f.cloud_password.value = "";
    $("#setup").hidden = false;
  } catch (e) { toast(e.message, "err"); }
}
$("#btn-settings").addEventListener("click", openSetup);
$("#setup-close").addEventListener("click", () => ($("#setup").hidden = true));
$("#setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = Object.fromEntries(["host", "subnet", "user", "password", "cloud_password"].map((k) => [k, f[k].value]));
  try {
    await api("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    $("#setup").hidden = true;
    toast("Zapisano dane logowania", "ok");
    await api("/api/discover", { method: "POST" }).catch(() => {});
    refreshStatus();
  } catch (err) { toast(err.message, "err"); }
});
api("/api/setup").then((st) => {
  $("#btn-shutdown").hidden = !st.can_shutdown;
  if (st.needs_setup) openSetup();
}).catch(() => {});

$("#btn-shutdown").addEventListener("click", async () => {
  if (!confirm("Wyłączyć serwer Tapo? Podgląd i pobieranie zostaną zatrzymane, a aktywne nagrania zostaną domknięte. Ponownie uruchomisz aplikację plikiem Uruchom Tapo.bat.")) return;
  const button = $("#btn-shutdown");
  button.disabled = true;
  try {
    await api("/api/server/shutdown", { method: "POST", headers: { "X-Tapo-Action": "shutdown" } });
    state.shuttingDown = true;
    clearInterval(statusTimer);
    clearInterval(sd.pollTimer);
    clearInterval(sd.aniTimer);
    closePlayer();
    stopLive();
    document.title = "Tapo Web — serwer wyłączany";
    document.body.replaceChildren();
    const message = document.createElement("main");
    message.textContent = "Serwer Tapo kończy pracę. Możesz zamknąć tę kartę. Aby wrócić, uruchom plik Uruchom Tapo.bat.";
    document.body.append(message);
  } catch (error) { button.disabled = false; toast(error.message, "err"); }
});

// ---------- init ----------
if (location.hash.length > 1) showTab(location.hash.slice(1).split("/")[0]);   // deep link: /#sd, /#library
refreshStatus();
syncRecordings();
const statusTimer = setInterval(refreshStatus, 15000);
