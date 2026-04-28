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
const statusText = document.getElementById("statusText");
const currentTimeEl = document.getElementById("currentTime");
const durationTimeEl = document.getElementById("durationTime");
const waveCanvas = document.getElementById("waveCanvas");
const rulerCanvas = document.getElementById("rulerCanvas");
const wrap = document.getElementById("timelineCanvasWrap");
const scroller = document.getElementById("timelineScroller");
const playhead = document.getElementById("playhead");
const track = document.getElementById("subtitleTrack");
const list = document.getElementById("subtitleList");

let subtitles = [];
let audioBuffer = null;
let audioUrl = null;
let selectedIndex = -1;
let pxPerSecond = 85;
let dragging = null;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function parseTime(str){
  const clean = str.trim().replace(".", ",");
  const [h,m,rest] = clean.split(":");
  const [s,ms="0"] = rest.split(",");
  return Number(h)*3600 + Number(m)*60 + Number(s) + Number(ms.padEnd(3,"0").slice(0,3))/1000;
}
function formatTime(t){
  t = Math.max(0, t || 0);
  const h = Math.floor(t/3600);
  const m = Math.floor((t%3600)/60);
  const s = Math.floor(t%60);
  const ms = Math.round((t-Math.floor(t))*1000);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}
function parseSRT(text){
  const normalized = text.replace(/\r/g,"").trim();
  if(!normalized) return [];
  return normalized.split(/\n\s*\n/).map(block=>{
    const lines = block.split("\n");
    const timeLineIndex = lines.findIndex(l => l.includes("-->"));
    if(timeLineIndex < 0) return null;
    const [startRaw,endRaw] = lines[timeLineIndex].split("-->");
    return {
      start: parseTime(startRaw),
      end: parseTime(endRaw),
      text: lines.slice(timeLineIndex+1).join("\n").trim()
    };
  }).filter(Boolean);
}
function exportSRT(){
  return subtitles.map((s,i)=>`${i+1}\n${formatTime(s.start)} --> ${formatTime(s.end)}\n${s.text}\n`).join("\n");
}
function updateScale(){
  pxPerSecond = 35 + Number(zoomRange.value) * 18;
  const duration = audio.duration || audioBuffer?.duration || 60;
  const width = Math.max(scroller.clientWidth, Math.ceil(duration * pxPerSecond));
  wrap.style.width = width + "px";
  [waveCanvas, rulerCanvas].forEach(c=>{
    c.width = width * devicePixelRatio;
    c.height = (c === waveCanvas ? 130 : 34) * devicePixelRatio;
    c.style.width = width + "px";
  });
  drawRuler();
  drawWaveform();
  renderClips();
}
function drawRuler(){
  const ctx = rulerCanvas.getContext("2d");
  const w = rulerCanvas.width, h = rulerCanvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const cssW = w/devicePixelRatio;
  ctx.fillStyle = "#080c13";
  ctx.fillRect(0,0,cssW,h/devicePixelRatio);
  ctx.strokeStyle = "#27344f";
  ctx.fillStyle = "#93a4bf";
  ctx.font = "12px Microsoft JhengHei, sans-serif";
  const step = pxPerSecond > 180 ? 1 : pxPerSecond > 90 ? 2 : 5;
  const duration = audio.duration || audioBuffer?.duration || 60;
  for(let t=0; t<=duration; t+=step){
    const x = t * pxPerSecond;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 34);
    ctx.stroke();
    ctx.fillText(formatClock(t), x+4, 22);
  }
  ctx.setTransform(1,0,0,1,0,0);
}
function formatClock(t){
  const m = Math.floor(t/60), s = Math.floor(t%60);
  return `${m}:${String(s).padStart(2,"0")}`;
}
function drawWaveform(){
  const ctx = waveCanvas.getContext("2d");
  const w = waveCanvas.width, h = waveCanvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const cssW = w/devicePixelRatio, cssH = h/devicePixelRatio;
  ctx.fillStyle = "#080c13";
  ctx.fillRect(0,0,cssW,cssH);
  if(!audioBuffer){
    ctx.fillStyle="#62718b";
    ctx.font="14px Microsoft JhengHei, sans-serif";
    ctx.fillText("載入音訊後會顯示整段波形", 18, 68);
    ctx.setTransform(1,0,0,1,0,0);
    return;
  }
  const data = audioBuffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(data.length / cssW));
  ctx.strokeStyle = "#31d6ff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const mid = cssH/2;
  for(let x=0; x<cssW; x++){
    let min=1, max=-1;
    const start = x * samplesPerPixel;
    for(let j=0; j<samplesPerPixel; j++){
      const v = data[start+j] || 0;
      if(v<min) min=v;
      if(v>max) max=v;
    }
    ctx.moveTo(x, mid + min*mid*.88);
    ctx.lineTo(x, mid + max*mid*.88);
  }
  ctx.stroke();
  ctx.setTransform(1,0,0,1,0,0);
}
function renderClips(){
  track.innerHTML = "";
  subtitles.forEach((s,i)=>{
    const div = document.createElement("div");
    div.className = "clip" + (i===selectedIndex ? " selected" : "");
    div.style.left = (s.start * pxPerSecond) + "px";
    div.style.width = Math.max(28, (s.end - s.start) * pxPerSecond) + "px";
    div.textContent = s.text;
    div.dataset.index = i;
    div.addEventListener("mousedown", startDrag);
    div.addEventListener("click", e => { e.stopPropagation(); selectSubtitle(i); });
    track.appendChild(div);
  });
}
function renderList(){
  list.innerHTML = "";
  subtitles.forEach((s,i)=>{
    const row = document.createElement("div");
    row.className = "sub-row" + (i===selectedIndex ? " selected" : "");
    row.dataset.index = i;
    row.innerHTML = `
      <div>${i+1}</div>
      <input value="${formatTime(s.start)}" data-field="start" />
      <input value="${formatTime(s.end)}" data-field="end" />
      <textarea data-field="text">${escapeHtml(s.text)}</textarea>
    `;
    row.addEventListener("click", () => selectSubtitle(i));
    row.querySelectorAll("input,textarea").forEach(input=>{
      input.addEventListener("change", e=>{
        const field = e.target.dataset.field;
        if(field === "text") subtitles[i].text = e.target.value;
        if(field === "start") subtitles[i].start = parseTime(e.target.value);
        if(field === "end") subtitles[i].end = parseTime(e.target.value);
        normalizeSubtitle(i);
        renderAll();
      });
    });
    list.appendChild(row);
  });
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function normalizeSubtitle(i){
  subtitles[i].start = Math.max(0, subtitles[i].start);
  subtitles[i].end = Math.max(subtitles[i].start + .05, subtitles[i].end);
}
function renderAll(){
  renderClips();
  renderList();
  updateActive();
}
function selectSubtitle(i){
  selectedIndex = i;
  const s = subtitles[i];
  if(s) {
    audio.currentTime = s.start;
    scroller.scrollLeft = Math.max(0, s.start * pxPerSecond - 160);
  }
  renderAll();
}
function startDrag(e){
  const i = Number(e.currentTarget.dataset.index);
  selectedIndex = i;
  dragging = {
    index:i,
    startX:e.clientX,
    originalStart:subtitles[i].start,
    originalEnd:subtitles[i].end
  };
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", stopDrag);
}
function onDrag(e){
  if(!dragging) return;
  const dx = (e.clientX - dragging.startX) / pxPerSecond;
  const dur = dragging.originalEnd - dragging.originalStart;
  let ns = Math.max(0, dragging.originalStart + dx);
  subtitles[dragging.index].start = ns;
  subtitles[dragging.index].end = ns + dur;
  renderClips();
}
function stopDrag(){
  if(dragging){
    renderAll();
    dragging = null;
  }
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);
}
function applyOffset(seconds){
  subtitles.forEach(s=>{
    s.start = Math.max(0, s.start + seconds);
    s.end = Math.max(s.start + .05, s.end + seconds);
  });
  renderAll();
}
function updateActive(){
  const t = audio.currentTime || 0;
  currentTimeEl.textContent = formatTime(t);
  durationTimeEl.textContent = formatTime(audio.duration || 0);
  playhead.style.left = (t * pxPerSecond) + "px";
  const activeIndex = subtitles.findIndex(s => t >= s.start && t <= s.end);
  document.querySelectorAll(".clip").forEach((el,i)=>{
    el.classList.toggle("active", i===activeIndex);
    el.classList.toggle("selected", i===selectedIndex);
  });
  document.querySelectorAll(".sub-row").forEach((el,i)=>{
    el.classList.toggle("active", i===activeIndex);
    el.classList.toggle("selected", i===selectedIndex);
  });
  if(activeIndex >= 0){
    const row = list.children[activeIndex];
    if(row && !row.matches(":hover")) row.scrollIntoView({block:"nearest"});
  }
}
function animationLoop(){
  updateActive();
  requestAnimationFrame(animationLoop);
}
function detectOffset(){
  if(!audioBuffer || subtitles.length === 0){
    detectResult.textContent = "請先載入音訊與字幕。";
    return;
  }
  const data = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const windowSize = Math.floor(sr * 0.05);
  let maxEnergy = 0;
  for(let i=0; i<Math.min(data.length, sr*30); i+=windowSize){
    let sum=0;
    for(let j=0;j<windowSize;j++){
      const v = data[i+j] || 0;
      sum += Math.abs(v);
    }
    maxEnergy = Math.max(maxEnergy, sum/windowSize);
  }
  const threshold = maxEnergy * 0.28;
  let firstSound = 0;
  for(let i=0; i<Math.min(data.length, sr*60); i+=windowSize){
    let sum=0;
    for(let j=0;j<windowSize;j++){
      const v = data[i+j] || 0;
      sum += Math.abs(v);
    }
    if(sum/windowSize > threshold){
      firstSound = i/sr;
      break;
    }
  }
  const offset = firstSound - subtitles[0].start;
  applyOffset(offset);
  detectResult.textContent = `偵測音訊起點約 ${firstSound.toFixed(2)} 秒，已套用偏移 ${offset.toFixed(2)} 秒。`;
}
audioInput.addEventListener("change", async e=>{
  const file = e.target.files[0];
  if(!file) return;
  if(audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(file);
  audio.src = audioUrl;
  statusText.textContent = "正在分析音訊波形...";
  const arr = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arr.slice(0));
  statusText.textContent = `音訊已載入：${file.name}`;
  updateScale();
});
srtInput.addEventListener("change", e=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=>{
    subtitles = parseSRT(ev.target.result);
    selectedIndex = subtitles.length ? 0 : -1;
    statusText.textContent = `字幕已載入：${subtitles.length} 句`;
    renderAll();
  };
  reader.readAsText(file, "utf-8");
});
audio.addEventListener("loadedmetadata", updateScale);
playBtn.addEventListener("click", async ()=>{
  await audioCtx.resume();
  audio.paused ? audio.play() : audio.pause();
});
backBtn.addEventListener("click",()=> audio.currentTime = Math.max(0, audio.currentTime-1));
forwardBtn.addEventListener("click",()=> audio.currentTime = Math.min(audio.duration || 999999, audio.currentTime+1));
offsetBtn.addEventListener("click",()=> applyOffset(Number(offsetInput.value || 0)));
zoomRange.addEventListener("input", updateScale);
detectBtn.addEventListener("click", detectOffset);
exportBtn.addEventListener("click",()=>{
  const blob = new Blob([exportSRT()], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fixed-subtitles.srt";
  a.click();
  URL.revokeObjectURL(a.href);
});
scroller.addEventListener("click", e=>{
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  audio.currentTime = Math.max(0, x / pxPerSecond);
});
document.addEventListener("keydown", e=>{
  if(["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) return;
  if(e.code === "Space"){
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  }
  if(e.code === "ArrowRight") audio.currentTime = Math.min(audio.duration || 999999, audio.currentTime + .5);
  if(e.code === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - .5);
  if(e.code === "KeyA" && selectedIndex >= 0){ applySelectedOffset(-.1); }
  if(e.code === "KeyD" && selectedIndex >= 0){ applySelectedOffset(.1); }
  if(e.code === "Delete" && selectedIndex >= 0){
    subtitles.splice(selectedIndex,1);
    selectedIndex = Math.min(selectedIndex, subtitles.length-1);
    renderAll();
  }
});
function applySelectedOffset(v){
  subtitles[selectedIndex].start = Math.max(0, subtitles[selectedIndex].start + v);
  subtitles[selectedIndex].end = Math.max(subtitles[selectedIndex].start + .05, subtitles[selectedIndex].end + v);
  renderAll();
}
window.addEventListener("resize", updateScale);
updateScale();
animationLoop();
