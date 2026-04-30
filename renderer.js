/* ── Constants ────────────────────────────────────────────────── */
const DEFAULT_BUSINESS_HOURS = { start: 9, end: 18 };
const WORK_STATE = { OPEN: 'open', BUFFER: 'buffer', CLOSED: 'closed' };

/* ── State ────────────────────────────────────────────────────── */
let activeClocks = []; // [{ id, iana, customLabel, businessHours: { start, end } }]
let format24h    = false;
let tickTimeout  = null;
let tickInterval = null;
let dragSrcId    = null;
let dragOverCard = null;

/* ── DOM refs ─────────────────────────────────────────────────── */
const searchInput     = document.getElementById('tz-search');
const clearSearchBtn  = document.getElementById('btn-clear-search');
const dropdown        = document.getElementById('tz-dropdown');
const tzList          = document.getElementById('tz-list');
const clocksContainer = document.getElementById('clocks-container');
const emptyState      = document.getElementById('empty-state');
const footerDate      = document.getElementById('footer-date');
const btnPin          = document.getElementById('btn-pin');
const btnMin          = document.getElementById('btn-min');
const btnClose        = document.getElementById('btn-close');
const btn24h          = document.getElementById('btn-24h');
const toast           = document.getElementById('toast');

/* ── Init ─────────────────────────────────────────────────────── */
async function init() {
  if (window.electronAPI) {
    const saved = await window.electronAPI.storeGet('activeClocks');
    if (Array.isArray(saved) && saved.length) {
      activeClocks = saved.map(c => ({
        ...c,
        businessHours: c.businessHours ?? DEFAULT_BUSINESS_HOURS,
      }));
    }
    const pinned = await window.electronAPI.storeGet('alwaysOnTop');
    if (pinned === false) btnPin.classList.remove('pin-active');

    format24h = !!(await window.electronAPI.storeGet('format24h'));
  }

  syncBtn24h();
  renderAllClocks();
  startTick();
  updateFooterDate();

  btnClose.addEventListener('click', () => window.electronAPI?.closeApp());
  btnMin.addEventListener('click',   () => window.electronAPI?.minimizeApp());
  btnPin.addEventListener('click', async () => {
    const next = await window.electronAPI?.toggleAlwaysOnTop();
    btnPin.classList.toggle('pin-active', next !== false);
  });
  btn24h.addEventListener('click', async () => {
    format24h = !format24h;
    syncBtn24h();
    await window.electronAPI?.storeSet('format24h', format24h);
    tick();
  });

  searchInput.addEventListener('input',   handleSearch);
  searchInput.addEventListener('keydown', handleSearchKeydown);
  searchInput.addEventListener('focus',   () => {
    renderDropdown(filterTimezones(searchInput.value.trim().toLowerCase()));
    showDropdown();
  });
  clearSearchBtn.addEventListener('click', clearSearch);

  document.addEventListener('click', (e) => {
    if (!document.getElementById('add-panel').contains(e.target)) hideDropdown();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { clearSearch(); hideDropdown(); }
  });
}

/* ── Search / Dropdown ───────────────────────────────────────── */
let dropdownFocusIndex = -1;

function filterTimezones(q) {
  if (!q) return TIMEZONES;
  return TIMEZONES.filter(tz =>
    tz.label.toLowerCase().includes(q) ||
    tz.iana.toLowerCase().includes(q)
  );
}

function handleSearch() {
  const q = searchInput.value.trim().toLowerCase();
  clearSearchBtn.classList.toggle('hidden', !q);
  renderDropdown(filterTimezones(q));
  showDropdown();
}

function handleSearchKeydown(e) {
  const items = [...tzList.querySelectorAll('li:not(.already-added)')];
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    dropdownFocusIndex = Math.min(dropdownFocusIndex + 1, items.length - 1);
    applyDropdownFocus(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    dropdownFocusIndex = Math.max(dropdownFocusIndex - 1, 0);
    applyDropdownFocus(items);
  } else if (e.key === 'Enter' && dropdownFocusIndex >= 0) {
    items[dropdownFocusIndex]?.click();
  }
}

function applyDropdownFocus(items) {
  items.forEach((li, i) => li.classList.toggle('focused', i === dropdownFocusIndex));
  items[dropdownFocusIndex]?.scrollIntoView({ block: 'nearest' });
}

