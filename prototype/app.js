const els = {
  songInput: document.getElementById("songInput"),
  loadSample: document.getElementById("loadSample"),
  generatePlan: document.getElementById("generatePlan"),
  exportPlan: document.getElementById("exportPlan"),
  songFiles: document.getElementById("songFiles"),
  fileMap: document.getElementById("fileMap"),
  transitionBars: document.getElementById("transitionBars"),
  playAuto: document.getElementById("playAuto"),
  stopAll: document.getElementById("stopAll"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  tableWrap: document.getElementById("tableWrap")
};

const sampleCsv = `title,artist,bpm,key,energy,duration_sec
Song One,Artist One,124,8A,0.60,240
Song Two,Artist Two,126,9A,0.68,220`;

const state = {
  plan: null,
  tracks: [],
  fileMap: new Map(),
  ctx: null,
  runningSources: []
};

els.songInput.value = sampleCsv;
els.loadSample.addEventListener("click", () => (els.songInput.value = sampleCsv));
els.generatePlan.addEventListener("click", generateAndRender);
els.exportPlan.addEventListener("click", exportPlanJson);
els.songFiles.addEventListener("change", onFilesChanged);
els.playAuto.addEventListener("click", playAutoMix);
els.stopAll.addEventListener("click", stopAll);

function generateAndRender() {
  try {
    const tracks = parseCsvTracks(els.songInput.value.trim());
    const transitionBars = Number(els.transitionBars.value);
    const plan = buildPlan(tracks, transitionBars);
    state.tracks = tracks;
    state.plan = plan;
    render(plan);
    renderFileMatches();
  } catch (err) {
    els.summary.textContent = `Error: ${err.message}`;
    els.tableWrap.innerHTML = "";
  }
}

function parseCsvTracks(text) {
  if (!text) throw new Error("Metadata input is empty");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("Need header + at least one track row");
  const headers = lines[0].split(",").map((x) => x.trim());
  return lines.slice(1).map((line, idx) => {
    const values = line.split(",").map((x) => x.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = values[i]));
    const t = {
      title: must(row.title, "title", idx),
      artist: must(row.artist, "artist", idx),
      bpm: Number(must(row.bpm, "bpm", idx)),
      key: must(row.key, "key", idx).toUpperCase(),
      energy: clamp(Number(must(row.energy, "energy", idx)), 0, 1),
      duration_sec: Math.max(20, Number(must(row.duration_sec, "duration_sec", idx)))
    };
    if (![t.bpm, t.energy, t.duration_sec].every(Number.isFinite)) {
      throw new Error(`Invalid numeric fields on row ${idx + 2}`);
    }
    return t;
  });
}

