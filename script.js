// ==== Utilities ====
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
$('#tz').textContent = TZ;

function openTimePicker(el){
	try{
		if (el && typeof el.showPicker === 'function') {
			el.showPicker();
			return true;
		}
	} catch(_) {}
	if (el) {
		el.focus();
		try { el.click(); } catch(_) {}
		return true;
	}
	return false;
}

// Default pre-alert options (min)
const DEFAULT_PRE = [1,3,5,10,15,30,60];

// LocalStorage key
const LS_KEY = 'bosstimer_v1';

/**
 * Timer shape:
 * {
 * 	id: string,
 * 	name: string,
 * 	mode: 'countdown'|'daily',
 * 	durationMs?: number,         // countdown
 * 	repeatEvery?: boolean,       // countdown
 * 	dailyHHMM?: string,          // 'HH:MM' for daily
 * 	nextAt: number,              // epoch ms
 * 	preAlerts: number[],         // minutes
 * 	fired: { [cycleKey:string]: { [offset:number|'due']: true } }
 * }
 */

// ==== State ====
const state = {
	timers: loadTimers(),
	preSelected: new Set([5,10,15]),
	notifGranted: (typeof Notification !== 'undefined' && Notification.permission === 'granted')
};

// ==== Sound (Web Audio) ====
let audioCtx = null;
function ensureAudio() {
	try {
		if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		if (audioCtx.state === 'suspended') audioCtx.resume();
	} catch (e) { /* noop */ }
}
function beep({ freq=880, duration=220, type='sine', volume=0.10 } = {}) {
	if (!audioCtx) return;
	const osc = audioCtx.createOscillator();
	const gain = audioCtx.createGain();
	osc.type = type;
	osc.frequency.value = freq;
	gain.gain.setValueAtTime(volume, audioCtx.currentTime);
	osc.connect(gain); gain.connect(audioCtx.destination);
	osc.start();
	osc.stop(audioCtx.currentTime + duration/1000);
}
$('#btnEnableSound')?.addEventListener('click', () => { ensureAudio(); beep(); });

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
	// play beep if user enabled audio
	beep();
}

