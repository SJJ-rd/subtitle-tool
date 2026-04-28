const audio = document.getElementById("audio");
const audioInput = document.getElementById("audioInput");
const srtInput = document.getElementById("srtInput");
const exportBtn = document.getElementById("exportBtn");
const playBtn = document.getElementById("playBtn");
const backBtn = document.getElementById("backBtn");
const forwardBtn = document.getElementById("forwardBtn");
const offsetInput = document.getElementById("offsetInput");
const offsetBtn = document.getElementById("offsetBtn");
const zoomRange = document.getElementById("zoomRange");
const detectBtn = document.getElementById("detectBtn");
const detectResult = document.getElementById("detectResult");
const statusEl = document.getElementById("status");
const currentTimeEl = document.getElementById("currentTime");
const durationTimeEl = document.getElementById("durationTime");
const scroller = document.getElementById("timelineScroller");
const wrap = document.getElementById("timelineWrap");
const rulerCanvas = document.getElementById("rulerCanvas");
const waveCanvas = document.getElementById("waveCanvas");
const playhead = document.getElementById("playhead");
const track = document.getElementById("subtitleTrack");
const list = document.getElementById("subtitleList");

let subtitles = [];
let audioBuffer = null;
let audioUrl = null;
let selectedIndex = -1;
let pxPerSecond = 110;
let dragging = null;
let rafStarted = false;

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContextClass();

function parseTime(str){
  const clean = String(str).trim().replace(".", ",");
  const parts = clean.split(":");
  if(parts.length !== 3) return 0;
  const [h, m, rest] = parts;
  const [s, ms = "0"] = rest.split(",");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0").slice(0, 3)) / 1000;
}