function must(value, field, idx) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing '${field}' on row ${idx + 2}`);
  }
  return value;
}

function buildPlan(tracks, transitionBars) {
  const order = [...tracks].sort((a, b) => a.energy - b.energy || a.bpm - b.bpm);
  const transitions = [];
  for (let i = 0; i < order.length - 1; i++) {
    const from = order[i];
    const to = order[i + 1];
    const bpmDiff = Math.abs(from.bpm - to.bpm);
    const transitionSec = Math.round((transitionBars * 4 * 60) / from.bpm);
    let technique = "blend";
    if (bpmDiff > 6) technique = "echo out + drop in";
    else if (to.energy + 0.12 < from.energy) technique = "quick cut";
    else if (bpmDiff <= 2) technique = "long blend";
    transitions.push({
      from: fullName(from),
      to: fullName(to),
      from_idx: i,
      to_idx: i + 1,
      technique,
      mix_in_sec: Math.max(0, from.duration_sec - transitionSec - 4),
      mix_out_sec: Math.max(8, from.duration_sec - transitionSec),
      confidence: Number((1 - Math.min(bpmDiff, 12) / 12).toFixed(2))
    });
  }

  return {
    version: "mvp-v1",
    generated_at: new Date().toISOString(),
    config: { transition_bars: transitionBars },
    tracks,
    order,
    transitions
  };
}

function fullName(t) {
  return `${t.title} - ${t.artist}`;
}

function normalizeName(s) {
  return s.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, "");
}

function onFilesChanged() {
  state.fileMap.clear();
  for (const f of els.songFiles.files) {
    state.fileMap.set(normalizeName(f.name), f);
  }
  renderFileMatches();
}

function renderFileMatches() {
  if (!state.tracks.length) {
    els.fileMap.textContent = "Generate a plan to see file mapping.";
    return;
  }
  const lines = state.tracks.map((t) => {
    const key = normalizeName(fullName(t));
    const byTitle = normalizeName(t.title);
    const file = state.fileMap.get(key) || state.fileMap.get(byTitle);
    return `${fullName(t)} -> ${file ? file.name : "NO MATCH"}`;
  });
  els.fileMap.innerHTML = lines.map((x) => `<div>${escapeHtml(x)}</div>`).join("");
}

function render(plan) {
  els.summary.textContent = `Tracks: ${plan.order.length} | Transitions: ${plan.transitions.length}`;
  const rows = plan.transitions
    .map((t, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(t.from)}</td><td>${escapeHtml(t.to)}</td><td>${t.technique}</td><td>${t.mix_in_sec}s</td><td>${t.mix_out_sec}s</td><td>${Math.round(t.confidence * 100)}%</td></tr>`)
    .join("");
  els.tableWrap.innerHTML = `<table><thead><tr><th>#</th><th>From</th><th>To</th><th>Technique</th><th>Mix In</th><th>Mix Out</th><th>Confidence</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function playAutoMix() {
  try {
    if (!state.plan) generateAndRender();
    if (!state.plan || state.plan.order.length < 2) throw new Error("Need at least 2 tracks in plan");

    const buffers = [];
    for (const t of state.plan.order) {
      const file = findFileForTrack(t);
      if (!file) throw new Error(`Missing local file for: ${fullName(t)} (or title match)`);
      buffers.push(await decodeFile(file));
    }

    stopAll();
    if (!state.ctx) state.ctx = new AudioContext();
    const ctx = state.ctx;
    const now = ctx.currentTime + 0.2;
    let startAt = now;

    els.status.textContent = "Playing auto mix...";

    for (let i = 0; i < state.plan.order.length; i++) {
      const track = state.plan.order[i];
      const buffer = buffers[i];
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(i === 0 ? 1 : 0, startAt);
      gain.connect(ctx.destination);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.start(startAt, 0);
      state.runningSources.push(src);

      if (i < state.plan.transitions.length) {
        const tr = state.plan.transitions[i];
        const fadeStart = startAt + tr.mix_out_sec;
        const fadeEnd = fadeStart + Math.max(1, tr.mix_out_sec - tr.mix_in_sec);

        gain.gain.setValueAtTime(1, fadeStart);
        gain.gain.linearRampToValueAtTime(0, fadeEnd);

        const nextStart = startAt + tr.mix_in_sec;
        startAt = nextStart;
      }

      src.onended = () => {
        if (!state.runningSources.length) {
          els.status.textContent = "Idle";
        }
      };

      if (i === state.plan.order.length - 1) {
        const endAt = startAt + Math.min(buffer.duration, track.duration_sec);
        gain.gain.setValueAtTime(1, startAt);
        gain.gain.linearRampToValueAtTime(0, endAt);
      }
    }
  } catch (err) {
    els.status.textContent = `Playback error: ${err.message}`;
  }
}

function findFileForTrack(track) {
  const key1 = normalizeName(fullName(track));
  const key2 = normalizeName(track.title);
  return state.fileMap.get(key1) || state.fileMap.get(key2);
}

async function decodeFile(file) {
  if (!state.ctx) state.ctx = new AudioContext();
  const arr = await file.arrayBuffer();
  return await state.ctx.decodeAudioData(arr.slice(0));
}

function stopAll() {
  for (const src of state.runningSources) {
    try { src.stop(); } catch (_e) {}
  }
  state.runningSources = [];
  els.status.textContent = "Stopped";
}

function exportPlanJson() {
  if (!state.plan) {
    generateAndRender();
    if (!state.plan) return;
  }
  const blob = new Blob([JSON.stringify(state.plan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mix_plan_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
