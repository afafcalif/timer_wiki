// ==== Utilities ====
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
$('#tz').textContent = TZ;

// Default pre-alert options (min)
const DEFAULT_PRE = [1,3,5,10,15,30,60];

// LocalStorage key
const LS_KEY = 'bosstimer_v1';

/**
 * Timer shape:
 * {
 *   id: string,
 *   name: string,
 *   mode: 'countdown'|'daily',
 *   durationMs?: number,         // countdown
 *   repeatEvery?: boolean,       // countdown
 *   dailyHHMM?: string,          // 'HH:MM' for daily
 *   nextAt: number,              // epoch ms
 *   preAlerts: number[],         // minutes
 *   fired: { [cycleKey:string]: { [offset:number|'due']: true } }
 * }
 */

// ==== State ====
const state = {
  timers: loadTimers(),
  preSelected: new Set([5,10,15]),
  notifGranted: (typeof Notification !== 'undefined' && Notification.permission === 'granted')
};

// ==== Pre-alert chips ====
const preWrap = $('#preChips');
function renderPreChips(){
  preWrap.innerHTML = '';
  DEFAULT_PRE.forEach(min => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.preSelected.has(min) ? ' active' : '');
    chip.textContent = `${min}분 전`;
    chip.onclick = () => {
      if (state.preSelected.has(min)) state.preSelected.delete(min);
      else state.preSelected.add(min);
      renderPreChips();
    };
    preWrap.appendChild(chip);
  });
}
renderPreChips();

// Add custom pre-alert
$('#btnAddPre').onclick = () => {
  const v = parseInt($('#preCustom').value,10);
  if(!Number.isFinite(v) || v<=0) return;
  state.preSelected.add(v);
  $('#preCustom').value = '';
  renderPreChips();
};

// ==== Mode switching ====
$$('input[name="mode"]').forEach(r => r.addEventListener('change', () => {
  const m = document.querySelector('input[name="mode"]:checked').value;
  $('#countdownInputs').style.display = m==='countdown' ? '' : 'none';
  $('#dailyInputs').style.display = m==='daily' ? '' : 'none';
}));

// ==== Notifications ====
const banner = $('#notifyBanner');
if(typeof Notification === 'undefined'){
  banner.innerHTML = '🔕 이 브라우저는 웹 알림을 지원하지 않아요. (알림 없이 페이지 내 표시만 됩니다)';
}
$('#btnEnableNotif').onclick = async () => {
  if(typeof Notification === 'undefined') return;
  const perm = await Notification.requestPermission();
  if(perm === 'granted'){
    state.notifGranted = true;
    banner.textContent = '✅ 알림이 활성화되었습니다.';
  } else {
    banner.innerHTML = '❌ 알림이 거부되었어요. 브라우저 설정에서 알림을 허용해야 합니다.';
  }
};
function notify(title, body){
  try{
    if(state.notifGranted){ new Notification(title, { body }); }
  }catch(e){ /* noop */ }
}

// ==== Add Timer ====
$('#btnAdd').onclick = () => {
  const name = $('#name').value.trim();
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if(!name){ alert('이름을 입력하세요'); return; }

  let nextAt = 0, durationMs = 0, repeatEvery = false, dailyHHMM = undefined;
  const preAlerts = Array.from(state.preSelected).sort((a,b)=>a-b);

  if(mode==='countdown'){
    const minutes = parseInt($('#countdownMin').value,10);
    if(!Number.isFinite(minutes) || minutes<=0){ alert('카운트다운 분을 올바르게 입력하세요'); return; }
    durationMs = minutes*60*1000;
    nextAt = Date.now() + durationMs;
    repeatEvery = $('#repeatEvery').checked;
  } else {
    const hhmm = $('#dailyTime').value; // 'HH:MM'
    if(!hhmm){ alert('시각을 선택하세요'); return; }
    dailyHHMM = hhmm;
    nextAt = computeNextDailyEpoch(hhmm);
  }

  const timer = {
    id: crypto.randomUUID(),
    name, mode,
    durationMs: mode==='countdown'?durationMs:undefined,
    repeatEvery: mode==='countdown'?!!repeatEvery:undefined,
    dailyHHMM: mode==='daily'?dailyHHMM:undefined,
    nextAt,
    preAlerts,
    fired: {}
  };
  state.timers.push(timer);
  saveTimers();
  clearAddForm();
  renderList();
};

function clearAddForm(){
  $('#name').value='';
  $('#countdownMin').value = 60; $('#repeatEvery').checked=false;
  $('#dailyTime').value='';
}

function computeNextDailyEpoch(hhmm){
  const [h,m] = hhmm.split(':').map(n=>parseInt(n,10));
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if(next.getTime() <= now.getTime()){
    next.setDate(next.getDate()+1);
  }
  return next.getTime();
}

// ==== Persistence ====
function loadTimers(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)?arr:[];
  }catch(e){ return [] }
}
function saveTimers(){
  localStorage.setItem(LS_KEY, JSON.stringify(state.timers));
}