function formatTime(t){
  t = Math.max(0, Number(t) || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}

function parseSRT(text){
  const normalized = String(text).replace(/\r/g, "").trim();
  if(!normalized) return [];
  return normalized.split(/\n\s*\n/).map(block => {
    const lines = block.split("\n");
    const timeLineIndex = lines.findIndex(line => line.includes("-->"));
    if(timeLineIndex < 0) return null;
    const [startRaw, endRaw] = lines[timeLineIndex].split("-->");
    if(!startRaw || !endRaw) return null;
    return {
      start: parseTime(startRaw),
      end: parseTime(endRaw),
      text: lines.slice(timeLineIndex + 1).join("\n").trim()
    };
  }).filter(Boolean).sort((a,b)=>a.start-b.start);
}

function exportSRT(){
  return subtitles
    .sort((a,b)=>a.start-b.start)
    .map((s, i) => `${i + 1}\n${formatTime(s.start)} --> ${formatTime(s.end)}\n${s.text}\n`)
    .join("\n");
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function getDuration(){
  return Math.max(audio.duration || 0, audioBuffer?.duration || 0, lastSubtitleEnd(), 60);
}

function lastSubtitleEnd(){
  return subtitles.reduce((max, s) => Math.max(max, s.end), 0);
}

function updateScale(){
  pxPerSecond = 38 + Number(zoomRange.value) * 18;
  const duration = getDuration();
  const cssWidth = Math.max(scroller.clientWidth - 2, Math.ceil(duration * pxPerSecond) + 200);
  wrap.style.width = `${cssWidth}px`;
  track.style.width = `${cssWidth}px`;

  setCanvasSize(rulerCanvas, cssWidth, 36);
  setCanvasSize(waveCanvas, cssWidth, 142);

  drawRuler();
  drawWaveform();
  renderClips();
  updatePlayhead();
}

function setCanvasSize(canvas, cssW, cssH){
  const ratio = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.floor(cssW * ratio);
  canvas.height = Math.floor(cssH * ratio);
}

function drawRuler(){
  const ratio = window.devicePixelRatio || 1;
  const ctx = rulerCanvas.getContext("2d");
  const w = rulerCanvas.width / ratio;
  const h = rulerCanvas.height / ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#050910";
  ctx.fillRect(0, 0, w, h);

  const duration = getDuration();
  const step = pxPerSecond > 210 ? 1 : pxPerSecond > 120 ? 2 : 5;

  ctx.strokeStyle = "#2a3a59";
  ctx.fillStyle = "#8fa4c2";
  ctx.font = "12px Microsoft JhengHei, sans-serif";

  for(let t = 0; t <= duration; t += step){
    const x = t * pxPerSecond;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillText(clockLabel(t), x + 4, 23);
  }
}

function clockLabel(t){
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2,"0")}`;
}

function drawWaveform(){
  const ratio = window.devicePixelRatio || 1;
  const ctx = waveCanvas.getContext("2d");
  const w = waveCanvas.width / ratio;
  const h = waveCanvas.height / ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#050910";
  ctx.fillRect(0, 0, w, h);

  if(!audioBuffer){
    ctx.fillStyle = "#6f829f";
    ctx.font = "15px Microsoft JhengHei, sans-serif";
    ctx.fillText("載入音訊後會顯示整段波形", 18, 76);
    return;
  }

  const channel = audioBuffer.getChannelData(0);
  const duration = audioBuffer.duration;
  const samplesPerPixel = Math.max(1, Math.floor(channel.length / (duration * pxPerSecond)));
  const centerY = h / 2;

  ctx.strokeStyle = "#31d6ff";
  ctx.lineWidth = 1;

  ctx.beginPath();
  for(let x = 0; x < Math.min(w, duration * pxPerSecond); x++){
    const start = Math.floor(x * samplesPerPixel);
    let min = 1, max = -1;
    for(let j = 0; j < samplesPerPixel; j++){
      const v = channel[start + j] || 0;
      if(v < min) min = v;
      if(v > max) max = v;
    }
    ctx.moveTo(x, centerY + min * centerY * 0.86);
    ctx.lineTo(x, centerY + max * centerY * 0.86);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(49,214,255,.07)";
  ctx.fillRect(0, 0, Math.min(w, duration * pxPerSecond), h);
}

function renderClips(){
  track.innerHTML = "";
  if(subtitles.length === 0){
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "載入 SRT 後，字幕片段會出現在這裡";
    track.appendChild(empty);
    return;
  }

  subtitles.forEach((s, i) => {
    const clip = document.createElement("div");
    clip.className = "clip";
    if(i === selectedIndex) clip.classList.add("selected");
    clip.dataset.index = i;
    clip.style.left = `${s.start * pxPerSecond}px`;
    clip.style.width = `${Math.max(30, (s.end - s.start) * pxPerSecond)}px`;
    clip.innerHTML = `
      <div class="handle left" title="拖曳調整開始時間"></div>
      <div class="clip-text">${escapeHtml(s.text)}</div>
      <div class="handle right" title="拖曳調整結束時間"></div>
    `;

    clip.addEventListener("mousedown", startMove);
    clip.addEventListener("click", e => {
      e.stopPropagation();
      selectSubtitle(i, false);
    });
    clip.querySelector(".handle.left").addEventListener("mousedown", e => startResize(e, "left"));
    clip.querySelector(".handle.right").addEventListener("mousedown", e => startResize(e, "right"));
    track.appendChild(clip);
  });
}

function renderList(){
  list.innerHTML = "";
  if(subtitles.length === 0){
    list.innerHTML = `<div class="empty">尚未載入字幕</div>`;
    return;
  }

  subtitles.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "sub-row";
    if(i === selectedIndex) row.classList.add("selected");
    row.dataset.index = i;
    row.innerHTML = `
      <div>${i + 1}</div>
      <input data-field="start" value="${formatTime(s.start)}">
      <input data-field="end" value="${formatTime(s.end)}">
      <textarea data-field="text">${escapeHtml(s.text)}</textarea>
    `;

    row.addEventListener("click", () => selectSubtitle(i, false));

    row.querySelectorAll("input, textarea").forEach(el => {
      el.addEventListener("change", e => {
        const field = e.target.dataset.field;
        if(field === "text") subtitles[i].text = e.target.value;
        if(field === "start") subtitles[i].start = parseTime(e.target.value);
        if(field === "end") subtitles[i].end = parseTime(e.target.value);
        normalizeSubtitle(i);
        renderEverything(false);
      });
    });

    list.appendChild(row);
  });
}

function normalizeSubtitle(i){
  subtitles[i].start = Math.max(0, subtitles[i].start);
  subtitles[i].end = Math.max(subtitles[i].start + 0.08, subtitles[i].end);
}

function selectSubtitle(i, jump = true){
  selectedIndex = i;
  const s = subtitles[i];
  if(s && jump){
    audio.currentTime = s.start;
    scroller.scrollLeft = Math.max(0, s.start * pxPerSecond - 180);
  }
  renderEverything(false);
}

function startMove(e){
  if(e.target.classList.contains("handle")) return;
  e.preventDefault();
  const i = Number(e.currentTarget.dataset.index);
  selectedIndex = i;
  dragging = {
    mode: "move",
    index: i,
    startX: e.clientX,
    originalStart: subtitles[i].start,
    originalEnd: subtitles[i].end
  };
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", stopDrag);
  renderEverything(false);
}

function startResize(e, side){
  e.preventDefault();
  e.stopPropagation();
  const clip = e.currentTarget.closest(".clip");
  const i = Number(clip.dataset.index);
  selectedIndex = i;
  dragging = {
    mode: side,
    index: i,
    startX: e.clientX,
    originalStart: subtitles[i].start,
    originalEnd: subtitles[i].end
  };
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", stopDrag);
  renderEverything(false);
}

function onDrag(e){
  if(!dragging) return;
  const dx = (e.clientX - dragging.startX) / pxPerSecond;
  const s = subtitles[dragging.index];

  if(dragging.mode === "move"){
    const length = dragging.originalEnd - dragging.originalStart;
    s.start = Math.max(0, dragging.originalStart + dx);
    s.end = s.start + length;
  }

  if(dragging.mode === "left"){
    s.start = Math.max(0, dragging.originalStart + dx);
    if(s.start > s.end - 0.08) s.start = s.end - 0.08;
  }

  if(dragging.mode === "right"){
    s.end = dragging.originalEnd + dx;
    if(s.end < s.start + 0.08) s.end = s.start + 0.08;
  }

  renderClips();
  updateActiveClasses();
}

function stopDrag(){
  if(dragging){
    normalizeSubtitle(dragging.index);
    dragging = null;
    renderEverything(false);
  }
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);
}

function applyOffset(seconds){
  subtitles.forEach((s, i) => {
    s.start = Math.max(0, s.start + seconds);
    s.end = Math.max(s.start + 0.08, s.end + seconds);
    normalizeSubtitle(i);
  });
  renderEverything(true);
}

function updatePlayhead(){
  const x = (audio.currentTime || 0) * pxPerSecond;
  playhead.style.left = `${x}px`;
  currentTimeEl.textContent = formatTime(audio.currentTime || 0);
  durationTimeEl.textContent = formatTime(audio.duration || audioBuffer?.duration || 0);
}

function updateActiveClasses(){
  const t = audio.currentTime || 0;
  const activeIndex = subtitles.findIndex(s => t >= s.start && t <= s.end);

  [...track.querySelectorAll(".clip")].forEach((el) => {
    const i = Number(el.dataset.index);
    el.classList.toggle("active", i === activeIndex);
    el.classList.toggle("selected", i === selectedIndex);
  });

  [...list.querySelectorAll(".sub-row")].forEach((el) => {
    const i = Number(el.dataset.index);
    el.classList.toggle("active", i === activeIndex);
    el.classList.toggle("selected", i === selectedIndex);
  });

  if(activeIndex >= 0){
    const row = list.querySelector(`.sub-row[data-index="${activeIndex}"]`);
    if(row && !row.matches(":hover")) row.scrollIntoView({block:"nearest"});
  }
}

function renderEverything(rescale = false){
  if(rescale) updateScale();
  else {
    renderClips();
    renderList();
    updateActiveClasses();
    updatePlayhead();
  }
}

function loop(){
  updatePlayhead();
  updateActiveClasses();
  requestAnimationFrame(loop);
}

function detectOffset(){
  if(!audioBuffer || subtitles.length === 0){
    detectResult.textContent = "請先載入音訊與 SRT。";
    return;
  }

  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.05);
  const scanLimit = Math.min(data.length, sampleRate * 60);

  let maxEnergy = 0;
  for(let i = 0; i < scanLimit; i += windowSize){
    let sum = 0;
    for(let j = 0; j < windowSize; j++){
      sum += Math.abs(data[i + j] || 0);
    }
    maxEnergy = Math.max(maxEnergy, sum / windowSize);
  }

  const threshold = maxEnergy * 0.28;
  let firstSound = 0;

  for(let i = 0; i < scanLimit; i += windowSize){
    let sum = 0;
    for(let j = 0; j < windowSize; j++){
      sum += Math.abs(data[i + j] || 0);
    }
    if(sum / windowSize >= threshold){
      firstSound = i / sampleRate;
      break;
    }
  }

  const offset = firstSound - subtitles[0].start;
  applyOffset(offset);
  detectResult.textContent = `偵測音訊起點約 ${firstSound.toFixed(2)} 秒，已套用 ${offset.toFixed(2)} 秒偏移。`;
}

audioInput.addEventListener("change", async e => {
  const file = e.target.files[0];
  if(!file) return;

  statusEl.textContent = "正在載入音訊...";
  if(audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(file);
  audio.src = audioUrl;

  try{
    const arr = await file.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arr.slice(0));
    statusEl.textContent = `音訊已載入：${file.name}`;
    updateScale();
  }catch(err){
    console.error(err);
    statusEl.textContent = "音訊波形分析失敗，但仍可播放。";
    audioBuffer = null;
    updateScale();
  }
});

srtInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if(!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    subtitles = parseSRT(ev.target.result);
    selectedIndex = subtitles.length ? 0 : -1;
    statusEl.textContent = `字幕已載入：${subtitles.length} 句`;
    updateScale();
    renderList();
  };
  reader.readAsText(file, "utf-8");
});

audio.addEventListener("loadedmetadata", updateScale);
audio.addEventListener("durationchange", updateScale);

playBtn.addEventListener("click", async () => {
  await audioCtx.resume();
  if(audio.paused) audio.play();
  else audio.pause();
});

backBtn.addEventListener("click", () => {
  audio.currentTime = Math.max(0, (audio.currentTime || 0) - 1);
});

forwardBtn.addEventListener("click", () => {
  audio.currentTime = Math.min(audio.duration || 999999, (audio.currentTime || 0) + 1);
});

offsetBtn.addEventListener("click", () => applyOffset(Number(offsetInput.value || 0)));
zoomRange.addEventListener("input", updateScale);
detectBtn.addEventListener("click", detectOffset);

exportBtn.addEventListener("click", () => {
  const blob = new Blob([exportSRT()], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fixed-subtitles.srt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

scroller.addEventListener("click", e => {
  if(e.target.closest(".clip")) return;
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  audio.currentTime = Math.max(0, x / pxPerSecond);
});

document.addEventListener("keydown", e => {
  if(["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

  if(e.code === "Space"){
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  }
  if(e.code === "ArrowRight"){
    e.preventDefault();
    audio.currentTime = Math.min(audio.duration || 999999, (audio.currentTime || 0) + 0.5);
  }
  if(e.code === "ArrowLeft"){
    e.preventDefault();
    audio.currentTime = Math.max(0, (audio.currentTime || 0) - 0.5);
  }
  if(e.code === "KeyA" && selectedIndex >= 0){
    subtitles[selectedIndex].start = Math.max(0, subtitles[selectedIndex].start - 0.1);
    subtitles[selectedIndex].end = Math.max(subtitles[selectedIndex].start + 0.08, subtitles[selectedIndex].end - 0.1);
    renderEverything(false);
  }
  if(e.code === "KeyD" && selectedIndex >= 0){
    subtitles[selectedIndex].start += 0.1;
    subtitles[selectedIndex].end += 0.1;
    renderEverything(false);
  }
  if(e.code === "Delete" && selectedIndex >= 0){
    subtitles.splice(selectedIndex, 1);
    selectedIndex = Math.min(selectedIndex, subtitles.length - 1);
    updateScale();
    renderList();
  }
});

window.addEventListener("resize", updateScale);

updateScale();
renderList();
if(!rafStarted){
  rafStarted = true;
  loop();
}
