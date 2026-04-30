/* ── State ────────────────────────────────────────────────────── */
let activeClocks = []; // [{ id, iana, customLabel }]
let tickInterval = null;

/* ── DOM refs ─────────────────────────────────────────────────── */
const searchInput    = document.getElementById('tz-search');
const clearSearchBtn = document.getElementById('btn-clear-search');
const dropdown       = document.getElementById('tz-dropdown');
const tzList         = document.getElementById('tz-list');
const clocksContainer= document.getElementById('clocks-container');
const emptyState     = document.getElementById('empty-state');
const footerDate     = document.getElementById('footer-date');
const btnPin         = document.getElementById('btn-pin');
const btnMin         = document.getElementById('btn-min');
const btnClose       = document.getElementById('btn-close');

/* ── Init ─────────────────────────────────────────────────────── */
async function init() {
  // Restore persisted clocks
  if (window.electronAPI) {
    const saved = await window.electronAPI.storeGet('activeClocks');
    if (Array.isArray(saved) && saved.length) activeClocks = saved;
    const pinned = await window.electronAPI.storeGet('alwaysOnTop');
    if (pinned === false) btnPin.classList.remove('pin-active');
  }

  renderAllClocks();
  startTick();
  updateFooterDate();

  // Wire up window controls
  btnClose.addEventListener('click', () => window.electronAPI?.closeApp());
  btnMin.addEventListener('click',   () => window.electronAPI?.minimizeApp());
  btnPin.addEventListener('click', async () => {
    const now = await window.electronAPI?.toggleAlwaysOnTop();
    btnPin.classList.toggle('pin-active', now !== false);
  });

  // Search
  searchInput.addEventListener('input', handleSearch);
  searchInput.addEventListener('focus', () => {
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

function renderDropdown(results) {
  tzList.innerHTML = '';
  if (!results.length) {
    tzList.innerHTML = '<li style="cursor:default;opacity:0.4;padding:10px 14px;">No results</li>';
    return;
  }

  results.forEach(tz => {
    const alreadyAdded = activeClocks.some(c => c.iana === tz.iana);
    const li = document.createElement('li');
    if (alreadyAdded) li.classList.add('already-added');

    li.innerHTML = `
      <svg class="check-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      <span>${tz.label}</span>
      <span class="tz-badge">${offsetLabel(tz.iana)}</span>
    `;

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
function hideDropdown()  { dropdown.classList.add('hidden'); }
function clearSearch()   {
  searchInput.value = '';
  clearSearchBtn.classList.add('hidden');
  hideDropdown();
}

/* ── Clock management ────────────────────────────────────────── */
function addClock(iana, defaultLabel) {
  const id = `clock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  activeClocks.push({ id, iana, customLabel: defaultLabel });
  persist();
  renderAllClocks();
}

function removeClock(id) {
  activeClocks = activeClocks.filter(c => c.id !== id);
  persist();
  renderAllClocks();
}

function updateLabel(id, newLabel) {
  const clock = activeClocks.find(c => c.id === id);
  if (clock) { clock.customLabel = newLabel; persist(); }
}

/* ── Rendering ───────────────────────────────────────────────── */
function renderAllClocks() {
  // Remove existing cards (keep empty state node)
  clocksContainer.querySelectorAll('.clock-card').forEach(el => el.remove());

  emptyState.style.display = activeClocks.length ? 'none' : '';

  activeClocks.forEach(clock => {
    clocksContainer.appendChild(buildCard(clock));
  });
}

function buildCard(clock) {
  const card = document.createElement('div');
  card.className = 'clock-card';
  card.dataset.id = clock.id;

  card.innerHTML = `
    <div class="clock-header">
      <div class="clock-label-wrap">
        <input class="clock-label" type="text" value="${escapeAttr(clock.customLabel)}" title="Click to rename" spellcheck="false" />
        <svg class="edit-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      </div>
      <button class="btn-remove" title="Remove clock">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <div class="clock-time" data-iana="${clock.iana}"></div>
    <div class="clock-meta">
      <span class="clock-date" data-iana="${clock.iana}"></span>
      <span class="clock-offset">${offsetLabel(clock.iana)}</span>
    </div>
  `;

  // Label editing
  const labelInput = card.querySelector('.clock-label');
  labelInput.addEventListener('change', () => updateLabel(clock.id, labelInput.value.trim() || clock.iana));
  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { labelInput.blur(); }
    if (e.key === 'Escape') { labelInput.value = clock.customLabel; labelInput.blur(); }
  });

  // Remove button
  card.querySelector('.btn-remove').addEventListener('click', () => removeClock(clock.id));

  // Initial time fill
  updateCard(card, clock.iana);

  return card;
}

/* ── Tick / time update ──────────────────────────────────────── */
function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tick();
  tickInterval = setInterval(tick, 500);
}

function tick() {
  const now = new Date();

  // Update each card
  clocksContainer.querySelectorAll('.clock-card').forEach(card => {
    const iana = card.querySelector('.clock-time')?.dataset.iana;
    if (iana) updateCard(card, iana, now);
  });

  // Footer date
  updateFooterDate(now);
}

function updateCard(card, iana, now = new Date()) {
  const timeEl = card.querySelector('.clock-time');
  const dateEl = card.querySelector('.clock-date');
  if (!timeEl) return;

  try {
    const { h12, minutes, seconds, ampm, dateStr } = formatTime(iana, now);
    timeEl.innerHTML = `${h12}:${minutes}<span class="seconds">:${seconds}</span><span class="ampm">${ampm}</span>`;
    if (dateEl) dateEl.textContent = dateStr;
  } catch (_) {
    timeEl.textContent = '--:--';
  }
}

function formatTime(iana, now = new Date()) {
  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: iana,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  // e.g. "02:45:09 PM"
  const match = timeStr.match(/^(\d{2}):(\d{2}):(\d{2})\s?(AM|PM)$/i);
  const h12    = match ? match[1] : '--';
  const minutes= match ? match[2] : '--';
  const seconds= match ? match[3] : '--';
  const ampm   = match ? match[4] : '';

  const dateStr = now.toLocaleDateString('en-GB', {
    timeZone: iana,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return { h12, minutes, seconds, ampm, dateStr };
}

function offsetLabel(iana) {
  try {
    const now = new Date();
    const s = now.toLocaleTimeString('en', { timeZone: iana, timeZoneName: 'shortOffset' });
    const m = s.match(/GMT[+\-]\d+(:\d+)?|GMT/i);
    return m ? m[0] : 'UTC';
  } catch (_) { return ''; }
}

function updateFooterDate(now = new Date()) {
  footerDate.textContent = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/* ── Persistence ─────────────────────────────────────────────── */
function persist() {
  window.electronAPI?.storeSet('activeClocks', activeClocks);
}

/* ── Utils ───────────────────────────────────────────────────── */
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Boot ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