// ==== Render list ====
function renderList(){
  const list = $('#list');
  list.innerHTML = '';
  if(!state.timers.length){ $('#emptyHint').style.display=''; return; }
  $('#emptyHint').style.display='none';

  const now = Date.now();
  const sorted = [...state.timers].sort((a,b)=>a.nextAt-b.nextAt);
  for(const t of sorted){
    const el = document.createElement('div');
    el.className = 'timer-item';
    const next = new Date(t.nextAt);
    const {label, cls} = remainLabel(t.nextAt - now);
    const pre = (t.preAlerts||[]).map(m=>`<span class="tag">-${m}m</span>`).join('');
    const meta = t.mode==='daily'
      ? `매일 ${t.dailyHHMM}`
      : `${Math.round((t.durationMs||0)/60000)}분` + (t.repeatEvery? ' · 반복':'');

    el.innerHTML = `
      <div>
        <h4>${escapeHtml(t.name)}</h4>
        <div class="meta">${pre} <span class="tag">${t.mode==='daily'?'DAILY':'COUNTDOWN'}</span></div>
      </div>
      <div class="meta">다음 시각<br>${next.toLocaleString()}</div>
      <div class="remains ${cls}">${label}</div>
      <div class="meta">설정<br>${meta}</div>
      <div class="stack" style="justify-content:flex-end">
        <button class="btn small ghost" data-act="test">테스트</button>
        <button class="btn small" data-act="delay5">+5분</button>
        <button class="btn small danger" data-act="del">삭제</button>
      </div>
    `;

    el.querySelector('[data-act="del"]').onclick = () => {
      state.timers = state.timers.filter(x=>x.id!==t.id);
      saveTimers(); renderList();
    };
    el.querySelector('[data-act="delay5"]').onclick = () => {
      t.nextAt += 5*60*1000;
      saveTimers(); renderList();
    };
    el.querySelector('[data-act="test"]').onclick = () => notify(`테스트: ${t.name}`, '알림이 정상 동작합니다');

    list.appendChild(el);
  }
}

function remainLabel(ms){
  const cls = ms < 0 ? 'overdue' : (ms <= 5*60*1000 ? 'soon' : '');
  const abs = Math.abs(ms);
  const s = Math.floor(abs/1000)%60;
  const m = Math.floor(abs/60000)%60;
  const h = Math.floor(abs/3600000);
  const pad = n => String(n).padStart(2,'0');
  const label = (ms<0?'-':'') + `${pad(h)}:${pad(m)}:${pad(s)}`;
  return {remainMs: ms, label, cls};
}

// ==== Ticker & Alerts ====
function tick(){
  const now = Date.now();
  let changed = false;

  for(const t of state.timers){
    // Cycle key to avoid duplicate alerts across repeats
    const cycleKey = String(t.nextAt);
    t.fired ||= {};
    t.fired[cycleKey] ||= {};

    // Pre-alerts
    (t.preAlerts||[]).forEach(min => {
      const ts = t.nextAt - min*60*1000;
      if(now >= ts && now < t.nextAt && !t.fired[cycleKey][min]){
        notify(`곧 시작: ${t.name}`, `${min}분 후 시작됩니다.`);
        t.fired[cycleKey][min] = true;
        changed = true;
      }
    });

    // Due
    if(now >= t.nextAt){
      if(!t.fired[cycleKey]['due']){
        notify(`시작: ${t.name}`, '지금 시작하세요!');
        t.fired[cycleKey]['due'] = true;
        changed = true;
      }
      // Schedule next cycle
      if(t.mode==='daily'){
        t.nextAt = computeNextDailyEpoch(t.dailyHHMM);
        const nk = String(t.nextAt);
        t.fired[nk] = {};
      } else if(t.mode==='countdown' && t.repeatEvery){
        t.nextAt = now + (t.durationMs||0);
        const nk = String(t.nextAt);
        t.fired[nk] = {};
      }
    }
  }

  if(changed) saveTimers();
  updateTimeLabels();
}

function updateTimeLabels(){
  const now = Date.now();
  const items = $$('#list .timer-item');
  const sorted = [...state.timers].sort((a,b)=>a.nextAt-b.nextAt);
  items.forEach((el, idx) => {
    const t = sorted[idx];
    const {label, cls} = remainLabel(t.nextAt - now);
    const node = el.querySelector('.remains');
    node.textContent = label;
    node.className = 'remains ' + cls;
  });
}

// ==== Import / Export ====
$('#btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify(state.timers,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'bosstimer-export.json'; a.click();
  URL.revokeObjectURL(url);
};

$('#importFile').onchange = evt => {
  const f = evt.target.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const arr = JSON.parse(reader.result);
      if(Array.isArray(arr)){
        const now = Date.now();
        const cleaned = arr.map(x => ({
          id: x.id || crypto.randomUUID(),
          name: String(x.name||'무명'),
          mode: x.mode==='daily'?'daily':'countdown',
          durationMs: x.mode==='countdown'?Number(x.durationMs||0):undefined,
          repeatEvery: !!x.repeatEvery,
          dailyHHMM: x.mode==='daily'?String(x.dailyHHMM||'00:00'):undefined,
          nextAt: Number(x.nextAt) || (x.mode==='daily'
                ? computeNextDailyEpoch(String(x.dailyHHMM||'00:00'))
                : now + Number(x.durationMs||0)),
          preAlerts: Array.isArray(x.preAlerts)
                ? x.preAlerts.map(Number).filter(n=>Number.isFinite(n)&&n>0)
                : [],
          fired: {}
        }));
        state.timers = cleaned; saveTimers(); renderList();
      } else {
        alert('올바른 JSON이 아닙니다');
      }
    }catch(e){
      alert('가져오기 실패: '+e.message);
    }
  };
  reader.readAsText(f);
  evt.target.value = '';
};

// ==== Misc ====
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]
  ));
}

// ==== Init ====
renderList();
setInterval(tick, 1000);