// ==== Add Timer ====
$('#btnAdd').onclick = () => {
	const name = $('#name').value.trim();
	const mode = document.querySelector('input[name="mode"]:checked').value;
	if(!name){ alert('이름을 입력하세요'); return; }

	let nextAt = 0, durationMs = 0, repeatEvery = false, dailyHHMM = undefined;
	let preAlerts = Array.from(state.preSelected).sort((a,b)=>a-b);

	if(mode==='countdown'){
		const minutes = parseInt($('#countdownMin').value,10);
		if(!Number.isFinite(minutes) || minutes<=0){ alert('카운트다운 분을 올바르게 입력하세요'); return; }
		durationMs = minutes*60*1000;
		nextAt = Date.now() + durationMs;
		repeatEvery = $('#repeatEvery').checked;

		// ❗ 카운트다운 길이보다 긴 사전 알림은 제거
		preAlerts = preAlerts.filter(m => m*60*1000 < durationMs);
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

		const isDaily = t.mode === 'daily';
		const nextLabel = isDaily ? new Date(t.nextAt).toLocaleString() : '—'; // 카운트다운은 다음 시각 표시 X
		const {label, cls} = remainLabel(t.nextAt - now);
		const pre = (t.preAlerts||[]).map(m=>`<span class="tag">-${m}m</span>`).join('');
		const meta = isDaily
			? `매일 ${t.dailyHHMM}`
			: `${Math.round((t.durationMs||0)/60000)}분` + (t.repeatEvery? ' · 반복':'');

		el.innerHTML = `
			<div>
				<h4>${escapeHtml(t.name)}</h4>
				<div class="meta">${pre} <span class="tag">${isDaily?'DAILY':'COUNTDOWN'}</span></div>
			</div>
			<div class="meta">다음 시각<br>${nextLabel}</div>
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
		el.querySelector('[data-act="test"]').onclick = () => { ensureAudio(); notify(`테스트: ${t.name}`, '알림이 정상 동작합니다'); };

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

// ==== Alarm History ====
const HISTORY_STORAGE_KEY = 'timerwiki.history.v1';
const historyState = {
	items: [],				// [{id, title, type, triggeredAt, extra}]
	limit: 10,
	tickTimer: null
};

function loadHistoryFromStorage() {
	try {
		const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed.items)) historyState.items = parsed.items;
			if (typeof parsed.limit === 'number') historyState.limit = parsed.limit;
		}
	} catch (e) {
		console.warn('Failed to load history:', e);
	}
}

function saveHistoryToStorage() {
	try {
		localStorage.setItem(
			HISTORY_STORAGE_KEY,
			JSON.stringify({ items: historyState.items, limit: historyState.limit })
		);
	} catch (e) {
		console.warn('Failed to save history:', e);
	}
}

function setHistoryLimit(newLimit) {
	historyState.limit = Math.max(1, Math.min(50, Number(newLimit) || 10));
	pruneHistory();
	saveHistoryToStorage();
	renderHistory();
}

function pruneHistory() {
	if (historyState.items.length > historyState.limit) {
		historyState.items = historyState.items.slice(0, historyState.limit);
	}
}

function recordAlarmTrigger({ id, title, type = 'countdown', extra = {} }) {
	const nowISO = new Date().toISOString();
	historyState.items.unshift({
		id: String(id ?? crypto.randomUUID?.() ?? Date.now()),
		title: String(title ?? '알람'),
		type,
		triggeredAt: nowISO,
		extra
	});
	pruneHistory();
	saveHistoryToStorage();
	renderHistory();
}

function deleteHistoryItem(id) {
	historyState.items = historyState.items.filter((it) => it.id !== id);
	saveHistoryToStorage();
	renderHistory();
}

function clearHistory() {
	historyState.items = [];
	saveHistoryToStorage();
	renderHistory();
}

function fmtTypeLabel(type) {
	switch (type) {
		case 'countdown': return '카운트다운';
		case 'daily': return '매일 알람';
		case 'once': return '단발 알람';
		default: return type || '알람';
	}
}

function relativeTimeFrom(iso) {
	const dt = new Date(iso);
	const diffMs = Date.now() - dt.getTime();
	const sec = Math.round(diffMs / 1000);
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	if (Math.abs(sec) < 60) return rtf.format(-sec, 'second');
	const min = Math.round(sec / 60);
	if (Math.abs(min) < 60) return rtf.format(-min, 'minute');
	const hr = Math.round(min / 60);
	if (Math.abs(hr) < 24) return rtf.format(-hr, 'hour');
	const day = Math.round(hr / 24);
	return rtf.format(-day, 'day');
}

function renderHistory() {
	const listEl = document.getElementById('history-list');
	const countEl = document.getElementById('history-count');
	const limitInput = document.getElementById('history-limit');
	if (!listEl) return;

	if (countEl) countEl.textContent = `${historyState.items.length} / ${historyState.limit}`;
	if (limitInput && Number(limitInput.value) !== historyState.limit) {
		limitInput.value = historyState.limit;
	}

	listEl.innerHTML = '';
	for (const item of historyState.items) {
		const li = document.createElement('li');
		li.className = 'history-item';
		li.dataset.id = item.id;

		const left = document.createElement('div');
		left.className = 'history-title';
		left.textContent = item.title;

		const center = document.createElement('div');
		center.className = 'history-meta';
		center.textContent = `${fmtTypeLabel(item.type)} · ${relativeTimeFrom(item.triggeredAt)}`;

		const delBtn = document.createElement('button');
		delBtn.className = 'history-delete';
		delBtn.type = 'button';
		delBtn.textContent = '삭제';
		delBtn.addEventListener('click', () => deleteHistoryItem(item.id));

		li.appendChild(left);
		li.appendChild(center);
		li.appendChild(delBtn);
		listEl.appendChild(li);
	}
}

function startHistoryTicker() {
	stopHistoryTicker();
	historyState.tickTimer = setInterval(() => {
		const listEl = document.getElementById('history-list');
		if (!listEl) return;
		for (const li of listEl.children) {
			const id = li.dataset.id;
			const item = historyState.items.find((x) => x.id === id);
			if (!item) continue;
			const meta = li.querySelector('.history-meta');
			if (meta) {
				meta.textContent = `${fmtTypeLabel(item.type)} · ${relativeTimeFrom(item.triggeredAt)}`;
			}
		}
	}, 1000);
}

function stopHistoryTicker() {
	if (historyState.tickTimer) {
		clearInterval(historyState.tickTimer);
		historyState.tickTimer = null;
	}
}

function initHistoryUI() {
	loadHistoryFromStorage();
	renderHistory();
	startHistoryTicker();

	const clearBtn = document.getElementById('btn-clear-history');
	if (clearBtn) clearBtn.addEventListener('click', clearHistory);

	const limitInput = document.getElementById('history-limit');
	if (limitInput) {
		limitInput.addEventListener('change', (e) => setHistoryLimit(e.target.value));
	}
}

// ==== Ticker & Alerts ====
function tick(){
	const now = Date.now();
	let changed = false;
	const idsToDelete = [];

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

				// === 히스토리 기록 ===
				recordAlarmTrigger({
					id: t.id,
					title: t.name,
					type: (t.mode === 'daily') ? 'daily' : (t.repeatEvery ? 'countdown' : 'once')
				});
			}

			// Schedule next cycle or delete
			if(t.mode==='daily'){
				t.nextAt = computeNextDailyEpoch(t.dailyHHMM);
				const nk = String(t.nextAt);
				t.fired[nk] = {};
			} else if(t.mode==='countdown'){
				if(t.repeatEvery){
					t.nextAt = now + (t.durationMs||0);
					const nk = String(t.nextAt);
					t.fired[nk] = {};
				} else {
					// 반복 없는 카운트다운은 due 후 자동 삭제 (요청대로 기존 동작 유지)
					idsToDelete.push(t.id);
				}
			}
		}
	}

	if(idsToDelete.length){
		state.timers = state.timers.filter(x => !idsToDelete.includes(x.id));
		changed = true;
		renderList(); // 행 삭제 반영
	} else {
		updateTimeLabels(); // 남은 시간만 갱신
	}

	if(changed) saveTimers();
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
	a.href = url; a.download = 'timer.wiki-export.json'; a.click();
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
document.addEventListener('DOMContentLoaded', () => {
	initHistoryUI();

	const dailyWrap = document.getElementById('dailyInputs');
	const dailyTime = document.getElementById('dailyTime');

	if (dailyWrap && dailyTime) {
		// ① 컨테이너(라벨/빈 공간) 클릭 시 열기
		dailyWrap.addEventListener('click', (e) => {
			const m = document.querySelector('input[name="mode"]:checked')?.value;
			if (m !== 'daily') return;

			// input 자체를 눌렀을 때도 강제로 열어주자 (브라우저마다 다름)
			openTimePicker(dailyTime);
		});

		// ② 입력칸을 눌렀을 때도 무조건 열리도록 (아이콘 안 눌러도 뜨게)
		dailyTime.addEventListener('pointerdown', (e) => {
			const m = document.querySelector('input[name="mode"]:checked')?.value;
			if (m !== 'daily') return;
			// 기본 포커스 흐름 대신 바로 피커 열기
			e.preventDefault();
			openTimePicker(dailyTime);
		}, { passive: false });

		// ③ 키보드 접근성: 엔터/스페이스로도 열기
		dailyWrap.addEventListener('keydown', (e) => {
			const m = document.querySelector('input[name="mode"]:checked')?.value;
			if (m !== 'daily') return;
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openTimePicker(dailyTime);
			}
		});
	}
});

renderList();
setInterval(tick, 1000);

// ==== Layout order toggle ====
const LAYOUT_KEY = 'timerwiki.layout.v1'; // 'history-first' | 'timers-first'

function applyLayoutOrder(pref){
	const cont = document.querySelector('.container');
	const timers = document.getElementById('timers-section');
	const history = document.getElementById('history-section');
	if(!cont || !timers || !history) return;

	if(pref === 'history-first'){
		cont.insertBefore(history, timers);
	} else {
		cont.insertBefore(timers, history);
	}

	const chk = document.getElementById('layout-history-first');
	if(chk) chk.checked = (pref === 'history-first');
}

function loadLayoutPref(){
	try{ return localStorage.getItem(LAYOUT_KEY) || 'timers-first'; }
	catch(e){ return 'timers-first'; }
}

function saveLayoutPref(pref){
	try{ localStorage.setItem(LAYOUT_KEY, pref); } catch(e){}
}

// 초기화 시 호출 (initHistoryUI/렌더 직후 어느 시점이든 OK)
document.addEventListener('DOMContentLoaded', () => {
	const pref = loadLayoutPref();
	applyLayoutOrder(pref);

	const chk = document.getElementById('layout-history-first');
	if(chk){
		chk.addEventListener('change', (e) => {
			const next = e.target.checked ? 'history-first' : 'timers-first';
			saveLayoutPref(next);
			applyLayoutOrder(next);
		});
	}
});