function renderDropdown(results) {
  tzList.innerHTML = '';
  dropdownFocusIndex = -1;

  if (!results.length) {
    const li = document.createElement('li');
    li.style.cssText = 'cursor:default;opacity:0.4;padding:10px 14px;';
    li.textContent = 'No results';
    tzList.appendChild(li);
    return;
  }

  results.forEach(tz => {
    const alreadyAdded = activeClocks.some(c => c.iana === tz.iana);
    const li = document.createElement('li');
    if (alreadyAdded) li.classList.add('already-added');

    const labelSpan = document.createElement('span');
    labelSpan.textContent = tz.label;

    const badge = document.createElement('span');
    badge.className = 'tz-badge';
    badge.textContent = offsetLabel(tz.iana);

    li.appendChild(makeSvg('check-icon', '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>'));
    li.appendChild(labelSpan);
    li.appendChild(badge);

    if (!alreadyAdded) {
      li.addEventListener('click', () => {
        addClock(tz.iana, tz.label);
        clearSearch();
        hideDropdown();
      });
    }

    tzList.appendChild(li);
  });
}

function showDropdown() { dropdown.classList.remove('hidden'); }
function hideDropdown()  { dropdown.classList.add('hidden'); dropdownFocusIndex = -1; }
function clearSearch()   {
  searchInput.value = '';
  clearSearchBtn.classList.add('hidden');
  hideDropdown();
}

/* ── Clock management ────────────────────────────────────────── */
function addClock(iana, defaultLabel) {
  const id = `clock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  activeClocks.push({ id, iana, customLabel: defaultLabel, businessHours: DEFAULT_BUSINESS_HOURS });
  persist();
  renderAllClocks();
}

function removeClock(id) {
  activeClocks = activeClocks.filter(c => c.id !== id);
  persist();
  renderAllClocks();
}

function updateLabel(id, newLabel) {
  mutateClock(id, c => { c.customLabel = newLabel; });
}

function updateBusinessHours(id, start, end) {
  mutateClock(id, c => { c.businessHours = { start, end }; });
  tick();
}

function mutateClock(id, fn) {
  const clock = activeClocks.find(c => c.id === id);
  if (clock) { fn(clock); persist(); }
}

/* ── Rendering ───────────────────────────────────────────────── */
function renderAllClocks() {
  clocksContainer.querySelectorAll('.clock-card').forEach(el => el.remove());
  emptyState.style.display = activeClocks.length ? 'none' : '';
  activeClocks.forEach(clock => clocksContainer.appendChild(buildCard(clock)));
}

function buildCard(clock) {
  const bh = clock.businessHours ?? DEFAULT_BUSINESS_HOURS;

  const card = document.createElement('div');
  card.className = 'clock-card';
  card.dataset.id = clock.id;
  card.draggable = true;

  /* Header */
  const header = document.createElement('div');
  header.className = 'clock-header';

  const labelWrap = document.createElement('div');
  labelWrap.className = 'clock-label-wrap';

  const labelInput = document.createElement('input');
  labelInput.className = 'clock-label';
  labelInput.type = 'text';
  labelInput.value = clock.customLabel;
  labelInput.title = 'Click to rename';
  labelInput.spellcheck = false;

  labelWrap.appendChild(labelInput);
  labelWrap.appendChild(makeSvg('edit-icon', '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>'));

  const cardBtns = document.createElement('div');
  cardBtns.className = 'card-btns';

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'btn-settings';
  settingsBtn.title = 'Settings';
  settingsBtn.appendChild(makeSvg(null, '<path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>', '12', '12'));

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove';
  removeBtn.title = 'Remove clock';
  removeBtn.appendChild(makeSvg(null, '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>', '12', '12'));

  cardBtns.appendChild(settingsBtn);
  cardBtns.appendChild(removeBtn);
  header.appendChild(labelWrap);
  header.appendChild(cardBtns);

  /* Time display */
  const timeEl = document.createElement('div');
  timeEl.className = 'clock-time';
  timeEl.dataset.iana = clock.iana;
  timeEl.title = 'Click to copy';

  /* Meta row */
  const metaEl = document.createElement('div');
  metaEl.className = 'clock-meta';

  const metaLeft = document.createElement('div');
  metaLeft.className = 'meta-left';

  const dateEl    = document.createElement('span');
  dateEl.className = 'clock-date';

  const dayDiffEl = document.createElement('span');
  dayDiffEl.className = 'day-diff';

  metaLeft.appendChild(dateEl);
  metaLeft.appendChild(dayDiffEl);

  const offsetEl = document.createElement('span');
  offsetEl.className = 'clock-offset';

  metaEl.appendChild(metaLeft);
  metaEl.appendChild(offsetEl);

  /* Settings panel */
  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'card-settings hidden';
  settingsPanel.innerHTML = `
    <div class="settings-row">
      <span class="settings-label">Business hours</span>
      <div class="bh-inputs">
        <input type="time" class="bh-start" value="${toHHMM(bh.start)}" step="3600" />
        <span class="bh-sep">–</span>
        <input type="time" class="bh-end" value="${toHHMM(bh.end)}" step="3600" />
      </div>
    </div>
  `;

  card.appendChild(header);
  card.appendChild(timeEl);
  card.appendChild(metaEl);
  card.appendChild(settingsPanel);

  labelInput.addEventListener('change', () => updateLabel(clock.id, labelInput.value.trim() || clock.iana));
  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { labelInput.blur(); }
    if (e.key === 'Escape') { labelInput.value = clock.customLabel; labelInput.blur(); }
  });

  removeBtn.addEventListener('click', () => removeClock(clock.id));

  settingsBtn.addEventListener('click', () => {
    const isHidden = settingsPanel.classList.toggle('hidden');
    settingsBtn.classList.toggle('active', !isHidden);
  });

  const bhStart = settingsPanel.querySelector('.bh-start');
  const bhEnd   = settingsPanel.querySelector('.bh-end');
  function saveBH() {
    const s = parseInt(bhStart.value.split(':')[0]);
    const e = parseInt(bhEnd.value.split(':')[0]);
    if (!isNaN(s) && !isNaN(e) && s < e) updateBusinessHours(clock.id, s, e);
  }
  bhStart.addEventListener('change', saveBH);
  bhEnd.addEventListener('change', saveBH);

  timeEl.addEventListener('click', () => {
    const { h12, minutes, ampm } = formatTime(clock.iana, new Date());
    const text = format24h ? `${h12}:${minutes}` : `${h12}:${minutes} ${ampm}`;
    navigator.clipboard?.writeText(text)?.then(() => showToast('Copied!'));
  });

  card.addEventListener('dragstart', (e) => {
    if (e.target.closest('input, button')) { e.preventDefault(); return; }
    dragSrcId = clock.id;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    if (dragOverCard) { dragOverCard.classList.remove('drag-over'); dragOverCard = null; }
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (clock.id === dragSrcId) return;
    if (dragOverCard !== card) {
      dragOverCard?.classList.remove('drag-over');
      dragOverCard = card;
      card.classList.add('drag-over');
    }
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragSrcId || dragSrcId === clock.id) return;
    const srcIdx  = activeClocks.findIndex(c => c.id === dragSrcId);
    const destIdx = activeClocks.findIndex(c => c.id === clock.id);
    dragSrcId = null;
    if (srcIdx < 0 || destIdx < 0) return;
    const [moved] = activeClocks.splice(srcIdx, 1);
    activeClocks.splice(destIdx, 0, moved);
    persist();
    renderAllClocks();
  });

  updateCard(card, clock);
  return card;
}

/* ── Tick / time update ──────────────────────────────────────── */
function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  if (tickTimeout)  clearTimeout(tickTimeout);
  tick();
  const msToNextSecond = 1000 - new Date().getMilliseconds();
  tickTimeout = setTimeout(() => {
    tick();
    tickInterval = setInterval(tick, 1000);
  }, msToNextSecond);
}

function tick() {
  const now          = new Date();
  const localDateStr = now.toLocaleDateString('en-CA');
  clocksContainer.querySelectorAll('.clock-card').forEach(card => {
    const clock = activeClocks.find(c => c.id === card.dataset.id);
    if (clock) updateCard(card, clock, now, localDateStr);
  });
  updateFooterDate(now);
}

function updateCard(card, clock, now = new Date(), localDateStr = now.toLocaleDateString('en-CA')) {
  const timeEl    = card.querySelector('.clock-time');
  const dateEl    = card.querySelector('.clock-date');
  const dayDiffEl = card.querySelector('.day-diff');
  const offsetEl  = card.querySelector('.clock-offset');
  if (!timeEl) return;

  try {
    const { h12, minutes, seconds, ampm } = formatTime(clock.iana, now);
    if (format24h) {
      timeEl.innerHTML = `${h12}:${minutes}<span class="seconds">:${seconds}</span>`;
    } else {
      timeEl.innerHTML = `${h12}:${minutes}<span class="seconds">:${seconds}</span><span class="ampm">${ampm}</span>`;
    }

    if (dateEl)   dateEl.textContent   = formatDate(clock.iana, now);
    if (offsetEl) offsetEl.textContent = offsetLabel(clock.iana, now);

    if (dayDiffEl) {
      const diff = getDayDiff(clock.iana, now, localDateStr);
      if (diff === 1)       { dayDiffEl.textContent = '+1 Tomorrow';  dayDiffEl.className = 'day-diff tomorrow'; }
      else if (diff === -1) { dayDiffEl.textContent = '-1 Yesterday'; dayDiffEl.className = 'day-diff yesterday'; }
      else                  { dayDiffEl.textContent = '';             dayDiffEl.className = 'day-diff'; }
    }

    const bh = clock.businessHours ?? DEFAULT_BUSINESS_HOURS;
    card.dataset.workState = getWorkState(clock.iana, bh, now);
  } catch (_) {
    timeEl.textContent = '--:--';
  }
}

/* ── Time helpers ────────────────────────────────────────────── */
function formatTime(iana, now = new Date()) {
  if (format24h) {
    const timeStr = now.toLocaleTimeString('en-GB', {
      timeZone: iana, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const [h, m, s] = timeStr.split(':');
    return { h12: h, minutes: m, seconds: s, ampm: '' };
  }

  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: iana, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
  const match = timeStr.match(/^(\d{2}):(\d{2}):(\d{2})\s?(AM|PM)$/i);
  return {
    h12:     match ? match[1] : '--',
    minutes: match ? match[2] : '--',
    seconds: match ? match[3] : '--',
    ampm:    match ? match[4] : '',
  };
}

function formatDate(iana, now = new Date()) {
  return now.toLocaleDateString('en-GB', {
    timeZone: iana, weekday: 'short', day: 'numeric', month: 'short',
  });
}

function getDayDiff(iana, now, localDateStr = now.toLocaleDateString('en-CA')) {
  const remote = now.toLocaleDateString('en-CA', { timeZone: iana });
  if (remote > localDateStr) return 1;
  if (remote < localDateStr) return -1;
  return 0;
}

const _hourFormatters = new Map();
function getWorkState(iana, bh, now) {
  if (!_hourFormatters.has(iana)) {
    _hourFormatters.set(iana, new Intl.DateTimeFormat('en-US', { timeZone: iana, hour: 'numeric', hour12: false }));
  }
  const parts = _hourFormatters.get(iana).formatToParts(now);
  let hour = parseInt(parts.find(p => p.type === 'hour').value);
  if (hour === 24) hour = 0;

  const { start, end } = bh;
  if (hour >= start && hour < end)                                             return WORK_STATE.OPEN;
  if ((hour >= start - 1 && hour < start) || (hour >= end && hour < end + 1)) return WORK_STATE.BUFFER;
  return WORK_STATE.CLOSED;
}

const _offsetCache = new Map();
function offsetLabel(iana, now = new Date()) {
  const cached = _offsetCache.get(iana);
  if (cached && now.getTime() < cached.nextCheckMs) return cached.offset;
  try {
    const s = now.toLocaleTimeString('en', { timeZone: iana, timeZoneName: 'shortOffset' });
    const m = s.match(/GMT[+\-]\d+(:\d+)?|GMT/i);
    const offset = m ? m[0] : 'UTC';
    _offsetCache.set(iana, { offset, nextCheckMs: now.getTime() + 60_000 });
    return offset;
  } catch (_) { return ''; }
}

function updateFooterDate(now = new Date()) {
  footerDate.textContent = now.toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/* ── Toast ───────────────────────────────────────────────────── */
let toastTimeout = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('visible');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 1400);
}

/* ── Persistence ─────────────────────────────────────────────── */
function persist() {
  window.electronAPI?.storeSet('activeClocks', activeClocks);
}

/* ── Utils ───────────────────────────────────────────────────── */
function syncBtn24h() {
  btn24h.textContent = format24h ? '24H' : '12H';
  btn24h.classList.toggle('active', format24h);
}

function toHHMM(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

function makeSvg(cls, pathD, w = '24', h = '24') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.innerHTML = pathD;
  return svg;
}

/* ── Boot ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
