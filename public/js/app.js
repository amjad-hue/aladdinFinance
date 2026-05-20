// ── State ────────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('af_token'),
  user: null,
  section: 'dashboard',
  banks: [], reserves: [], cashflow: [], budget: [], revenue: [], revenueByType: [],
  clients: [], events: [], tasks: [], files: [], sync: [],
  pipeline: [], statements: null, users: [], invitations: [],
  liabilities: [], ar: [], commissions: [], projects: [],
  appSettings: { ceoEmail:'', cpoEmail:'', reportRecipients:[], reportSchedule:'manual', pipelineStaleAfterDays:14 },
  commSettings: { rates:{ Enterprise:5, Government:4, Tradeshow:3, Default:4 }, targets:{} },
  selectedClientId: null, calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
  fiscalYear: 2026,
  showDone: false, fileFilter: 'all', cfTab: 'cf-charts', pfTab: 'pf-charts',
  pfForecast: {},
  charts: {}, cfYear: 2026,
  budgetExpanded: new Set(), budgetTab: 'bud-charts',
  liabExpanded: new Set(),
  _pages: {},  // per-table pagination: { ar: 0, pipeline: 0, commissions: 0 }
  _arFilter: { status: '', q: '' },
  _healthIssuesOnly: false,
  // HR
  hrEmployees: [], hrTimeOff: [], hrSettings: { departments:[], positions:[], leaveTypes:[] },
  hrTab: 'directory', hrEmpTab: 'personal', _hrEmpSearch: '', _hrEmpDept: '',
  // Subscriptions
  subscriptions: [], subSettings: { reminderDays:[7,30,60], recipients:[] },
  subKpis: null, subTab: 'overview', _subEditId: null,
  // Filter state
  _pipeFilter: { stage:'', owner:'', q:'', sortBy:'', sortDir:'asc' },
  projTab: 'active', _projSearch: '',
  _tofFilter: { emp:'', type:'', status:'' },
  _taskFilter: { priority:'', sort:'default' },
  _reqFilter: { priority:'', q:'', status:'' },
  _evtFilter: { type:'' },
  _hrEmpStatus: '', _hrEmpType: ''
};
const TODAY = new Date();
const PAGE_SIZE = 30;
function _page(key) { return state._pages[key] || 0; }
function _setPage(key, p) { state._pages[key] = p; render(); }
function _paginate(arr, key) {
  const p = _page(key), total = arr.length, pages = Math.ceil(total / PAGE_SIZE);
  const slice = arr.slice(p * PAGE_SIZE, (p+1) * PAGE_SIZE);
  const ctrl = total <= PAGE_SIZE ? '' : `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-top:1px solid var(--border);background:var(--surface-2);font-size:11px;color:var(--text-2)">
      <span>${p*PAGE_SIZE+1}–${Math.min((p+1)*PAGE_SIZE,total)} of <strong>${total}</strong> records</span>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" style="font-size:10px;padding:2px 9px" ${p===0?'disabled':''} onclick="_setPage('${key}',${p-1})">← Prev</button>
        <span style="padding:2px 8px;font-weight:600;color:var(--text)">${p+1} / ${pages}</span>
        <button class="btn btn-sm" style="font-size:10px;padding:2px 9px" ${p>=pages-1?'disabled':''} onclick="_setPage('${key}',${p+1})">Next →</button>
      </div>
    </div>`;
  return { slice, ctrl };
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const fmt  = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
const _yq  = () => state.fiscalYear !== 2026 ? `?year=${state.fiscalYear}` : '';
const fmtK = v => (v<0?'-':'')+'$'+Math.round(Math.abs(v)/1000)+'k';
const tip  = (label, text) => `${label}<span class="minfo"><i class="minfo-icon">ⓘ</i><span class="minfo-tip">${text}</span></span>`;
const daysTo = d => Math.ceil((new Date(d+'T00:00:00')-TODAY)/864e5);
const fmtDate = d => { const x=new Date(d+'T00:00:00'); return x.getDate()+' '+MONTHS[x.getMonth()].slice(0,3); };
const quarter = () => { const m = TODAY.getMonth(); return 'Q'+(Math.floor(m/3)+1)+' '+TODAY.getFullYear(); };

// ── Editable list options (persisted in localStorage) ────────────────────────
const _LIST_CFG = {};
function _getListExtras(key) {
  try { return JSON.parse(localStorage.getItem('lo_'+key)) || []; } catch { return []; }
}
function _addListExtra(key, val) {
  const extras = _getListExtras(key);
  if (!extras.includes(val)) { extras.push(val); localStorage.setItem('lo_'+key, JSON.stringify(extras)); }
}
function initEditableLists() {
  for (const [id, cfg] of Object.entries(_LIST_CFG)) {
    const dl = document.getElementById('dl-'+id);
    if (!dl) continue;
    _getListExtras(cfg.key).forEach(opt => {
      if (!Array.from(dl.options).some(o => o.value === opt)) {
        const o = document.createElement('option'); o.value = opt; dl.appendChild(o);
      }
    });
  }
}
function saveNewListOpts(...inputIds) {
  inputIds.forEach(id => {
    const cfg = _LIST_CFG[id]; if (!cfg) return;
    const val = (document.getElementById(id)?.value || '').trim();
    if (!val || cfg.defaults.includes(val) || _getListExtras(cfg.key).includes(val)) return;
    _addListExtra(cfg.key, val);
    const dl = document.getElementById('dl-'+id);
    if (dl) { const o = document.createElement('option'); o.value = val; dl.appendChild(o); }
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function authHeaders() {
  return { 'Content-Type':'application/json', 'Authorization':'Bearer '+(state.token||'') };
}

async function apiCall(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: authHeaders(), ...opts });
  if (res.status === 401) { logout(); return null; }
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || 'API error'); }
  return res.json();
}

function togglePw(id, btn) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/><line x1="2" y1="2" x2="14" y2="14"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
}

function updateStrength(input, strengthId) {
  const pw = input.value;
  const el = document.getElementById(strengthId);
  if (!el) return;
  el.style.display = pw.length ? 'block' : 'none';
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { label:'Too short', color:'#DC2626', pct:10 },
    { label:'Weak', color:'#DC2626', pct:25 },
    { label:'Fair', color:'#D97706', pct:50 },
    { label:'Good', color:'#16A34A', pct:75 },
    { label:'Strong', color:'#16A34A', pct:90 },
    { label:'Very strong', color:'#16A34A', pct:100 },
  ];
  const lv = levels[Math.min(score, 5)];
  const fill = el.querySelector('.pw-strength-fill');
  const lbl  = el.querySelector('.pw-strength-label');
  if (fill) { fill.style.width = lv.pct + '%'; fill.style.background = lv.color; }
  if (lbl)  { lbl.textContent = lv.label; lbl.style.color = lv.color; }
}

function showForgotForm() {
  ['login-form','register-form','reset-form'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
  const ff = document.getElementById('forgot-form');
  if (ff) ff.style.display = 'block';
  const fe = document.getElementById('fp-email');
  if (fe) fe.focus();
}

async function doForgotPassword() {
  const email = (document.getElementById('fp-email')?.value || '').trim();
  const err = document.getElementById('fp-err');
  const ok  = document.getElementById('fp-ok');
  err.classList.remove('show'); ok.classList.remove('show');
  if (!email) { err.textContent = 'Please enter your email address'; err.classList.add('show'); return; }
  try {
    await fetch('/api/auth/forgot-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
    ok.textContent = 'If that email exists, a reset link has been sent. Check your inbox.';
    ok.classList.add('show');
    document.getElementById('fp-email').value = '';
  } catch(e) { err.textContent = 'Connection error'; err.classList.add('show'); }
}

async function doResetPassword() {
  const pass    = document.getElementById('rp-pass')?.value || '';
  const confirm = document.getElementById('rp-confirm')?.value || '';
  const token   = new URLSearchParams(location.search).get('reset');
  const err = document.getElementById('rp-err');
  const ok  = document.getElementById('rp-ok');
  err.classList.remove('show'); ok.classList.remove('show');
  if (!pass) { err.textContent = 'Please enter a new password'; err.classList.add('show'); return; }
  if (pass.length < 8) { err.textContent = 'Password must be at least 8 characters'; err.classList.add('show'); return; }
  if (pass !== confirm) { err.textContent = 'Passwords do not match'; err.classList.add('show'); return; }
  try {
    const r = await fetch('/api/auth/reset-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token, password: pass }) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Reset failed'; err.classList.add('show'); return; }
    ok.textContent = 'Password updated! Redirecting to sign in…';
    ok.classList.add('show');
    setTimeout(() => { history.replaceState(null,'','/'); showLoginForm(); }, 2000);
  } catch(e) { err.textContent = 'Connection error'; err.classList.add('show'); }
}

async function doLogin() {
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  const err   = document.getElementById('login-err');
  err.classList.remove('show');
  if (!email || !pass) { err.textContent='Please enter email and password'; err.classList.add('show'); return; }
  try {
    const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email, password: pass}) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error||'Login failed'; err.classList.add('show'); return; }
    state.token = d.token; state.user = d.user;
    localStorage.setItem('af_token', d.token);
    saveDismissed([]);
    showApp();
  } catch(e) { err.textContent='Connection error'; err.classList.add('show'); }
}

async function doRegister() {
  const name = document.getElementById('r-name').value.trim();
  const pass  = document.getElementById('r-pass').value;
  const token = new URLSearchParams(location.search).get('token');
  const err   = document.getElementById('reg-err');
  err.classList.remove('show');
  if (!name || !pass) { err.textContent='Please fill all fields'; err.classList.add('show'); return; }
  if (name.length < 2) { err.textContent='Name must be at least 2 characters'; err.classList.add('show'); return; }
  if (pass.length < 8) { err.textContent='Password must be at least 8 characters'; err.classList.add('show'); return; }
  if (!/[A-Z]/.test(pass)) { err.textContent='Password must contain at least one uppercase letter'; err.classList.add('show'); return; }
  if (!/[0-9]/.test(pass)) { err.textContent='Password must contain at least one number'; err.classList.add('show'); return; }
  try {
    const r = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({token, name, password: pass}) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error||'Registration failed'; err.classList.add('show'); return; }
    state.token = d.token; state.user = d.user;
    localStorage.setItem('af_token', d.token);
    history.replaceState(null,'','/');
    saveDismissed([]);
    showApp();
  } catch(e) { err.textContent='Connection error'; err.classList.add('show'); }
}

async function checkInviteToken() {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) return false;
  try {
    const r = await fetch(`/api/auth/invite/${token}`);
    if (!r.ok) return false;
    const d = await r.json();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('r-email').value = d.email;
    if (d.name) document.getElementById('r-name').value = d.name;
    document.getElementById('reg-link').innerHTML = '<a onclick="showLoginForm()">Back to sign in</a>';
    return true;
  } catch { return false; }
}

function showLoginForm() {
  document.getElementById('login-form').style.display = 'block';
  ['register-form','forgot-form','reset-form'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
  const rl = document.getElementById('reg-link'); if (rl) rl.innerHTML = '';
}

function logout() {
  state.token = null; state.user = null;
  state.section = 'dashboard';
  localStorage.removeItem('af_token');
  document.getElementById('app-screen').classList.remove('visible');
  document.getElementById('login-screen').classList.remove('hidden');
}

function toggleNavGroup(id) {
  const items = document.getElementById('ng-'+id);
  if (!items) return;
  const hdr = items.previousElementSibling;
  const isNowCollapsed = items.classList.toggle('collapsed');
  if (hdr) hdr.classList.toggle('collapsed', isNowCollapsed);
  const s = JSON.parse(localStorage.getItem('navCollapsed')||'{}');
  s[id] = isNowCollapsed;
  localStorage.setItem('navCollapsed', JSON.stringify(s));
}

function initNavGroups() {
  const s = JSON.parse(localStorage.getItem('navCollapsed')||'{}');
  Object.entries(s).forEach(([id, collapsed]) => {
    if (!collapsed) return;
    const items = document.getElementById('ng-'+id);
    const hdr = items?.previousElementSibling;
    if (items) items.classList.add('collapsed');
    if (hdr) hdr.classList.add('collapsed');
  });
}

async function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.add('visible');
  document.getElementById('quarter-badge').textContent = quarter();
  updateUserUI();
  initEditableLists();
  initNavGroups();
  // Restore sidebar collapsed state
  if (localStorage.getItem('sidebarCollapsed') === '1') {
    const sb = document.getElementById('main-sidebar');
    const btn = document.getElementById('sidebar-toggle');
    if (sb) sb.classList.add('collapsed');
    if (btn) btn.textContent = '›';
  }
  setupInactivityTimer();
  await loadAll();
  if (state.user?.role === 'sales') {
    state.section = 'pipeline';
  } else {
    const saved = localStorage.getItem('af_section');
    if (saved && saved !== 'undefined') state.section = saved;
  }
  updateBreadcrumb(state.section);
  render();
  const mc = document.getElementById('main-content');
  if (mc) {
    void mc.offsetWidth;
    mc.classList.add('section-enter', 'anim-cards');
    setTimeout(() => mc.classList.remove('anim-cards'), 700);
    if (window.LottieUI) { LottieUI.animateMetrics(mc); LottieUI.animateTitles(mc); }
  }
  setTimeout(triggerProactiveAI, 3000);
}

function updateUserUI() {
  if (!state.user) return;
  const init = state.user.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('ua-init').textContent = init;
  document.getElementById('ua-name').textContent = state.user.name;
  const titleOrRole = state.user.title || (state.user.role.charAt(0).toUpperCase()+state.user.role.slice(1));
  document.getElementById('ua-role').textContent = titleOrRole;
  applyRoleNav();
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadAll() {
  if (window.LottieUI) LottieUI.showLoading('Loading your data…');
  try {
    const fy = state.fiscalYear;
    const yq = fy !== 2026 ? `?year=${fy}` : '';
    const [banks,reserves,cashflow,budget,prevBudget,revenue,revenueByType,clients,events,tasks,files,sync,pipeline,liabilities,ar,commissions,projects,appSettings,commSettings,requests,requestCfg,pfForecast,_linked,_userPrefs,hrEmployees,hrTimeOff,hrSettings,subscriptions,subSettings] = await Promise.all([
      apiCall('/cash'), apiCall('/reserves'), apiCall(`/cashflow${yq}`), apiCall(`/budget${yq}`),
      apiCall(`/budget?year=${fy-1}`).catch(()=>[]),
      apiCall(`/revenue${yq}`), apiCall(`/revenue/by-type${yq}`), apiCall('/clients'), apiCall('/events'), apiCall('/tasks'),
      apiCall('/files'), apiCall('/sync/status'), apiCall('/pipeline'),
      apiCall('/liabilities'), apiCall('/ar'), apiCall('/commissions'), apiCall('/projects'),
      apiCall('/app-settings'), apiCall('/commissions/settings'),
      apiCall('/requests'), apiCall('/requests/config'),
      apiCall('/pipeline/forecast-cashflow'),
      apiCall('/linked').catch(() => null),
      apiCall('/users/me/prefs').catch(() => ({})),
      apiCall('/hr').catch(()=>[]),
      apiCall('/hr/time-off').catch(()=>[]),
      apiCall('/hr/settings').catch(()=>({departments:[],positions:[],leaveTypes:[]})),
      apiCall('/subscriptions').catch(()=>[]),
      apiCall('/subscriptions/settings').catch(()=>({reminderDays:[7,30,60],recipients:[]}))
    ]);
    Object.assign(state, {banks,reserves,cashflow,budget,prevBudget,revenue,revenueByType,clients,events,tasks,files,sync,pipeline,liabilities,ar,commissions,projects,appSettings,commSettings,requests,requestCfg,pfForecast,_linked,_userPrefs,hrEmployees,hrTimeOff,hrSettings,subscriptions,subSettings});
    // Sync server-side dashboard prefs to localStorage for seamless offline access
    if (_userPrefs?.dashHidden) localStorage.setItem('dashHidden', JSON.stringify(_userPrefs.dashHidden));
    if (_userPrefs?.dashOrder) localStorage.setItem('dashOrder', JSON.stringify(_userPrefs.dashOrder));
    setSyncStatus('Connected');
    recalcCashflow();
    _autoMarkOverdue();
    buildNotifications();
    updateHealthPill();
    apiCall('/reports/email-log').then(log => { state._emailLog = log; }).catch(()=>{});
    apiCall('/reports/validate/history').then(h => { state._validationHistory = h; }).catch(()=>{});
    apiCall('/reports/email-templates').then(t => { state._emailTemplates = t; }).catch(()=>{});
  } catch(e) { setSyncStatus('Connection error', true); }
  finally { if (window.LottieUI) LottieUI.hideLoading(); }
}

function setSyncStatus(msg, err=false) {
  const dot=document.getElementById('sync-dot'), lbl=document.getElementById('sync-label');
  if (!dot||!lbl) return;
  lbl.textContent=msg; dot.style.background=err?'var(--danger)':'var(--success)'; dot.classList.remove('spin');
}

function recalcCashflow() {
  let prev = state.cashflow[0]?.opening || 0;
  state.cashflow.forEach((r,i) => { if(i>0) r.opening=prev; prev=r.opening+r.inflow-r.outflow; });
}

function _autoMarkOverdue() {
  const todayStr = TODAY.toISOString().split('T')[0];
  const toUpdate = state.ar.filter(x => (x.status === 'pending' || x.status === 'sent') && x.dueDate && x.dueDate < todayStr);
  if (!toUpdate.length) return;
  toUpdate.forEach(x => { x.status = 'overdue'; });
  Promise.all(toUpdate.map(x => apiCall(`/ar/${x.id}`, { method: 'PUT', body: JSON.stringify({ status: 'overdue' }) })))
    .catch(() => {});
}

// ── Toast / Modal ─────────────────────────────────────────────────────────────
function toast(msg, type) {
  const t    = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const msgEl= document.getElementById('toast-msg');
  if (!t) return;
  clearTimeout(t._hideTimer);
  // resolve type from message keywords when not explicit
  if (!type) {
    const lo = msg.toLowerCase();
    if (/error|fail|invalid|required|cannot|not found|denied|unauthorized/.test(lo)) type = 'error';
    else if (/saved|added|updated|imported|created|success|done|removed|renamed|cleared|synced|pushed/.test(lo)) type = 'success';
    else if (/warning|stale|overd|missing|no .* found/.test(lo)) type = 'warning';
    else type = 'info';
  }
  t.className = 'toast show toast--' + type;
  if (msgEl) msgEl.textContent = msg;
  else t.textContent = msg;
  if (icon && window.LottieUI) LottieUI.playToastIcon(icon, type);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
function openModal(id) {
  const m = document.getElementById(id);
  m.classList.add('open');
  setTimeout(() => { initCustomSelects(m); initDatePickers(m); }, 0);
}
function closeModal(id) {
  if (_cselOpen) _cselOpen.close();
  document.getElementById(id).classList.remove('open');
}

// ── Editable Select helpers (legacy no-ops — superseded by CustomSelect "Add new") ─
function handleSelectOther(sel) {
  // CustomSelect intercepts __other__ — reset if somehow triggered natively
  if (sel.value === '__other__') sel.selectedIndex = 0;
}
function confirmOtherOption() {}
function cancelOtherOption() {}
// Safely set a <select> value, adding the option first if it's not in the list
function setSelectValue(sel, val) {
  if (val == null || val === '') return;
  if (![...sel.options].find(o => o.value === val)) {
    sel.insertBefore(new Option(val, val), sel.querySelector('option[value="__other__"]') || null);
  }
  sel.value = val;
  sel._customSelect?.refresh();
}

// ── Custom Select Component ────────────────────────────────────────────────────
const CSEL_DOTS = {
  pending:'#F97316', overdue:'#EF4444', paid:'#22C55E', approved:'#22C55E',
  partial:'#F59E0B', 'partial payment':'#F59E0B', rejected:'#EF4444',
  active:'#3B82F6', completed:'#22C55E', cancelled:'#EF4444', 'on hold':'#F59E0B',
  preparing:'#94A3B8', 'under process':'#6366F1', 'pending approval':'#F97316',
  high:'#EF4444', medium:'#F59E0B', low:'#22C55E',
  'closed won':'#22C55E', 'closed lost':'#EF4444',
  negotiation:'#FF6600', proposal:'#D97706', qualification:'#7C3AED', prospecting:'#94A3B8',
  enterprise:'#2563EB', government:'#7C3AED', tradeshow:'#D97706',
  admin:'#7C3AED', cfo:'#2563EB', finance:'#16A34A', sales:'#FF6600', viewer:'#94A3B8',
};

let _cselOpen = null;

class CustomSelect {
  constructor(sel) {
    this.sel = sel;
    this.wrap = null;
    this.trigger = null;
    this.panel = null;
    this._fi = -1; // focused option index
    this._build();
  }

  _opts() { return [...this.sel.options].filter(o => o.value !== '__other__' && o.value !== ''); }
  _dot(v) { const c = v ? CSEL_DOTS[v.toLowerCase()] : null; return c ? `<span class="csel-sdot" style="background:${c}"></span>` : ''; }
  _label(v) { return [...this.sel.options].find(o => o.value === v)?.text || v; }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'csel-wrap';
    this.sel.parentNode.insertBefore(wrap, this.sel);
    wrap.appendChild(this.sel);
    this.sel.style.cssText = 'display:none!important';
    this.wrap = wrap;

    const trig = document.createElement('div');
    trig.className = 'csel-trigger';
    trig.tabIndex = 0;
    trig.setAttribute('role', 'combobox');
    trig.innerHTML = '<div class="csel-val"></div><span class="csel-arrow">▼</span>';
    wrap.insertBefore(trig, this.sel);
    this.trigger = trig;
    this.refresh();

    trig.addEventListener('click', () => this.panel ? this.close() : this.open());
    trig.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); if (!this.panel) this.open(); }
      if (e.key === 'Escape') this.close();
    });
  }

  refresh() {
    const v = this.sel.value;
    const valid = v && v !== '__other__';
    const label = valid ? this._label(v) : (this.sel.querySelector('option[value=""]')?.text || 'Select…');
    this.trigger.querySelector('.csel-val').innerHTML = valid
      ? `${this._dot(v)}<span>${label}</span>`
      : `<span class="csel-placeholder">${label}</span>`;
  }

  open() {
    if (_cselOpen && _cselOpen !== this) _cselOpen.close();
    _cselOpen = this;
    this.trigger.classList.add('open');

    const p = document.createElement('div');
    p.className = 'csel-panel';
    p.innerHTML = `
      <div class="csel-search-wrap"><input class="csel-search" type="text" placeholder="Search…" autocomplete="off"></div>
      <div class="csel-options"></div>
      <div class="csel-footer">
        <div class="csel-addbtn">➕ Add new option</div>
        <div class="csel-addrow">
          <input class="csel-addinp" type="text" placeholder="Type new option…" autocomplete="off">
          <button class="btn btn-primary btn-sm" data-csel-ok>Add</button>
          <button class="btn btn-sm" data-csel-cx>✕</button>
        </div>
      </div>`;
    document.body.appendChild(p);
    this.panel = p;
    this._pos();
    this._renderOpts('');

    const search = p.querySelector('.csel-search');
    search.focus();
    search.addEventListener('input', () => this._renderOpts(search.value));
    search.addEventListener('keydown', e => this._key(e));

    const addbtn  = p.querySelector('.csel-addbtn');
    const addrow  = p.querySelector('.csel-addrow');
    const addinp  = p.querySelector('.csel-addinp');
    const addok   = p.querySelector('[data-csel-ok]');
    const addcx   = p.querySelector('[data-csel-cx]');

    const showAdd = () => { addbtn.style.display='none'; addrow.classList.add('on'); addinp.focus(); };
    const hideAdd = () => { addbtn.style.display=''; addrow.classList.remove('on'); addinp.value=''; };
    const doAdd   = () => { const v=addinp.value.trim(); if(v) this._addOpt(v); hideAdd(); };

    addbtn.addEventListener('mousedown', e => { e.preventDefault(); showAdd(); });
    addok.addEventListener('mousedown',  e => { e.preventDefault(); doAdd(); });
    addcx.addEventListener('mousedown',  e => { e.preventDefault(); hideAdd(); });
    addinp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); doAdd(); }
      if (e.key === 'Escape') { e.preventDefault(); hideAdd(); }
    });
  }

  _pos() {
    if (!this.panel) return;
    const r = this.trigger.getBoundingClientRect();
    const p = this.panel;
    const w = Math.max(r.width, 200);
    const spB = window.innerHeight - r.bottom - 8;
    const spA = r.top - 8;
    p.style.width  = w + 'px';
    p.style.left   = Math.min(r.left, window.innerWidth - w - 8) + 'px';
    const useDown  = spB >= 180 || spB >= spA;
    if (useDown) { p.style.top = (r.bottom + 4) + 'px'; p.style.bottom = ''; }
    else         { p.style.bottom = (window.innerHeight - r.top + 4) + 'px'; p.style.top = ''; }
    p.querySelector('.csel-options').style.maxHeight = (Math.min(220, useDown ? spB : spA) - 90) + 'px';
  }

  _renderOpts(q) {
    const opts = this._opts();
    const cur  = this.sel.value;
    const fq   = q.toLowerCase();
    const vis  = fq ? opts.filter(o => o.text.toLowerCase().includes(fq) || o.value.toLowerCase().includes(fq)) : opts;
    const box  = this.panel.querySelector('.csel-options');
    if (!vis.length) { box.innerHTML = `<div class="csel-no-opts">${fq ? 'No results' : 'No options'}</div>`; this._fi=-1; return; }
    box.innerHTML = vis.map((o, i) => {
      const sel = o.value === cur;
      return `<div class="csel-opt${sel?' csel-selected':''}${i===this._fi?' csel-focused':''}" data-v="${o.value}">
        ${this._dot(o.value)}<span class="csel-opt-lbl">${o.text}</span>
        ${sel ? '<span class="csel-opt-chk">✓</span>' : ''}
      </div>`;
    }).join('');
    this._fi = vis.findIndex(o => o.value === cur);
    box.querySelectorAll('.csel-opt').forEach(el => el.addEventListener('mousedown', e => { e.preventDefault(); this._pick(el.dataset.v); }));
  }

  _key(e) {
    const els = this.panel?.querySelectorAll('.csel-opt') || [];
    if      (e.key === 'ArrowDown') { e.preventDefault(); this._fi = Math.min(this._fi+1, els.length-1); this._hiFocus(els); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); this._fi = Math.max(this._fi-1, 0);            this._hiFocus(els); }
    else if (e.key === 'Enter')     { e.preventDefault(); const el=els[this._fi]; if(el) this._pick(el.dataset.v); }
    else if (e.key === 'Escape')    { e.preventDefault(); this.close(); }
  }

  _hiFocus(els) {
    els.forEach((el,i) => el.classList.toggle('csel-focused', i === this._fi));
    els[this._fi]?.scrollIntoView({ block:'nearest' });
  }

  _addOpt(val) {
    if ([...this.sel.options].find(o => o.value === val)) { this._pick(val); return; }
    const before = this.sel.querySelector('option[value="__other__"]');
    before ? this.sel.insertBefore(new Option(val,val), before) : this.sel.appendChild(new Option(val,val));
    this._pick(val);
  }

  _pick(val) {
    this.sel.value = val;
    this.sel.dispatchEvent(new Event('change', { bubbles:true }));
    this.refresh();
    this.close();
  }

  close() {
    this.panel?.remove();
    this.panel = null;
    this.trigger?.classList.remove('open');
    if (_cselOpen === this) _cselOpen = null;
  }

  destroy() {
    this.close();
    this.sel.style.cssText = '';
    if (this.wrap?.parentNode) { this.wrap.parentNode.insertBefore(this.sel, this.wrap); this.wrap.remove(); }
    delete this.sel._customSelect;
  }
}

function initCustomSelects(container) {
  (container || document).querySelectorAll('select:not([data-no-custom])').forEach(sel => {
    if (sel._customSelect || sel.closest('.csel-wrap')) return;
    sel._customSelect = new CustomSelect(sel);
  });
}

// ── Luxury Date Picker ────────────────────────────────────────────────────────
class LuxDatePicker {
  constructor(inp) {
    this.inp = inp;
    this.panel = null;
    this.current = null;
    this._onOutside = null;
    this._build();
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'ldp-wrap';
    this.inp.parentNode.insertBefore(wrap, this.inp);
    wrap.appendChild(this.inp);
    this.inp.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0';

    const disp = document.createElement('div');
    disp.className = 'ldp-display ldp-empty';
    disp.tabIndex = 0;
    disp.setAttribute('role', 'button');
    disp.innerHTML = '<span class="ldp-display-text">Select date</span>';
    wrap.insertBefore(disp, this.inp);
    this.disp = disp;

    // Intercept programmatic .value = ... assignments
    const ldp = this;
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(this.inp, 'value', {
      get() { return proto.get.call(this); },
      set(v) { proto.set.call(this, v); ldp._refresh(); },
      configurable: true
    });

    this._refresh();

    disp.addEventListener('click', e => { e.stopPropagation(); this.panel ? this.close() : this.open(); });
    disp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.open(); }
      if (e.key === 'Escape') this.close();
    });
  }

  _refresh() {
    const v = this.inp.value;
    const txt = this.disp.querySelector('.ldp-display-text');
    if (v) {
      const d = new Date(v + 'T00:00:00');
      if (txt) txt.textContent = d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
      this.disp.classList.remove('ldp-empty');
    } else {
      if (txt) txt.textContent = this.inp.placeholder || 'Select date';
      this.disp.classList.add('ldp-empty');
    }
  }

  open() {
    if (LuxDatePicker._open && LuxDatePicker._open !== this) LuxDatePicker._open.close();
    LuxDatePicker._open = this;
    const v = this.inp.value;
    this.current = v ? new Date(v + 'T00:00:00') : new Date();
    this.current = new Date(this.current.getFullYear(), this.current.getMonth(), 1);
    const p = document.createElement('div');
    p.className = 'ldp-panel';
    document.body.appendChild(p);
    this.panel = p;
    this.disp.classList.add('ldp-open');
    this._renderPanel();
    this._pos();
    setTimeout(() => {
      document.addEventListener('click', this._onOutside = e => {
        if (!p.contains(e.target) && !this.disp.contains(e.target)) this.close();
      });
    }, 0);
  }

  _renderPanel() {
    const p = this.panel; if (!p) return;
    const selVal = this.inp.value;
    const today = new Date(); today.setHours(0,0,0,0);
    const yr = this.current.getFullYear(), mo = this.current.getMonth();
    const monthName = this.current.toLocaleString('en-US', { month:'long' });
    const startDow = new Date(yr, mo, 1).getDay();
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < startDow; i++) days.push({ d: new Date(yr, mo, i - startDow + 1), cur: false });
    for (let i = 1; i <= daysInMonth; i++) days.push({ d: new Date(yr, mo, i), cur: true });
    while (days.length % 7 !== 0) days.push({ d: new Date(days[days.length-1].d.getTime() + 86400000), cur: false });
    p.innerHTML = `
      <div class="ldp-header">
        <button class="ldp-nav" data-dir="-1">&#8249;</button>
        <div class="ldp-month">${monthName} ${yr}</div>
        <button class="ldp-nav" data-dir="1">&#8250;</button>
      </div>
      <div class="ldp-grid">
        ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div class="ldp-dow">${d}</div>`).join('')}
        ${days.map(({d,cur})=>{
          const pad=n=>String(n).padStart(2,'0');
          const iso=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
          const isT=d.getTime()===today.getTime(), isSel=iso===selVal;
          return `<div class="ldp-day${cur?'':' ldp-other'}${isT?' ldp-today':''}${isSel?' ldp-sel':''}" data-date="${iso}">${d.getDate()}</div>`;
        }).join('')}
      </div>
      <div class="ldp-footer">
        <button class="ldp-clear">Clear</button>
        <button class="ldp-today-btn">Today</button>
      </div>`;
    p.querySelectorAll('.ldp-nav').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      this.current = new Date(this.current.getFullYear(), this.current.getMonth() + Number(btn.dataset.dir), 1);
      this._renderPanel();
    }));
    p.querySelectorAll('.ldp-day').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); this._pick(el.dataset.date); }));
    p.querySelector('.ldp-clear').addEventListener('click', e => { e.stopPropagation(); this._pick(''); });
    p.querySelector('.ldp-today-btn').addEventListener('click', e => { e.stopPropagation(); const pad=n=>String(n).padStart(2,'0'); this._pick(`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`); });
  }

  _pick(val) {
    this.inp.value = val;
    this.inp.dispatchEvent(new Event('change', { bubbles:true }));
    this.inp.dispatchEvent(new Event('input', { bubbles:true }));
    this._refresh();
    this.close();
  }

  _pos() {
    const r = this.disp.getBoundingClientRect();
    const p = this.panel; if (!p) return;
    p.style.minWidth = Math.max(r.width, 244) + 'px';
    const spB = window.innerHeight - r.bottom - 8, spA = r.top - 8;
    p.style.left = Math.min(r.left, window.innerWidth - 260 - 8) + 'px';
    if (spB >= 260 || spB >= spA) { p.style.top = (r.bottom + 4) + 'px'; p.style.bottom = ''; }
    else { p.style.bottom = (window.innerHeight - r.top + 4) + 'px'; p.style.top = ''; }
  }

  close() {
    this.panel?.remove(); this.panel = null;
    this.disp?.classList.remove('ldp-open');
    if (this._onOutside) { document.removeEventListener('click', this._onOutside); this._onOutside = null; }
    if (LuxDatePicker._open === this) LuxDatePicker._open = null;
  }
}
LuxDatePicker._open = null;

function initDatePickers(container) {
  (container || document).querySelectorAll('input[type="date"]:not([data-no-ldp]):not([data-ldp])').forEach(inp => {
    if (inp.closest('.ldp-wrap')) return;
    inp.dataset.ldp = '1';
    inp._ldp = new LuxDatePicker(inp);
  });
}

function showConfirm(message, onConfirm, opts={}) {
  const el = document.getElementById('modal-confirm');
  if (!el) { if(confirm(message)) onConfirm(); return; }
  document.getElementById('confirm-msg').textContent = message;
  document.getElementById('confirm-ok-btn').textContent = opts.okLabel || 'Delete';
  document.getElementById('confirm-ok-btn').className = 'btn ' + (opts.okClass || 'btn-danger');
  window._confirmCallback = onConfirm;
  el.classList.add('open');
  const lottieEl = document.getElementById('confirm-lottie');
  if (lottieEl && window.LottieUI) LottieUI.playConfirmWarning(lottieEl);
}
/* Renders an animated empty state. Call inside innerHTML assignments.
   Uses rAF to init the Lottie animation once the element is in the DOM. */
function emptyState(title, sub) {
  const id = 'es-' + (Math.random() * 1e9 | 0);
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el && window.LottieUI) LottieUI.load(el, 'empty', { loop: true, autoplay: true });
  });
  return `<div class="empty-state">
    <div class="es-lottie" id="${id}" data-anim="empty"></div>
    <div class="empty-state-title">${title}</div>
    ${sub ? `<div class="empty-state-sub">${sub}</div>` : ''}
  </div>`;
}

function showPrompt(title, defaultVal, onOk, opts={}) {
  const el = document.getElementById('modal-prompt');
  if (!el) { const v = prompt(title, defaultVal); if (v !== null) onOk(v); return; }
  document.getElementById('prompt-title').textContent = title;
  const inp = document.getElementById('prompt-input');
  inp.value = defaultVal || '';
  inp.placeholder = opts.placeholder || '';
  document.getElementById('prompt-ok-btn').textContent = opts.okLabel || 'OK';
  window._promptResolve = (val) => { if (val !== null) onOk(val); };
  window._promptReject  = () => {};
  el.classList.add('open');
  setTimeout(() => { inp.focus(); inp.select(); }, 80);
}
function doConfirmOk() {
  closeModal('modal-confirm');
  if (window._confirmCallback) { window._confirmCallback(); delete window._confirmCallback; }
}

function previewEmail(endpoint) {
  const w = window.open('about:blank', 'email_preview', 'width=760,height=700,left=100,top=80');
  if (!w) { toast('Allow popups to preview emails'); return; }
  fetch('/api' + endpoint, { headers: authHeaders() })
    .then(r => r.text())
    .then(html => { w.document.write(html); w.document.close(); })
    .catch(() => toast('Preview failed — check server'));
}

// ── Navigation ────────────────────────────────────────────────────────────────
const PIPELINE_ROLE_SECTIONS = ['pipeline','settings'];
const FINANCE_ROLE_SECTIONS  = ['dashboard','cash','cashflow','liabilities','ar','budget','revenue','statements','commissions','reports','settings'];

// Breadcrumb map: section → { group, label }
const SECTION_META = {
  dashboard:     { group:'Financials',  label:'Dashboard' },
  cash:          { group:'Financials',  label:'Cash & Reserves' },
  cashflow:      { group:'Financials',  label:'Cash Flow' },
  budget:        { group:'Financials',  label:'Budget' },
  revenue:       { group:'Financials',  label:'Revenue' },
  ar:            { group:'Financials',  label:'Account Receivables' },
  liabilities:   { group:'Financials',  label:'Liabilities' },
  statements:    { group:'Financials',  label:'Financial Statements' },
  pipeline:      { group:'Sales',       label:'Sales Pipeline' },
  clients:       { group:'Sales',       label:'Clients' },
  commissions:   { group:'Sales',       label:'Commissions' },
  subscriptions: { group:'Sales',       label:'Subscriptions' },
  hr:            { group:'People',      label:'HR' },
  calendar:      { group:'Planning',    label:'Scheduler' },
  tasks:         { group:'Planning',    label:'Tasks' },
  requests:      { group:'Planning',    label:'Requests' },
  projects:      { group:'Planning',    label:'Projects' },
  files:         { group:'Reports',     label:'Legal Documents' },
  gmail:         { group:'Reports',     label:'Gmail Inbox' },
  reports:       { group:'Reports',     label:'Reports & Emails' },
  settings:      { group:'System',      label:'Settings & Users' },
};

function updateBreadcrumb(name) {
  const meta = SECTION_META[name] || { group:'', label:name };
  const g = document.getElementById('topbar-group');
  const t = document.getElementById('topbar-title');
  if (g) g.textContent = meta.group;
  if (t) t.textContent = meta.label;
}

function toggleSidebar() {
  const sb = document.getElementById('main-sidebar');
  const btn = document.getElementById('sidebar-toggle');
  if (!sb) return;
  const collapsed = sb.classList.toggle('collapsed');
  if (btn) btn.textContent = collapsed ? '›' : '‹';
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
}

function showSection(name) {
  const role = state.user?.role;
  if (role === 'sales'   && !PIPELINE_ROLE_SECTIONS.includes(name)) return;
  if (role === 'finance' && !FINANCE_ROLE_SECTIONS.includes(name))  return;
  if (name !== 'pipeline') state.pipelineView = 'pipeline';
  if (name === 'cashflow') state.cfTab = 'cf-charts';
  if (name === 'budget') state.budgetTab = 'bud-charts';
  state.section = name;
  localStorage.setItem('af_section', name);
  updateBreadcrumb(name);
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.section === name);
    if (b.dataset.section === name) {
      const group = b.closest('.nav-group-items');
      if (group && group.classList.contains('collapsed')) {
        group.classList.remove('collapsed');
        const hdr = group.previousElementSibling;
        if (hdr) hdr.classList.remove('collapsed');
        const gid = group.id?.replace('ng-', '');
        if (gid) {
          const s = JSON.parse(localStorage.getItem('navCollapsed') || '{}');
          delete s[gid];
          localStorage.setItem('navCollapsed', JSON.stringify(s));
        }
      }
    }
  });
  if (window.LottieUI) {
    LottieUI.popNavIcon(name);
    LottieUI.transitionSection(() => render());
  } else {
    render();
  }
}

function isViewerRole() { return state.user?.role === 'viewer'; }

function applyRoleNav() {
  const role = state.user?.role;
  if (!role) return;
  document.getElementById('viewer-badge')?.remove();
  if (role === 'sales') {
    document.querySelectorAll('.nav-item').forEach(b=>{
      if (!PIPELINE_ROLE_SECTIONS.includes(b.dataset.section)) b.style.display='none';
    });
    document.querySelectorAll('.nav-sec').forEach(s=>s.style.display='none');
    document.querySelectorAll('.nav-group-items').forEach(g=>g.classList.remove('collapsed'));
  } else if (role === 'finance') {
    document.querySelectorAll('.nav-item').forEach(b=>{
      if (!FINANCE_ROLE_SECTIONS.includes(b.dataset.section)) b.style.display='none';
    });
    document.querySelectorAll('.nav-group-items').forEach(g=>g.classList.remove('collapsed'));
  } else if (role === 'viewer') {
    const badge = document.createElement('div');
    badge.id = 'viewer-badge';
    badge.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#7C3AED;color:#fff;text-align:center;font-size:11px;padding:3px 0;font-weight:600;letter-spacing:.03em';
    badge.textContent = '👁  Read-only mode — viewer access';
    document.body.prepend(badge);
    document.querySelector('.shell')?.style?.setProperty('margin-top','22px');
  }
  // CFO role: full access, no restrictions needed
}

function render() {
  const c = document.getElementById('main-content'); if(!c) return;
  const s = state.section;
  if (s==='dashboard')    renderDashboard(c);
  else if (s==='cash')        renderCash(c);
  else if (s==='cashflow')    renderCashflow(c);
  else if (s==='liabilities') renderLiabilities(c);
  else if (s==='ar')          renderAR(c);
  else if (s==='budget')      renderBudget(c);
  else if (s==='revenue')     renderRevenue(c);
  else if (s==='pipeline')    renderPipeline(c);
  else if (s==='clients')     renderClients(c);
  else if (s==='statements')  renderStatements(c);
  else if (s==='commissions') renderCommissions(c);
  else if (s==='projects')    renderProjects(c);
  else if (s==='calendar')    renderCalendar(c);
  else if (s==='tasks')       renderTasks(c);
  else if (s==='requests')    renderRequests(c);
  else if (s==='files')       renderFiles(c);
  else if (s==='gmail')       renderGmail(c);
  else if (s==='reports')     renderReports(c);
  else if (s==='settings')    renderSettings(c);
  else if (s==='hr')            renderHR(c);
  else if (s==='subscriptions') renderSubscriptions(c);
  setTimeout(() => { initCustomSelects(c); initDatePickers(c); }, 0);
}

function switchView(btn, panelId) {
  btn.parentElement.querySelectorAll('.view-tab').forEach(b=>b.classList.remove('active'));
  // Find panels in closest card/section or fall back to grandparent container
  const container = btn.closest('.section,.card') || btn.parentElement.parentElement;
  container?.querySelectorAll('.view-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(panelId)?.classList.add('active');
}

function mkChart(id, type, data, extraOpts={}) {
  const ctx=document.getElementById(id); if(!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  const isRadial = type==='doughnut'||type==='pie'||type==='polarArea';
  const defaults = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: ctx=>fmt(ctx.raw) } } },
    ...(isRadial ? {} : { scales:{ x:{ ticks:{font:{size:10},color:'#5E6C84'}, grid:{display:false} }, y:{ ticks:{callback:v=>fmt(v),font:{size:10},color:'#5E6C84'}, grid:{color:'rgba(0,0,0,0.05)'} } } })
  };
  state.charts[id] = new Chart(ctx, { type, data, options: mergeDeep(defaults, extraOpts) });
}

function mkDoughnut(id, labels, data, colors) {
  const ctx=document.getElementById(id); if(!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(ctx, {
    type:'doughnut', data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:2, borderColor:'#FFFFFF', hoverOffset:6 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'62%', plugins:{ legend:{ position:'right', labels:{ font:{size:10}, color:'#5E6C84', boxWidth:10, padding:8 } }, tooltip:{ callbacks:{ label:c=>c.label+': '+fmt(c.raw) } } } }
  });
}

function mergeDeep(a, b) {
  const r={...a}; for(const k in b) { if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])) r[k]=mergeDeep(a[k]||{},b[k]); else r[k]=b[k]; }
  return r;
}

// ── Dashboard layout helpers ──────────────────────────────────────────────────
const DASH_SECTIONS = [
  { id: 'alerts',    label: 'Alerts & Warnings' },
  { id: 'flowbar',   label: 'Navigation Flow Bar' },
  { id: 'kpis',      label: 'KPI Metrics (5 cards)' },
  { id: 'ratios',    label: 'Financial Ratios' },
  { id: 'banks',     label: 'Cash by Bank' },
  { id: 'revenue',   label: 'Revenue vs Target' },
  { id: 'liabchart', label: 'Liabilities by Category' },
  { id: 'cfchart',   label: 'Cash Flow Forecast' },
  { id: 'pfchart',   label: 'Pipeline CF Forecast' },
  { id: 'budpie',    label: 'Expense Distribution' },
];
// Orderable section IDs (alerts/flowbar always render at top)
const DASH_ORDER_IDS = ['kpis','ratios','banksrev','charts'];

function getDashOrder() {
  const saved = state._userPrefs?.dashOrder || JSON.parse(localStorage.getItem('dashOrder') || 'null');
  if (Array.isArray(saved) && saved.length === DASH_ORDER_IDS.length) return saved;
  return [...DASH_ORDER_IDS];
}
function setDashOrder(arr) {
  localStorage.setItem('dashOrder', JSON.stringify(arr));
  if (!state._userPrefs) state._userPrefs = {};
  state._userPrefs.dashOrder = arr;
  apiCall('/users/me/prefs', { method:'PUT', body: JSON.stringify({ dashOrder: arr }) }).catch(()=>{});
}

function getDashHidden() {
  // Server-side prefs take precedence; fallback to localStorage for offline/pre-load
  if (state._userPrefs?.dashHidden) return state._userPrefs.dashHidden;
  try { return JSON.parse(localStorage.getItem('dashHidden') || '{}'); } catch { return {}; }
}
function setDashHidden(h) {
  localStorage.setItem('dashHidden', JSON.stringify(h));
  if (!state._userPrefs) state._userPrefs = {};
  state._userPrefs.dashHidden = h;
  apiCall('/users/me/prefs', { method: 'PUT', body: JSON.stringify({ dashHidden: h }) }).catch(()=>{});
}
function toggleDashSection(id) {
  const h = getDashHidden();
  h[id] = !h[id];
  setDashHidden(h);
  renderDashboard(document.getElementById('main-content'));
}
const DASH_SECTION_META = {
  alerts:    { icon: '⚠️', desc: 'Financial alerts, overdue invoices, expiring contracts' },
  flowbar:   { icon: '🔗', desc: 'Quick-access navigation flow between key sections' },
  kpis:      { icon: '📊', desc: '5 clickable KPI cards: Cash, Revenue, Pipeline, Liabilities, AR' },
  ratios:    { icon: '📐', desc: 'Current ratio, quick ratio, profit/EBITDA margin' },
  banks:     { icon: '🏦', desc: 'Cash balance by bank account (donut chart)' },
  revenue:   { icon: '📈', desc: 'Monthly revenue vs annual target (bar chart)' },
  liabchart: { icon: '🔴', desc: 'Liabilities breakdown by category (donut chart)' },
  cfchart:   { icon: '💹', desc: 'Cash flow forecast trend line (line chart)' },
  pfchart:   { icon: '🔮', desc: 'Pipeline-adjusted cash flow forecast (line chart)' },
  budpie:    { icon: '🥧', desc: 'Budget spend distribution by category (donut chart)' },
};
function openDashCustomize() {
  const h = getDashHidden();
  const visCount = DASH_SECTIONS.filter(s => !h[s.id]).length;
  document.getElementById('dash-customize-list').innerHTML =
    `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span style="font-size:11px;color:var(--text-2)">${visCount} of ${DASH_SECTIONS.length} sections visible</span>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" style="font-size:10px;padding:2px 9px" onclick="setAllDashSections(true)">Show All</button>
        <button class="btn btn-sm" style="font-size:10px;padding:2px 9px" onclick="setAllDashSections(false)">Hide All</button>
      </div>
    </div>` +
    DASH_SECTIONS.map(s => {
      const meta = DASH_SECTION_META[s.id] || {};
      const visible = !h[s.id];
      return `<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;background:${visible?'var(--success-bg)':'var(--surface-2)'};border:1px solid ${visible?'rgba(22,163,74,.2)':'var(--border)'};margin-bottom:6px;transition:background .15s">
        <input type="checkbox" ${visible?'checked':''} onchange="toggleDashSection('${s.id}')" style="width:15px;height:15px;accent-color:var(--primary);flex-shrink:0">
        <span style="font-size:16px;flex-shrink:0">${meta.icon||'📄'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:var(--text)">${s.label}</div>
          <div style="font-size:10px;color:var(--text-3);margin-top:1px">${meta.desc||''}</div>
        </div>
        <span style="font-size:10px;font-weight:700;padding:1px 8px;border-radius:9px;flex-shrink:0;background:${visible?'rgba(22,163,74,.12)':'var(--surface)'};color:${visible?'var(--success)':'var(--text-3)'}">${visible?'Visible':'Hidden'}</span>
      </label>`;
    }).join('') +
    `<div style="margin-top:10px;padding:10px 12px;background:var(--primary-bg);border-radius:8px;border:1px solid rgba(255,102,0,.15)">
      <div style="font-size:11px;color:var(--primary);font-weight:700;margin-bottom:4px">⠿ Drag to reorder</div>
      <div style="font-size:11px;color:var(--text-2)">Drag the ⠿ handle on each dashboard section to reorder them.</div>
    </div>`;
  openModal('modal-dash-customize');
}
function setAllDashSections(visible) {
  const h = visible ? {} : Object.fromEntries(DASH_SECTIONS.map(s=>[s.id,true]));
  setDashHidden(h);
  renderDashboard(document.getElementById('main-content'));
  openDashCustomize();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard(c) {
  const totalCash  = state.banks.reduce((a,b)=>a+b.total,0);
  const reserved   = state.reserves.reduce((a,r)=>a+r.amount,0);
  const available  = totalCash - reserved;
  const ytdRev     = state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.revenue,0);
  const ytdTgt     = state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.target,0);
  const ytdExp     = state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.expenses,0);
  const pipeWtd    = state.pipeline.reduce((a,d)=>a+d.value*(d.probability/100),0);
  const totalLiab  = state.liabilities.reduce((s,c)=>{ c.total=(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0); return s+c.total; },0);
  const totalAR    = state.ar.filter(x=>x.status!=='paid').reduce((s,x)=>s+(x.amount||0),0);
  const overdueAR  = state.ar.filter(x=>x.status==='overdue').reduce((s,x)=>s+(x.amount||0),0);
  const curMoBurn  = budgetCurrentMonth();
  const burnRate   = state.budget.reduce((a,b)=>{ const cur=b.months?.[curMoBurn]?.actual||0; return a+cur; },0);
  const runway     = burnRate ? Math.round(available/burnRate) : 0;

  // Financial ratios — prefer P&L statement data when loaded (same source as EBITDA)
  const currentAssets  = totalCash + totalAR;
  const currentLiab    = totalLiab;
  const currentRatio   = currentLiab ? (currentAssets/currentLiab).toFixed(2) : '—';
  const quickRatio     = currentLiab ? ((available+totalAR)/currentLiab).toFixed(2) : '—';
  // Gross margin = (Rev - COGS) / Rev
  const grossMargin = ytdRev ? Math.round(((ytdRev-ytdExp)/ytdRev)*100) : 0;
  // EBITDA margin from P&L when loaded (includes OpEx)
  let ebitdaMargin = null;
  if (state.statements?.pnl?.rows) {
    const _rows = state.statements.pnl.rows;
    const _rev  = _rows.find(r=>r.id==='revenue');
    const _cogs = _rows.find(r=>r.id==='cogs');
    const _opex = _rows.filter(r=>r.type==='opex');
    const _commByMo = getCommByMonth();
    const _pnlRev  = MO.reduce((a,m)=>a+(_rev?.months[m]||0),0);
    const _pnlCost = MO.reduce((a,m)=>a+(_cogs?.months[m]||0)+_opex.reduce((s,r)=>s+(r.months[m]||0),0)+(_commByMo[m]||0),0);
    if (_pnlRev > 0) ebitdaMargin = Math.round(((_pnlRev-_pnlCost)/_pnlRev)*100);
  }
  const profitMargin = ebitdaMargin !== null ? ebitdaMargin : grossMargin;
  const dso            = ytdRev ? Math.round((totalAR/(ytdRev/6))*30) : 0;

  const _dismissed = getDismissed();
  const _mkAlert = (id, cls, html) => {
    if (_dismissed.includes('dash-'+id)) return '';
    return `<div class="alert ${cls}" style="display:flex;align-items:flex-start;gap:8px">${html}<button onclick="dismissDashAlert('dash-${id}')" style="flex-shrink:0;margin-left:auto;background:none;border:none;cursor:pointer;font-size:14px;color:inherit;opacity:.5;padding:0;line-height:1" title="Dismiss">×</button></div>`;
  };
  let alerts = '';
  const cashThreshold = state.appSettings?.cashAlertThreshold || 0;
  if (cashThreshold > 0 && available < cashThreshold) alerts+=_mkAlert('cash-threshold','alert-r',`<span>🚨 <strong>Cash below threshold</strong> — Available ${fmt(available)} is under the ${fmt(cashThreshold)} alert level. <span style="cursor:pointer;text-decoration:underline;opacity:.7" onclick="showSection('settings')">Adjust threshold</span></span>`);
  // Check ALL budget categories against current month (not just Cloud, not hardcoded Apr)
  const _curMoDash = budgetCurrentMonth();
  state.budget.forEach(b=>{
    const mo=b.months?.[_curMoDash]?.target||Math.round((b.annual||0)/12);
    const act=b.months?.[_curMoDash]?.actual||0;
    if(mo>0&&act>mo*1.1) alerts+=_mkAlert('budget-'+b.id,'alert-r',`<span>⚠ <strong>${b.cat} over budget</strong> — ${Math.round(act/mo*100)}% of ${_curMoDash} target (${fmt(act)} vs ${fmt(mo)})</span>`);
  });
  if (overdueAR>0) alerts+=_mkAlert('overdue-ar','alert-r',`<span>⚠ <strong>Overdue AR: ${fmt(overdueAR)}</strong> — ${state.ar.filter(x=>x.status==='overdue').length} invoices past due</span>`);
  if (ytdRev>ytdTgt) alerts+=_mkAlert('rev-target','alert-g',`<span>✓ <strong>Revenue ahead of target</strong> — +${fmt(ytdRev-ytdTgt)} YTD</span>`);
  if (runway>0&&runway<4) alerts+=_mkAlert('runway-low','alert-a',`<span>ℹ <strong>Runway ${runway} months</strong> at current burn rate — monitor cash</span>`);
  if (totalLiab > available) alerts+=_mkAlert('solvency-risk','alert-r',`<span>🔴 <strong>Solvency Risk</strong> — Total liabilities ${fmt(totalLiab)} exceed available cash ${fmt(available)} (ratio ${available?((totalLiab/available)*100).toFixed(0):'>∞'}%). Review liability schedule immediately.</span>`);
  const _ls = state._linked?.stats;
  if (_ls) {
    const issues = (_ls.arMissingClientId||0) + (_ls.arMissingRevenueType||0) + (_ls.commMissingDealId||0) + (_ls.wonWithoutAR||0);
    if (issues > 0) alerts += _mkAlert('data-health','alert-a',`<span style="cursor:pointer" onclick="showSection('reports');setTimeout(()=>{const el=document.getElementById('health-check-section');if(el)el.scrollIntoView({behavior:'smooth'});},400)">🔗 <strong>${issues} data-linking issue${issues>1?'s':''}</strong> — unlinked invoices or commissions. <span style="text-decoration:underline;opacity:.7">Run Data Health Check →</span></span>`);
  }

  const H = getDashHidden();
  const DRAG_HANDLE = `<span class="dash-drag-handle" title="Drag to reorder">⠿</span>`;

  // Build section HTML map (keyed by DASH_ORDER_IDS)
  const _secHTML = {
    kpis: !H.kpis ? `<div class="dash-section" data-dash-id="kpis">
      ${DRAG_HANDLE}
      <div class="grid-5">
        <div class="metric clickable anim-in" onclick="showSection('cash')"><div class="metric-label">${tip('Total Cash','Sum of all bank account balances')}</div><div class="metric-value">${fmt(totalCash)}</div><div class="metric-sub" style="display:flex;flex-direction:column;gap:2px;align-items:flex-start"><span><span class="dot" style="background:var(--success)"></span>${state.banks.length} accounts</span><span style="color:var(--success);font-weight:700;font-size:11px">Avail: ${fmt(available)}</span></div></div>
        <div class="metric clickable anim-in-1" onclick="showSection('revenue')"><div class="metric-label">${tip('Revenue YTD','Total revenue recognized so far this fiscal year')}</div><div class="metric-value">${fmt(ytdRev)}</div><div class="metric-sub"><span class="dot" style="background:var(--success)"></span>${ytdTgt?((ytdRev/ytdTgt)*100).toFixed(0):0}% of target</div></div>
        <div class="metric clickable anim-in-2" onclick="showSection('pipeline')"><div class="metric-label">${tip('Sales Pipeline','Probability-weighted sum of all active deals')}</div><div class="metric-value" style="color:var(--primary)">${fmt(pipeWtd)}</div><div class="metric-sub">weighted forecast</div></div>
        <div class="metric clickable anim-in-3" onclick="showSection('liabilities')"><div class="metric-label">${tip('Total Liabilities','Sum of all outstanding debts and obligations')}</div><div class="metric-value" style="color:var(--danger)">${fmt(totalLiab)}</div><div class="metric-sub">${state.liabilities.length} categories</div></div>
        <div class="metric clickable anim-in-4" onclick="showSection('ar')"><div class="metric-label">${tip('Accounts Receivable','Unpaid invoices owed to you by clients')}</div><div class="metric-value" style="color:var(--info)">${fmt(totalAR)}</div><div class="metric-sub">${overdueAR>0?`<span style="color:var(--danger)">${fmt(overdueAR)} overdue</span>`:'All current'}</div></div>
      </div>
    </div>` : '',
    ratios: !H.ratios ? `<div class="dash-section" data-dash-id="ratios">
      ${DRAG_HANDLE}
      <div class="ratio-grid">
        <div class="ratio-card"><div class="ratio-label">${tip('Current Ratio','Current assets ÷ current liabilities. ≥2 healthy, 1–2 caution, &lt;1 risk')}</div><div class="ratio-value" style="color:${Number(currentRatio)>=2?'var(--success)':Number(currentRatio)>=1?'var(--warning)':'var(--danger)'}">${currentRatio}x</div><div class="ratio-sub">Assets / Liabilities</div></div>
        <div class="ratio-card"><div class="ratio-label">${tip('Quick Ratio','(Cash + AR) ÷ current liabilities — excludes illiquid assets. ≥1 healthy')}</div><div class="ratio-value" style="color:${Number(quickRatio)>=1?'var(--success)':'var(--warning)'}">${quickRatio}x</div><div class="ratio-sub">Liquid assets / Current liab.</div></div>
        <div class="ratio-card"><div class="ratio-label">${tip(ebitdaMargin!==null?'EBITDA Margin':'Gross Margin', ebitdaMargin!==null?'Earnings before interest, tax, depreciation &amp; amortisation as % of revenue':'Revenue minus cost of goods sold as % of revenue')}</div><div class="ratio-value" style="color:${profitMargin>20?'var(--success)':profitMargin>10?'var(--warning)':'var(--danger)'}">${profitMargin}%</div><div class="ratio-sub">${ebitdaMargin!==null?'EBITDA (P&L-derived)':'Gross (Revenue module)'}</div></div>
        <div class="ratio-card"><div class="ratio-label">DSO</div><div class="ratio-value" style="color:${dso<30?'var(--success)':dso<60?'var(--warning)':'var(--danger)'}">${dso} days</div><div class="ratio-sub">Days Sales Outstanding</div></div>
      </div>
    </div>` : '',
    banksrev: (()=>{
      const showBanks = !H.banks, showRev = !H.revenue, showLiab = !H.liabchart;
      if (!showBanks && !showRev && !showLiab) return '';
      return `<div class="dash-section" data-dash-id="banksrev">
        ${DRAG_HANDLE}
        <div class="grid-2">
          ${showBanks ? `<div class="card">
            <div class="card-header"><div class="card-title">Cash by Bank</div><span style="font-size:10px;color:var(--text-2)">Available vs reserved</span></div>
            <div class="chart-wrap chart-wrap-lg"><canvas id="ch-banks"></canvas></div>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${state.banks.map(b=>`<div style="font-size:11px;flex:1;min-width:80px;background:var(--surface-2);border-radius:7px;padding:7px 10px;border:1px solid var(--border)"><div style="color:var(--text-2);font-size:10px">${b.name}</div><div style="font-weight:700;margin-top:2px;font-family:'Montserrat',sans-serif">${fmt(b.total)}</div></div>`).join('')}</div>
          </div>` : '<div></div>'}
          ${(showRev || showLiab) ? `<div style="display:flex;flex-direction:column;gap:12px">
            ${showRev ? `<div class="card"><div class="card-header"><div class="card-title">Revenue vs Target</div></div><div class="chart-wrap"><canvas id="ch-rev"></canvas></div></div>` : ''}
            ${showLiab ? `<div class="card"><div class="card-header"><div class="card-title">Liabilities by Category</div><button class="btn btn-sm" onclick="showSection('liabilities')">View all →</button></div><div class="chart-wrap-sm"><canvas id="ch-liab-donut"></canvas></div></div>` : ''}
          </div>` : '<div></div>'}
        </div>
      </div>`;
    })(),
    charts: (()=>{
      const showCf = !H.cfchart, showPf = !H.pfchart, showBud = !H.budpie;
      if (!showCf && !showPf && !showBud) return '';
      const vis = [showCf, showPf, showBud].filter(Boolean).length;
      return `<div class="dash-section" data-dash-id="charts">
        ${DRAG_HANDLE}
        <div style="display:grid;grid-template-columns:repeat(${vis},1fr);gap:12px">
          ${showCf ? `<div class="card"><div class="card-header"><div class="card-title">Cash Flow Forecast</div></div><div class="chart-wrap"><canvas id="ch-cf"></canvas></div></div>` : ''}
          ${showPf ? `<div class="card"><div class="card-header"><div class="card-title">Pipeline CF Forecast</div><button class="btn btn-sm" onclick="switchPipelineView('forecast')" style="font-size:10px">View →</button></div><div class="chart-wrap"><canvas id="ch-pf-cf"></canvas></div></div>` : ''}
          ${showBud ? `<div class="card"><div class="card-header"><div class="card-title">Expense Distribution</div></div><div class="chart-wrap"><canvas id="ch-bud-pie"></canvas></div></div>` : ''}
        </div>
      </div>`;
    })(),
  };

  // Add subscriptions widget if there are subscriptions
  _secHTML['subscriptions'] = (state.subscriptions||[]).length ? subDashWidget() : '';

  const orderedSections = getDashOrder().map(id => {
    if (id === 'ratios') return (_secHTML['subscriptions']||'') + (_secHTML[id]||'');
    return _secHTML[id] || '';
  }).join('');

  c.innerHTML = `
  <div id="dash-grid" style="display:flex;flex-direction:column;gap:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;font-weight:700;color:var(--text-2)">CFO Dashboard — FY ${state.fiscalYear}</div>
      <div style="display:flex;gap:8px;align-items:center">
        ${yearNavHTML()}
        <button class="btn btn-sm" onclick="executeBrief()" style="font-size:11px;background:var(--primary-bg);color:var(--primary);border-color:var(--primary)" title="Generate AI executive brief">✦ Execute Brief</button>
        <button class="btn btn-sm" onclick="openDashCustomize()" title="Customize dashboard" style="font-size:11px;color:var(--text-2)">⚙ Customize</button>
      </div>
    </div>
    ${!H.alerts && alerts ? alerts : ''}
    ${!H.flowbar ? `<div class="flow-bar">
      ${[['Cash Position','dashboard'],['Cash & Reserves','cash'],['Liabilities','liabilities'],['Account Receivables','ar'],['Revenue & Pipeline','revenue'],['Budget','budget']].map(([l,s],i)=>`
      <div class="flow-step">
        <div class="flow-node${state.section===s?' active':''}" onclick="showSection('${s}')">
          <div class="flow-num">${i+1}</div>
          <div class="flow-label">${l}</div>
        </div>${i<5?'<div class="flow-arrow">→</div>':''}
      </div>`).join('')}
    </div>` : ''}
    ${orderedSections}
  </div>`;

  setTimeout(()=>{
    if (document.getElementById('ch-banks')) {
      mkDoughnut('ch-banks',state.banks.map(b=>b.name),state.banks.map(b=>b.total),['#FF6600','#2563EB','#16A34A','#7C3AED']);
    }
    if (document.getElementById('ch-rev')) {
      mkChart('ch-rev','bar',{
        labels:state.revenue.map(r=>r.month),
        datasets:[
          {label:'Revenue',data:state.revenue.map(r=>r.revenue),backgroundColor:'#FF6600',borderRadius:4},
          {label:'Target', data:state.revenue.map(r=>r.target), backgroundColor:'rgba(0,0,0,0.08)',borderRadius:4}
        ]
      });
    }
    if (document.getElementById('ch-cf')) {
      mkChart('ch-cf','line',{
        labels:state.cashflow.map(d=>d.month.split(' ')[0]),
        datasets:[{data:state.cashflow.map(d=>d.opening+d.inflow-d.outflow),borderColor:'#16A34A',backgroundColor:'rgba(22,163,74,0.07)',fill:true,borderWidth:2,pointRadius:0,tension:.35}]
      });
    }
    if (document.getElementById('ch-pf-cf')) {
      const pfRows = pfComputeRows(state.cfYear);
      if (pfRows.some(r => r.inflow > 0 || r.closing !== 0)) {
        mkChart('ch-pf-cf', 'line', { labels: pfRows.map(r => r.month.split(' ')[0]), datasets: [{ data: pfRows.map(r => r.closing), borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.07)', fill: true, borderWidth: 2, pointRadius: 0, tension: .35 }] });
      }
    }
    if (document.getElementById('ch-bud-pie')) {
      const budFilled=state.budget.filter(b=>b.cat&&b.cat!=='New Category'||budgetAnnual(b)>0);
      const budLabels=budFilled.map(b=>b.cat);
      const budData=budFilled.map(b=>{ const mo=b.months; const v=Object.values(mo||{}).reduce((a,m)=>a+(m.actual||0),0); return v||0; });
      mkDoughnut('ch-bud-pie',budLabels,budData,['#FF6600','#2563EB','#16A34A','#7C3AED','#D97706','#DC2626']);
    }
    if (state.liabilities.length && document.getElementById('ch-liab-donut')) {
      const lLabels=state.liabilities.map(l=>l.name);
      const lData=state.liabilities.map(l=>(l.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0));
      mkDoughnut('ch-liab-donut',lLabels,lData,['#DC2626','#D97706','#7C3AED','#2563EB']);
    }
    initDashDnD(document.getElementById('dash-grid'));
  },50);
}

function initDashDnD(grid) {
  if (!grid) return;
  let dragSrc = null;
  grid.querySelectorAll('.dash-section').forEach(sec => {
    sec.setAttribute('draggable','true');
    sec.addEventListener('dragstart', e => {
      dragSrc = sec;
      sec.classList.add('dash-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', sec.dataset.dashId || '');
    });
    sec.addEventListener('dragend', () => {
      dragSrc = null;
      grid.querySelectorAll('.dash-section').forEach(s => s.classList.remove('dash-dragging','dash-drag-over-top','dash-drag-over-bot'));
      // Save new order
      const newOrder = [...grid.querySelectorAll('.dash-section')].map(s => s.dataset.dashId);
      setDashOrder(newOrder);
    });
    sec.addEventListener('dragover', e => {
      if (!dragSrc || dragSrc === sec) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = sec.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      sec.classList.toggle('dash-drag-over-top', e.clientY < mid);
      sec.classList.toggle('dash-drag-over-bot', e.clientY >= mid);
    });
    sec.addEventListener('dragleave', () => sec.classList.remove('dash-drag-over-top','dash-drag-over-bot'));
    sec.addEventListener('drop', e => {
      if (!dragSrc || dragSrc === sec) return;
      e.preventDefault();
      const r = sec.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      grid.insertBefore(dragSrc, before ? sec : sec.nextSibling);
      sec.classList.remove('dash-drag-over-top','dash-drag-over-bot');
    });
  });
}

// ── Cash & Reserves ───────────────────────────────────────────────────────────
function renderCash(c) {
  const totalCash=state.banks.reduce((a,b)=>a+b.total,0);
  const reserved=state.reserves.reduce((a,r)=>a+r.amount,0);
  const available=totalCash-reserved;
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab active" onclick="switchView(this,'cash-charts')">Overview</button>
      <button class="view-tab" onclick="switchView(this,'cash-edit')">Reserves</button>
    </div>
    <div class="view-panel active" id="cash-charts">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:12px">
        ${state.banks.map(b=>{ const bRes=state.reserves.filter(r=>r.bank===b.name).reduce((a,r)=>a+r.amount,0); const avail=b.total-bRes; const neg=avail<0;
          return `<div class="metric${neg?' style="border-color:var(--danger)"':''}"><div class="metric-label">${b.name}${neg?' <span style="color:var(--danger);font-size:10px">⚠ Overreserved</span>':''}</div><div class="metric-value">${fmt(b.total)}</div><div class="metric-sub"><span style="color:${neg?'var(--danger)':'var(--success)'}">Avail ${fmt(avail)}</span> · ${b.type}</div></div>`; }).join('')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Cash by Bank — Available vs Reserved</div><button class="btn btn-sm" onclick="syncSource('/cash/sync','QuickBooks cash')">↻ Sync</button></div>
        <div class="chart-wrap chart-wrap-lg"><canvas id="chart-cash"></canvas></div>
      </div>
    </div>
    <div class="view-panel" id="cash-edit">
      <div class="card">
        <div class="card-header"><div><div class="card-title">Cash Reserves</div><div class="card-desc">Earmarked amounts deducted from available cash</div></div><button class="btn btn-primary btn-sm" onclick="openAddReserve()">+ Add Reserve</button></div>
        <div id="reserves-list"></div>
        <div style="background:var(--surface-2);border:0.5px solid var(--border);border-radius:8px;padding:12px 14px;margin-top:10px;display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-size:10px;color:var(--text-2);text-transform:uppercase;letter-spacing:.04em">Available Cash</div><div style="font-size:24px;font-weight:700;color:var(--success);margin-top:3px">${fmt(available)}</div></div>
          <div style="text-align:right"><div style="font-size:10px;color:var(--text-2);text-transform:uppercase;letter-spacing:.04em">Reserved</div><div style="font-size:16px;font-weight:600;color:var(--danger-text);margin-top:3px">${fmt(reserved)}</div></div>
        </div>
      </div>
    </div>
  </div>`;
  renderReservesList();
  setTimeout(()=>{
    const resMap={}; state.banks.forEach(b=>resMap[b.name]=0);
    state.reserves.forEach(r=>{resMap[r.bank]=(resMap[r.bank]||0)+r.amount;});
    mkChart('chart-cash','bar',{
      labels:state.banks.map(b=>b.name),
      datasets:[{label:'Available',data:state.banks.map(b=>b.total-(resMap[b.name]||0)),backgroundColor:'#FF6600',borderRadius:5},{label:'Reserved',data:state.banks.map(b=>resMap[b.name]||0),backgroundColor:'#2563EB',borderRadius:5}]
    },{scales:{x:{stacked:true,grid:{display:false},ticks:{color:'#5E6C84'}},y:{stacked:true,ticks:{callback:v=>fmt(v),color:'#5E6C84'},grid:{color:'rgba(0,0,0,0.05)'}}}});
  },50);
}

function renderReservesList() {
  const el=document.getElementById('reserves-list'); if(!el) return;
  el.innerHTML=state.reserves.length ? state.reserves.map(r=>`
    <div class="reserve-row">
      <div style="display:flex;gap:10px;min-width:0"><strong style="color:var(--primary)">${r.bank}</strong><span style="color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</span></div>
      <div style="display:flex;align-items:center;gap:10px"><strong style="color:var(--danger-text)">${fmt(r.amount)}</strong><button class="del-btn" onclick="deleteReserve(${r.id})">×</button></div>
    </div>`).join('') : emptyState('No reserves added yet', 'Add a reserve to track earmarked funds');
}

function openAddReserve() { ['rs-name','rs-amount'].forEach(id=>document.getElementById(id).value=''); openModal('modal-reserve'); }
async function saveReserve() {
  const bank=document.getElementById('rs-bank').value, name=document.getElementById('rs-name').value.trim(), amount=parseInt(document.getElementById('rs-amount').value)||0;
  if (!name||!amount) { toast('Please fill name and amount'); return; }
  const bankAccount = state.banks.find(b=>b.name===bank);
  if (bankAccount) {
    const existingRes = state.reserves.filter(r=>r.bank===bank).reduce((a,r)=>a+r.amount,0);
    if (existingRes + amount > bankAccount.total) {
      if (!confirm(`⚠ This reserve (${fmt(amount)}) would cause ${bank} available balance to go negative (current total: ${fmt(bankAccount.total)}, existing reserves: ${fmt(existingRes)}). Add anyway?`)) return;
    }
  }
  try { const r=await apiCall('/reserves',{method:'POST',body:JSON.stringify({bank,name,amount})}); state.reserves.push({id:r.id,bank,name,amount}); closeModal('modal-reserve'); render(); toast('Reserve added'); } catch(e) { toast('Error: '+e.message); }
}
async function deleteReserve(id) {
  await apiCall(`/reserves/${id}`,{method:'DELETE'}); state.reserves=state.reserves.filter(r=>r.id!==id); render();
}

// ── Cash Flow ─────────────────────────────────────────────────────────────────
function renderCashflow(c) {
  recalcCashflow();
  const ti=state.cashflow.reduce((a,r)=>a+r.inflow,0);
  const to=state.cashflow.reduce((a,r)=>a+r.outflow,0);
  const lastRow=state.cashflow[state.cashflow.length-1];
  const closing=lastRow?lastRow.opening+lastRow.inflow-lastRow.outflow:0;
  const firstRow=state.cashflow[0];
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab ${state.cfTab==='cf-charts'?'active':''}" onclick="state.cfTab='cf-charts';switchView(this,'cf-charts')">Charts</button>
      <button class="view-tab ${state.cfTab==='cf-edit'?'active':''}" onclick="state.cfTab='cf-edit';switchView(this,'cf-edit')">Edit — Direct Input</button>
      <button class="view-tab ${state.cfTab==='cf-pipeline'?'active':''}" onclick="state.cfTab='cf-pipeline';switchView(this,'cf-pipeline')">Pipeline Forecast</button>
    </div>
    <div class="view-panel ${state.cfTab==='cf-charts'?'active':''}" id="cf-charts">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Cash Flow Forecast — FY ${state.cfYear}</div><div class="card-desc">12-month view from January to December</div></div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-sm" style="font-size:11px;color:var(--primary);border-color:var(--primary-bg)" onclick="openAI('cashflow')">✦ Ask Ayla</button>
            ${yearNavHTML()}
            <button class="btn btn-sm" onclick="syncSource('/cashflow/sync','QuickBooks')">↻ Sync</button>
          </div>
        </div>
        <div style="margin-bottom:10px;display:flex;gap:14px;font-size:11px;color:var(--text-2)">
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#f97316;border-radius:2px;display:inline-block"></span>Inflow</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#94A3B8;border-radius:2px;display:inline-block"></span>Outflow</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:22px;height:2px;background:#22c55e;display:inline-block"></span>Closing Balance</span>
        </div>
        <div class="chart-wrap chart-wrap-lg"><canvas id="chart-cf-detail"></canvas></div>
        <div class="grid-4" style="margin-top:12px">
          <div class="metric"><div class="metric-label">Opening Jan</div><div class="metric-value">${fmt(firstRow?.opening||0)}</div></div>
          <div class="metric"><div class="metric-label">Total Inflow</div><div class="metric-value" style="color:var(--success)">${fmt(ti)}</div></div>
          <div class="metric"><div class="metric-label">Total Outflow</div><div class="metric-value" style="color:var(--danger-text)">${fmt(to)}</div></div>
          <div class="metric" style="background:var(--success-bg);border-color:rgba(34,197,94,.2)"><div class="metric-label" style="color:var(--success-text)">Dec Closing</div><div class="metric-value" style="color:var(--success)">${fmt(closing)}</div></div>
        </div>
      </div>
    </div>
    <div class="view-panel ${state.cfTab==='cf-edit'?'active':''}" id="cf-edit">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Cash Flow — Direct Input</div><div class="card-desc">Download template to edit detail items (Inflow/Outflow per month), then upload with column mapping</div></div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm" onclick="downloadExcelTemplate('cashflow')">📋 Template</button>
            <label class="btn btn-sm" style="cursor:pointer">⬆ Upload Excel<input type="file" accept=".xlsx,.xls" style="display:none" onchange="uploadCfExcel(this)"></label>
            <button class="btn btn-sm" onclick="syncCfOpeningBalance()" title="Set January opening balance to current Cash & Reserves total">↻ Sync Opening Balance</button>
            <button class="btn btn-sm" onclick="syncSource('/cashflow/sync','QuickBooks')">↻ Sync</button>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Month</th><th>Opening <span class="badge-qbo">QBO</span></th><th>Inflow <span class="badge-manual">manual</span></th><th>Outflow <span class="badge-manual">manual</span></th><th>Net <span class="badge-auto">auto</span></th><th>Closing <span class="badge-auto">auto</span></th><th></th></tr></thead>
            <tbody>${state.cashflow.map((r,i)=>{
              const net=r.inflow-r.outflow, cl=r.opening+net;
              return `<tr>
                <td><strong>${r.month}</strong></td>
                <td style="color:var(--text-2)">${fmt(r.opening)}</td>
                <td><input class="input input-cell" type="text" value="${fmt(r.inflow)}" onchange="updateCashflow(${i},'inflow',this.value)" oninput="this.classList.add('modified');showCfSave()"></td>
                <td><input class="input input-cell" type="text" value="${fmt(r.outflow)}" onchange="updateCashflow(${i},'outflow',this.value)" oninput="this.classList.add('modified');showCfSave()"></td>
                <td class="${net>=0?'val-pos':'val-neg'}">${net>=0?'+':''}${fmt(net)}</td>
                <td style="color:var(--success);font-weight:600">${fmt(cl)}</td>
                <td><button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="openCfDetail(${i})">Details</button></td>
              </tr>`;}).join('')}
            </tbody>
            <tfoot>
              <tr style="background:var(--surface-2);font-weight:700;border-top:2px solid var(--border)">
                <td style="padding:8px 12px">Total</td>
                <td style="color:var(--text-2)">—</td>
                <td style="color:var(--success)">${fmt(ti)}</td>
                <td style="color:var(--danger-text)">${fmt(to)}</td>
                <td class="${(ti-to)>=0?'val-pos':'val-neg'}">${(ti-to)>=0?'+':''}${fmt(ti-to)}</td>
                <td style="color:var(--success);font-weight:800">${fmt(closing)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="save-bar" id="cf-savebar"><span class="save-hint">⚠ Unsaved changes</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="discardCashflow()">Discard</button><button class="btn btn-primary btn-sm" onclick="saveCashflow()">Save</button></div></div>
      </div>
    </div>
    ${(()=>{
      // Pipeline Forecast: overlay expected deal closings onto cashflow
      const pipeDeals = state.pipeline.filter(d=>d.stage!=='Closed Lost'&&d.closeDate);
      const pipeByMonth = {};
      pipeDeals.forEach(d=>{
        const mo = new Date(d.closeDate+'T00:00:00').toLocaleString('en-US',{month:'short'});
        const yr = new Date(d.closeDate+'T00:00:00').getFullYear();
        const key = mo+' '+yr;
        if(!pipeByMonth[key]) pipeByMonth[key]={wtd:0,won:0};
        pipeByMonth[key].wtd += d.value*(d.probability/100);
        if(d.stage==='Closed Won') pipeByMonth[key].won += d.value;
      });
      const cfWithPipe = state.cashflow.map(r=>({
        month:r.month, baseClose:r.opening+r.inflow-r.outflow,
        pipeWtd:(pipeByMonth[r.month]?.wtd||0), pipeWon:(pipeByMonth[r.month]?.won||0)
      }));
      const totalPipeWtd = Object.values(pipeByMonth).reduce((a,v)=>a+v.wtd,0);
      const totalPipeWon = Object.values(pipeByMonth).reduce((a,v)=>a+v.won,0);
      return `<div class="view-panel ${state.cfTab==='cf-pipeline'?'active':''}" id="cf-pipeline">
        <div class="card">
          <div class="card-header">
            <div><div class="card-title">Pipeline Cash Flow Forecast — FY ${state.cfYear}</div><div class="card-desc">Actual closing balance + weighted pipeline deals by expected close month</div></div>
          </div>
          <div class="grid-3" style="margin-bottom:12px">
            <div class="metric"><div class="metric-label">Pipeline Weighted</div><div class="metric-value" style="color:var(--primary)">${fmt(totalPipeWtd)}</div><div class="metric-sub">Expected inflow</div></div>
            <div class="metric"><div class="metric-label">Closed Won</div><div class="metric-value" style="color:var(--success)">${fmt(totalPipeWon)}</div><div class="metric-sub">Confirmed</div></div>
            <div class="metric" style="background:var(--success-bg)"><div class="metric-label">Best Case Closing</div><div class="metric-value" style="color:var(--success)">${fmt(closing+totalPipeWtd)}</div><div class="metric-sub">+pipeline</div></div>
          </div>
          <div class="chart-wrap chart-wrap-lg"><canvas id="chart-cf-pipe"></canvas></div>
          <div style="overflow-x:auto;margin-top:12px">
            <table class="table">
              <thead><tr><th>Month</th><th style="text-align:right">Base Closing</th><th style="text-align:right;color:var(--primary)">Pipeline Weighted</th><th style="text-align:right;color:var(--success)">Closed Won</th><th style="text-align:right;color:var(--info)">Projected Closing</th></tr></thead>
              <tbody>${cfWithPipe.map(r=>`<tr>
                <td><strong>${r.month}</strong></td>
                <td style="text-align:right">${fmt(r.baseClose)}</td>
                <td style="text-align:right;color:var(--primary)">${r.pipeWtd>0?fmt(r.pipeWtd):'—'}</td>
                <td style="text-align:right;color:var(--success)">${r.pipeWon>0?fmt(r.pipeWon):'—'}</td>
                <td style="text-align:right;color:var(--info);font-weight:700">${fmt(r.baseClose+r.pipeWtd)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    })()}
  </div>`;
  setTimeout(()=>{
    mkChart('chart-cf-detail','bar',{
      labels:state.cashflow.map(d=>d.month.split(' ')[0]),
      datasets:[
        {label:'Inflow', type:'bar', data:state.cashflow.map(d=>d.inflow), backgroundColor:'#FF6600',borderRadius:4},
        {label:'Outflow',type:'bar', data:state.cashflow.map(d=>d.outflow),backgroundColor:'#94A3B8',borderRadius:4},
        {label:'Closing',type:'line',data:state.cashflow.map(d=>d.opening+d.inflow-d.outflow),borderColor:'#16A34A',backgroundColor:'transparent',borderWidth:2.5,pointRadius:3,pointBackgroundColor:'#16A34A',tension:.3}
      ]
    });
    // Pipeline chart
    const pipeByMonth2={};
    state.pipeline.filter(d=>d.stage!=='Closed Lost'&&d.closeDate).forEach(d=>{
      const mo=new Date(d.closeDate+'T00:00:00').toLocaleString('en-US',{month:'short'});
      const yr=new Date(d.closeDate+'T00:00:00').getFullYear();
      const key=mo+' '+yr;
      if(!pipeByMonth2[key])pipeByMonth2[key]=0;
      pipeByMonth2[key]+=d.value*(d.probability/100);
    });
    if(document.getElementById('chart-cf-pipe')){
      mkChart('chart-cf-pipe','bar',{
        labels:state.cashflow.map(d=>d.month.split(' ')[0]),
        datasets:[
          {label:'Base Closing',type:'line',data:state.cashflow.map(d=>d.opening+d.inflow-d.outflow),borderColor:'#16A34A',backgroundColor:'transparent',borderWidth:2,pointRadius:3,tension:.3},
          {label:'Pipeline Weighted',type:'bar',data:state.cashflow.map(d=>pipeByMonth2[d.month]||0),backgroundColor:'rgba(37,99,235,0.6)',borderRadius:4},
          {label:'Projected',type:'line',data:state.cashflow.map(d=>(d.opening+d.inflow-d.outflow)+(pipeByMonth2[d.month]||0)),borderColor:'#2563EB',backgroundColor:'transparent',borderDash:[5,5],borderWidth:2,pointRadius:2,tension:.3}
        ]
      });
    }
  },50);
}

// ── Pipeline Cash Flow Forecast ───────────────────────────────────────────────

function pfComputeRows(yr) {
  const yrData = state.pfForecast[yr] || { startingBalance: 0, rows: [] };
  const savedRows = yrData.rows || [];

  // Build pipeline inflow map keyed "Mon YYYY"
  const pipeByMonth = {};
  state.pipeline.filter(d => d.stage !== 'Closed Lost' && d.closeDate).forEach(d => {
    const dt = new Date(d.closeDate + 'T00:00:00');
    const key = MO[dt.getMonth()] + ' ' + dt.getFullYear();
    if (!pipeByMonth[key]) pipeByMonth[key] = { won: 0, openWtd: 0, wtd: 0, deals: [] };
    if (d.stage === 'Closed Won') {
      pipeByMonth[key].won += d.value;
    } else {
      pipeByMonth[key].openWtd += d.value * (d.probability / 100);
    }
    pipeByMonth[key].wtd += d.value * (d.probability / 100);
    pipeByMonth[key].deals.push(d);
  });

  let opening = yrData.startingBalance || 0;
  return MO.map((mo, i) => {
    const key = mo + ' ' + yr;
    const saved = savedRows.find(r => r.month === key) || {};
    const pipeWon     = pipeByMonth[key]?.won     || 0;
    const pipeOpenWtd = pipeByMonth[key]?.openWtd || 0;
    const pipeWtd     = pipeByMonth[key]?.wtd     || 0;
    const wonOverridden = saved.wonOverride    !== null && saved.wonOverride    !== undefined;
    const wtdOverridden = saved.inflowOverride !== null && saved.inflowOverride !== undefined;
    const wonValue  = wonOverridden ? saved.wonOverride    : pipeWon;
    const wtdValue  = wtdOverridden ? saved.inflowOverride : pipeOpenWtd;
    const inflow    = wonValue + wtdValue;
    const overridden = wonOverridden || wtdOverridden;
    const outflow = saved.outflow || 0;
    const net = inflow - outflow;
    const closing = opening + net;
    const row = { month: key, opening, inflow, outflow, net, closing,
      pipeWon, pipeOpenWtd, pipeWtd, wonValue, wtdValue,
      wonOverridden, wtdOverridden, overridden,
      deals: pipeByMonth[key]?.deals || [] };
    opening = closing;
    return row;
  });
}

function renderPipelineForecast(c) {
  const yr = state.cfYear;
  const rows = pfComputeRows(yr);
  const yrData = state.pfForecast[yr] || { startingBalance: 0, rows: [] };

  const firstRow = rows[0], lastRow = rows[rows.length - 1];
  const totalInflow  = rows.reduce((a, r) => a + r.inflow, 0);
  const totalOutflow = rows.reduce((a, r) => a + r.outflow, 0);
  const totalPipeWtd = rows.reduce((a, r) => a + r.pipeWtd, 0);
  const totalPipeWon = rows.reduce((a, r) => a + r.pipeWon, 0);
  const closing      = lastRow ? lastRow.closing : 0;
  const pipeDeals    = state.pipeline.filter(d => d.stage !== 'Closed Lost' && d.closeDate);
  const totalDeals   = pipeDeals.length;
  const avgProb      = totalDeals ? Math.round(pipeDeals.reduce((a, d) => a + d.probability, 0) / totalDeals) : 0;
  const topDeals     = [...pipeDeals].sort((a, b) => (b.value * b.probability / 100) - (a.value * a.probability / 100)).slice(0, 5);
  const stageColors  = { 'Closed Won':'var(--success)', 'Negotiation':'var(--primary)', 'Proposal':'var(--warning)', 'Qualification':'#7C3AED', 'Prospecting':'var(--text-2)', 'On Hold':'var(--text-3)' };

  c.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px">

    <!-- Sub-nav + breadcrumb -->
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div class="view-tabs" style="width:fit-content">
        <button class="view-tab" onclick="switchPipelineView('pipeline')"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-right:5px"><path d="M1 7h12M7 1l6 6-6 6"/></svg>Sales Pipeline</button>
        <button class="view-tab active" onclick="switchPipelineView('forecast')"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-right:5px"><polyline points="1,11 4,7 7,9 10,4 13,2"/></svg>Pipeline Forecast</button>
      </div>
      <div style="font-size:11px;color:var(--text-3)">
        Planning <span style="margin:0 5px;opacity:.5">›</span>
        <span style="cursor:pointer;color:var(--text-2)" onclick="switchPipelineView('pipeline')">Sales Pipeline</span>
        <span style="margin:0 5px;opacity:.5">›</span>
        <strong style="color:var(--text)">Pipeline Forecast</strong>
      </div>
    </div>

    <!-- Tab bar (direct child for switchView compatibility) -->
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab ${state.pfTab==='pf-charts'?'active':''}" onclick="state.pfTab='pf-charts';render()">Charts</button>
      <button class="view-tab ${state.pfTab==='pf-input'?'active':''}" onclick="state.pfTab='pf-input';render()">Direct Input</button>
    </div>

    <!-- Year nav -->
    <div style="display:flex;justify-content:flex-end">
      <div style="display:flex;gap:6px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px 10px">
        <button class="btn btn-sm" style="border:none;background:transparent;padding:2px 6px" onclick="changeYear(-1)">‹ ${yr-1}</button>
        <span style="font-size:13px;font-weight:700;color:var(--primary);padding:0 4px">FY ${yr}</span>
        <button class="btn btn-sm" style="border:none;background:transparent;padding:2px 6px" onclick="changeYear(1)">${yr+1} ›</button>
      </div>
    </div>

    <!-- ── CHARTS TAB ── -->
    <div class="view-panel ${state.pfTab==='pf-charts'?'active':''}" id="pf-charts">
      <div style="display:flex;flex-direction:column;gap:14px">

        <!-- KPI cards -->
        <div class="grid-4">
          <div class="metric">
            <div class="metric-label">Opening Jan</div>
            <div class="metric-value">${fmt(firstRow?.opening || 0)}</div>
            <div class="metric-sub">Starting balance</div>
          </div>
          <div class="metric">
            <div class="metric-label">Total Pipeline Inflow</div>
            <div class="metric-value" style="color:var(--success)">${fmt(totalInflow)}</div>
            <div class="metric-sub">${totalDeals} deals · avg ${avgProb}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Total Outflow</div>
            <div class="metric-value" style="color:var(--danger-text)">${fmt(totalOutflow)}</div>
            <div class="metric-sub">Manual entries</div>
          </div>
          <div class="metric" style="background:var(--success-bg);border-color:rgba(34,197,94,.2)">
            <div class="metric-label" style="color:var(--success-text)">Dec Closing</div>
            <div class="metric-value" style="color:var(--success)">${fmt(closing)}</div>
            <div class="metric-sub" style="color:var(--success-text)">End-of-year balance</div>
          </div>
        </div>

        <!-- Main chart -->
        <div class="card">
          <div class="card-header">
            <div><div class="card-title">Pipeline Cash Flow Forecast — FY ${yr}</div><div class="card-desc">12-month view from January to December</div></div>
          </div>
          <div style="margin-bottom:10px;display:flex;gap:14px;font-size:11px;color:var(--text-2)">
            <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#f97316;border-radius:2px;display:inline-block"></span>Pipeline Inflow</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#94A3B8;border-radius:2px;display:inline-block"></span>Outflow</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:22px;height:2px;background:#22c55e;display:inline-block"></span>Closing Balance</span>
          </div>
          <div class="chart-wrap chart-wrap-lg"><canvas id="chart-pf-cf"></canvas></div>
        </div>

        <!-- Overlay chart + top deals -->
        <div style="display:grid;grid-template-columns:1fr 340px;gap:14px;align-items:start">
          <div class="card">
            <div class="card-header">
              <div><div class="card-title">Pipeline vs Projected</div><div class="card-desc">Weighted pipeline deals overlaid on closing balance</div></div>
              <div style="display:flex;gap:10px;font-size:11px;color:var(--text-2)">
                <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:3px;background:#16A34A;display:inline-block;border-radius:2px"></span>Closing</span>
                <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:3px;background:#2563EB;display:inline-block;border-radius:2px"></span>Projected</span>
                <span style="display:flex;align-items:center;gap:5px"><span style="width:12px;height:10px;background:rgba(37,99,235,0.45);display:inline-block;border-radius:2px"></span>Pipeline Wtd</span>
              </div>
            </div>
            <div class="chart-wrap chart-wrap-lg"><canvas id="chart-pf-overlay"></canvas></div>
          </div>

          <div class="card">
            <div class="card-header"><div class="card-title">Top Pipeline Deals</div><div class="card-desc">By weighted value</div></div>
            ${topDeals.length ? topDeals.map((d, i) => {
              const wtd = Math.round(d.value * d.probability / 100);
              const col = stageColors[d.stage] || 'var(--text-2)';
              return `<div style="padding:10px 0;border-bottom:0.5px solid var(--border);display:flex;gap:10px;align-items:flex-start">
                <div style="width:22px;height:22px;border-radius:50%;background:var(--primary-bg);color:var(--primary);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.name}</div>
                  <div style="font-size:10px;color:var(--text-2);margin-top:1px">${d.closeDate||'—'} · <span style="color:${col}">${d.stage}</span></div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-size:12px;font-weight:700;color:var(--primary)">${fmt(wtd)}</div>
                  <div style="font-size:10px;color:var(--text-3)">${d.probability}% of ${fmt(d.value)}</div>
                </div>
              </div>`;
            }).join('') : emptyState('No pipeline deals', 'Add a deal to start tracking your sales pipeline')}
          </div>
        </div>

      </div>
    </div>

    <!-- ── DIRECT INPUT TAB ── -->
    <div class="view-panel ${state.pfTab==='pf-input'?'active':''}" id="pf-input">
      <div style="display:flex;flex-direction:column;gap:14px">

        <!-- Starting balance card -->
        <div class="card" style="padding:16px 20px">
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
              <div style="font-size:11px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Starting Balance (Jan Opening)</div>
              <input class="input" type="text" id="pf-start-bal" value="${fmt(yrData.startingBalance||0)}"
                onchange="updatePfStartingBalance(this.value)"
                oninput="this.classList.add('modified');showPfSave()"
                style="width:180px;padding:7px 10px;font-size:13px;font-weight:600">
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn btn-sm" onclick="syncPfFromPipeline()" style="display:flex;align-items:center;gap:5px">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5"/><path d="M10 2h4v4"/></svg>Sync from Pipeline
              </button>
              <div style="font-size:11px;color:var(--text-3)">Clears manual overrides · uses deal data</div>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="card">
          <div class="card-header">
            <div><div class="card-title">Pipeline Cash Flow — Direct Input</div><div class="card-desc">Pipeline Inflow auto-computed from deals · override per month if needed</div></div>
          </div>
          <div style="overflow-x:auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Opening <span class="badge-auto">auto</span></th>
                  <th>Closed Won <span class="badge-auto">auto</span></th>
                  <th>Open Weighted <span class="badge-auto">auto</span></th>
                  <th>Outflow <span class="badge-manual">manual</span></th>
                  <th>Net <span class="badge-auto">auto</span></th>
                  <th>Closing <span class="badge-auto">auto</span></th>
                </tr>
              </thead>
              <tbody>${rows.map((r, i) => {
                const wonDeals = r.deals.filter(d => d.stage === 'Closed Won');
                const openDeals = r.deals.filter(d => d.stage !== 'Closed Won');
                return `
                <tr style="${r.overridden ? 'background:rgba(255,102,0,0.03)' : ''}">
                  <td><strong>${r.month}</strong>${r.deals.length ? `<span style="margin-left:6px;font-size:10px;background:var(--primary-bg);color:var(--primary);border-radius:10px;padding:1px 6px">${r.deals.length}d</span>` : ''}</td>
                  <td style="color:var(--text-2)">${fmt(r.opening)}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:6px">
                      <input class="input input-cell" type="text"
                        value="${fmt(r.wonValue)}"
                        placeholder="${fmt(r.pipeWon)}"
                        onchange="updatePfRow(${i},'wonOverride',this.value)"
                        oninput="this.classList.add('modified');showPfSave()"
                        style="${r.wonOverridden ? 'border-color:var(--success)' : ''}">
                      ${r.wonOverridden ? `<button title="Reset to pipeline" onclick="resetPfWon(${i})" style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:14px;padding:0;line-height:1">↺</button>` : ''}
                    </div>
                    ${!r.wonOverridden && wonDeals.length > 0 ? `<div style="font-size:9px;color:var(--text-3);margin-top:2px">${wonDeals.length} won deal${wonDeals.length>1?'s':''}</div>` : ''}
                  </td>
                  <td>
                    <div style="display:flex;align-items:center;gap:6px">
                      <input class="input input-cell" type="text"
                        value="${fmt(r.wtdValue)}"
                        placeholder="${fmt(r.pipeOpenWtd)}"
                        onchange="updatePfRow(${i},'inflowOverride',this.value)"
                        oninput="this.classList.add('modified');showPfSave()"
                        style="${r.wtdOverridden ? 'border-color:var(--primary)' : ''}">
                      ${r.wtdOverridden ? `<button title="Reset to pipeline" onclick="resetPfInflow(${i})" style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:14px;padding:0;line-height:1">↺</button>` : ''}
                    </div>
                    ${!r.wtdOverridden && openDeals.length > 0 ? `<div style="font-size:9px;color:var(--text-3);margin-top:2px">${openDeals.length} deal${openDeals.length>1?'s':''} · weighted</div>` : ''}
                  </td>
                  <td><input class="input input-cell" type="text" value="${fmt(r.outflow)}" onchange="updatePfRow(${i},'outflow',this.value)" oninput="this.classList.add('modified');showPfSave()"></td>
                  <td class="${r.net>=0?'val-pos':'val-neg'}">${r.net>=0?'+':''}${fmt(r.net)}</td>
                  <td style="color:var(--success);font-weight:600">${fmt(r.closing)}</td>
                </tr>`}).join('')}
              </tbody>
              <tfoot>
                <tr style="background:var(--surface-2);font-weight:700;border-top:2px solid var(--border)">
                  <td style="padding:8px 12px">Total</td>
                  <td style="color:var(--text-2)">—</td>
                  <td style="color:var(--success)">${fmt(rows.reduce((a,r)=>a+r.wonValue,0))}</td>
                  <td style="color:var(--success)">${fmt(rows.reduce((a,r)=>a+r.wtdValue,0))}</td>
                  <td style="color:var(--danger-text)">${fmt(totalOutflow)}</td>
                  <td class="${(totalInflow-totalOutflow)>=0?'val-pos':'val-neg'}">${(totalInflow-totalOutflow)>=0?'+':''}${fmt(totalInflow-totalOutflow)}</td>
                  <td style="color:var(--success);font-weight:800">${fmt(closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div class="save-bar" id="pf-savebar">
            <span class="save-hint">⚠ Unsaved changes</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm" onclick="discardPfForecast()">Discard</button>
              <button class="btn btn-primary btn-sm" onclick="savePfForecast()">Save</button>
            </div>
          </div>
        </div>

      </div>
    </div>

  </div>`;

  setTimeout(() => {
    const labels = rows.map(r => r.month.split(' ')[0]);

    // CF-style chart (inflow bars + outflow bars + closing line)
    if (document.getElementById('chart-pf-cf')) {
      mkChart('chart-pf-cf', 'bar', {
        labels,
        datasets: [
          { label: 'Pipeline Inflow', type: 'bar',  data: rows.map(r => r.inflow),  backgroundColor: '#FF6600', borderRadius: 4 },
          { label: 'Outflow',         type: 'bar',  data: rows.map(r => r.outflow), backgroundColor: '#94A3B8', borderRadius: 4 },
          { label: 'Closing',         type: 'line', data: rows.map(r => r.closing), borderColor: '#16A34A', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#16A34A', tension: 0.3 }
        ]
      });
    }

    // Overlay chart (closing line + pipeline weighted bars + projected dashed line)
    if (document.getElementById('chart-pf-overlay')) {
      mkChart('chart-pf-overlay', 'bar', {
        labels,
        datasets: [
          { label: 'Closing Balance', type: 'line', data: rows.map(r => r.closing), borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.08)', fill: true, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#16A34A', tension: 0.35, order: 1 },
          { label: 'Projected (+Wtd)', type: 'line', data: rows.map(r => r.closing + r.pipeWtd - r.inflow), borderColor: '#2563EB', backgroundColor: 'transparent', borderDash: [6, 4], borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#2563EB', tension: 0.35, order: 2 },
          { label: 'Pipeline Weighted', type: 'bar', data: rows.map(r => r.pipeWtd), backgroundColor: 'rgba(37,99,235,0.45)', borderRadius: 4, order: 3 }
        ]
      });
    }
  }, 50);
}

// ── Pipeline Forecast helpers ──────────────────────────────────────────────────

function _pfEnsureYear(yr) {
  if (!state.pfForecast[yr]) state.pfForecast[yr] = { startingBalance: 0, rows: [] };
  return state.pfForecast[yr];
}

function _pfEnsureRow(yrData, key) {
  let row = yrData.rows.find(r => r.month === key);
  if (!row) { row = { month: key, inflowOverride: null, wonOverride: null, outflow: 0 }; yrData.rows.push(row); }
  return row;
}

function updatePfRow(i, field, val) {
  const yr = state.cfYear;
  const yrData = _pfEnsureYear(yr);
  const key = MO[i] + ' ' + yr;
  const row = _pfEnsureRow(yrData, key);
  const n = Number(String(val).replace(/[^0-9.-]/g, '')) || 0;
  if (field === 'inflowOverride') row.inflowOverride = n;
  else if (field === 'wonOverride')  row.wonOverride  = n;
  else if (field === 'outflow')      row.outflow      = n;
  showPfSave();
}

function resetPfInflow(i) {
  const yr = state.cfYear;
  const yrData = _pfEnsureYear(yr);
  const key = MO[i] + ' ' + yr;
  const row = yrData.rows.find(r => r.month === key);
  if (row) row.inflowOverride = null;
  showPfSave();
  render();
}

function resetPfWon(i) {
  const yr = state.cfYear;
  const yrData = _pfEnsureYear(yr);
  const key = MO[i] + ' ' + yr;
  const row = yrData.rows.find(r => r.month === key);
  if (row) row.wonOverride = null;
  showPfSave();
  render();
}

function updatePfStartingBalance(val) {
  const yr = state.cfYear;
  _pfEnsureYear(yr).startingBalance = Number(String(val).replace(/[^0-9.-]/g, '')) || 0;
  showPfSave();
}

function showPfSave() {
  document.getElementById('pf-savebar')?.classList.add('visible');
}

async function savePfForecast() {
  try {
    await apiCall('/pipeline/forecast-cashflow', { method: 'PUT', body: JSON.stringify(state.pfForecast) });
    toast('Pipeline forecast saved');
    render();
  } catch(e) { toast('Error: ' + e.message); }
}

async function discardPfForecast() {
  try { state.pfForecast = await apiCall('/pipeline/forecast-cashflow'); } catch(e) {}
  render();
}

async function syncPfFromPipeline() {
  const yr = state.cfYear;
  const yrData = _pfEnsureYear(yr);
  yrData.rows.forEach(r => { r.inflowOverride = null; r.wonOverride = null; });
  showPfSave();
  render();
  toast('Inflow overrides cleared — pipeline data applied');
}

let _cfDetailIdx = null;
function openCfDetail(i) {
  _cfDetailIdx = i;
  if (!state.cashflow[i].details) state.cashflow[i].details = [];
  renderCfDetailModal(i);
  openModal('modal-cf-detail');
}

function renderCfDetailModal(i) {
  const r=state.cashflow[i], net=r.inflow-r.outflow, cl=r.opening+net;
  const details=r.details||[];
  const inItems=details.filter(d=>d.type==='inflow');
  const outItems=details.filter(d=>d.type==='outflow');
  const inSum=inItems.reduce((a,d)=>a+d.amount,0);
  const outSum=outItems.reduce((a,d)=>a+d.amount,0);
  document.getElementById('cf-detail-title').textContent=`${r.month} — Cash Flow Details`;
  document.getElementById('cf-detail-content').innerHTML=`
    <div class="grid-3" style="margin-bottom:14px">
      <div class="metric"><div class="metric-label">Opening Balance</div><div class="metric-value">${fmt(r.opening)}</div></div>
      <div class="metric"><div class="metric-label">Net Movement</div><div class="metric-value ${net>=0?'val-pos':'val-neg'}">${net>=0?'+':''}${fmt(net)}</div></div>
      <div class="metric" style="background:var(--success-bg)"><div class="metric-label">Closing Balance</div><div class="metric-value" style="color:var(--success)">${fmt(cl)}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <div id="cf-in-header" style="font-size:11px;font-weight:700;color:var(--success-text);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">↑ Inflows (${fmt(inSum||r.inflow)})</div>
        <div id="cf-in-list">${inItems.map((d,di)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid var(--border);font-size:12px">
          <span style="flex:1">${d.description}</span>
          <span class="val-pos" style="font-weight:600">${fmt(d.amount)}</span>
          <button class="del-btn" style="margin-left:6px" onclick="cfRemove(${di},'inflow')">×</button>
        </div>`).join('')||'<div style="font-size:11px;color:var(--text-3);padding:5px 0">No items yet</div>'}</div>
        ${inSum<r.inflow&&inSum>0?`<div style="font-size:10px;color:var(--warning-text);margin-top:4px">⚠ Items total ${fmt(inSum)} vs ${fmt(r.inflow)} recorded</div>`:''}
        <div style="margin-top:8px;display:flex;gap:6px">
          <input class="input" id="cf-in-desc" placeholder="e.g. Client payment" style="flex:2;font-size:11px" onkeydown="if(event.key==='Enter'){cfAdd('inflow')}">
          <input class="input" id="cf-in-amt" type="number" placeholder="Amount" style="width:90px;font-size:11px" onkeydown="if(event.key==='Enter'){cfAdd('inflow')}">
          <button class="btn btn-primary btn-sm" onclick="cfAdd('inflow')">+</button>
        </div>
      </div>
      <div>
        <div id="cf-out-header" style="font-size:11px;font-weight:700;color:var(--danger-text);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">↓ Outflows (${fmt(outSum||r.outflow)})</div>
        <div id="cf-out-list">${outItems.map((d,di)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid var(--border);font-size:12px">
          <span style="flex:1">${d.description}</span>
          <span class="val-neg" style="font-weight:600">${fmt(d.amount)}</span>
          <button class="del-btn" style="margin-left:6px" onclick="cfRemove(${di},'outflow')">×</button>
        </div>`).join('')||'<div style="font-size:11px;color:var(--text-3);padding:5px 0">No items yet</div>'}</div>
        ${outSum<r.outflow&&outSum>0?`<div style="font-size:10px;color:var(--warning-text);margin-top:4px">⚠ Items total ${fmt(outSum)} vs ${fmt(r.outflow)} recorded</div>`:''}
        <div style="margin-top:8px;display:flex;gap:6px">
          <input class="input" id="cf-out-desc" placeholder="e.g. Payroll, AWS" style="flex:2;font-size:11px" onkeydown="if(event.key==='Enter'){cfAdd('outflow')}">
          <input class="input" id="cf-out-amt" type="number" placeholder="Amount" style="width:90px;font-size:11px" onkeydown="if(event.key==='Enter'){cfAdd('outflow')}">
          <button class="btn btn-danger btn-sm" onclick="cfAdd('outflow')">+</button>
        </div>
      </div>
    </div>
    <div class="save-bar visible" style="margin-top:0"><span class="save-hint">Items save instantly · Save syncs inflow/outflow totals to the table</span><button class="btn btn-primary btn-sm" onclick="saveCfDetails()">Save &amp; Close</button></div>`;
}

// Use _cfDetailIdx (set on modal open) — avoids i-through-innerHTML bugs
async function cfAdd(type) {
  const pfx = type==='inflow' ? 'in' : 'out';
  const descEl = document.getElementById(`cf-${pfx}-desc`);
  const amtEl  = document.getElementById(`cf-${pfx}-amt`);
  const desc = descEl?.value.trim();
  const amt  = Number(amtEl?.value) || 0;
  if (!desc || !amt) { toast('Enter description and amount'); return; }
  const i = _cfDetailIdx;
  if (!state.cashflow[i].details) state.cashflow[i].details = [];
  state.cashflow[i].details.push({ id: Date.now(), description: desc, amount: amt, type });
  // Clear inputs
  if (descEl) descEl.value = '';
  if (amtEl)  amtEl.value  = '';
  // Update list in DOM without full re-render
  _cfRefreshList(i, type);
  // Save to server
  try { await apiCall(`/cashflow${_yq()}`,{method:'PUT',body:JSON.stringify({cashflow:state.cashflow})}); }
  catch(e){ toast('Save failed: '+e.message); }
}

async function cfRemove(di, type) {
  const i = _cfDetailIdx;
  const items = state.cashflow[i].details.filter(d=>d.type===type);
  const targetId = items[di]?.id;
  state.cashflow[i].details = state.cashflow[i].details.filter(d=>d.id!==targetId);
  _cfRefreshList(i, type);
  try { await apiCall(`/cashflow${_yq()}`,{method:'PUT',body:JSON.stringify({cashflow:state.cashflow})}); }
  catch(e){ toast('Save failed: '+e.message); }
}

async function saveCfDetails() {
  const i = _cfDetailIdx;
  if (i === null) return;
  const details = state.cashflow[i].details || [];
  const inSum  = details.filter(d => d.type === 'inflow').reduce((a, d) => a + d.amount, 0);
  const outSum = details.filter(d => d.type === 'outflow').reduce((a, d) => a + d.amount, 0);
  if (inSum > 0)  state.cashflow[i].inflow  = inSum;
  if (outSum > 0) state.cashflow[i].outflow = outSum;
  recalcCashflow();
  try {
    await apiCall(`/cashflow${_yq()}`, { method: 'PUT', body: JSON.stringify({ cashflow: state.cashflow }) });
    toast('Cash flow saved');
    closeModal('modal-cf-detail');
    state.cfTab = 'cf-edit';
    render();
  } catch(e) { toast('Error: ' + e.message); }
}

function _cfRefreshList(i, type) {
  const pfx = type==='inflow' ? 'in' : 'out';
  const listEl = document.getElementById(`cf-${pfx}-list`);
  if (!listEl) return;
  const items = (state.cashflow[i].details||[]).filter(d=>d.type===type);
  const col = type==='inflow' ? 'val-pos' : 'val-neg';
  listEl.innerHTML = items.length
    ? items.map((d,di)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid var(--border);font-size:12px">
        <span style="flex:1">${d.description}</span>
        <span class="${col}" style="font-weight:600">${fmt(d.amount)}</span>
        <button class="del-btn" style="margin-left:6px" onclick="cfRemove(${di},'${type}')">×</button>
      </div>`).join('')
    : '<div style="font-size:11px;color:var(--text-3);padding:5px 0">No items yet</div>';
  const sum = items.reduce((a,d)=>a+d.amount, 0);
  const headerEl = document.getElementById(`cf-${pfx}-header`);
  if (headerEl) headerEl.textContent = type==='inflow' ? `↑ Inflows (${fmt(sum)})` : `↓ Outflows (${fmt(sum)})`;
}

// Keep old names as aliases so any stale onclick in DOM still works
function addCfDetailItem(i,type){_cfDetailIdx=i;cfAdd(type);}
function removeCfDetailItem(i,di,type){_cfDetailIdx=i;cfRemove(di,type);}

function changeCfYear(y) { state.cfYear=Number(y); state.fiscalYear=Number(y); loadAll().then(()=>render()); }
async function changeYear(delta) {
  const newYear = state.fiscalYear + delta;
  if (newYear < 2020 || newYear > 2035) return;
  await setFiscalYear(newYear);
}
async function setFiscalYear(yr) {
  yr = Number(yr);
  if (yr < 2020 || yr > 2035) return;
  state.fiscalYear = yr; state.cfYear = yr; state.calYear = yr;
  try { await loadAll(); render(); } catch(e) { toast('Error loading FY '+yr); }
}
function yearNavHTML() {
  const cur = new Date().getFullYear();
  const fy  = state.fiscalYear;
  const btnStyle = (active) => `background:${active?'var(--primary)':'none'};color:${active?'#fff':'var(--text-2)'};border:none;cursor:pointer;font-size:11px;font-weight:${active?'700':'500'};padding:3px 8px;border-radius:6px;line-height:1.4;transition:background .12s`;
  return `<div style="display:inline-flex;align-items:center;gap:2px;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:3px">
    <button onclick="changeYear(-1)" style="${btnStyle(false)};font-size:13px;padding:3px 7px" title="Previous year">‹</button>
    <button onclick="setFiscalYear(${cur-1})" style="${btnStyle(fy===cur-1)}">${cur-1}</button>
    <button onclick="setFiscalYear(${cur})"   style="${btnStyle(fy===cur)}">Current</button>
    <button onclick="setFiscalYear(${cur+1})" style="${btnStyle(fy===cur+1)}">${cur+1}</button>
    ${fy < cur-1 || fy > cur+1 ? `<span style="font-size:11px;font-weight:700;color:var(--primary);padding:3px 8px;background:var(--primary-bg);border-radius:6px">FY ${fy}</span>` : ''}
    <button onclick="changeYear(1)"  style="${btnStyle(false)};font-size:13px;padding:3px 7px" title="Next year">›</button>
    <button onclick="openYearPicker()" style="${btnStyle(false)};font-size:10px;padding:3px 7px;color:var(--text-3)" title="Custom year">…</button>
  </div>`;
}
function openYearPicker() {
  const yr = prompt('Enter fiscal year (2020–2035):', state.fiscalYear);
  if (yr && !isNaN(yr)) setFiscalYear(Number(yr));
}
function updateCashflow(i,field,val) { const n=parseInt(String(val).replace(/[^0-9-]/g,'')); if(!isNaN(n)) state.cashflow[i][field]=n; recalcCashflow(); }
function showCfSave() { document.getElementById('cf-savebar')?.classList.add('visible'); }
async function saveCashflow() { try { await apiCall(`/cashflow${_yq()}`,{method:'PUT',body:JSON.stringify({cashflow:state.cashflow})}); toast('Cash flow saved'); state.cfTab='cf-edit'; render(); } catch(e) { toast('Error: '+e.message); } }
function discardCashflow() { loadAll().then(render); }
async function syncCfOpeningBalance() {
  const totalCash = state.banks.reduce((a,b)=>a+(b.balance||b.total||0),0);
  const reserved  = state.reserves.reduce((a,r)=>a+r.amount,0);
  const available = totalCash - reserved;
  if (!state.cashflow.length) { toast('No cash flow rows to update'); return; }
  state.cashflow[0].opening = available;
  recalcCashflow();
  try {
    await apiCall(`/cashflow${_yq()}`, {method:'PUT', body:JSON.stringify({cashflow:state.cashflow})});
    render();
    toast(`Opening balance synced to ${fmt(available)} (available cash)`);
  } catch(e) { toast('Sync failed: '+e.message); }
}

async function downloadExcelTemplate(type) {
  try {
    const res = await fetch(`/api/${type}/download-template`, { headers: { 'Authorization': 'Bearer ' + state.token } });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${type}-template.xlsx`; a.click();
    URL.revokeObjectURL(url);
  } catch(e) { toast('Template download failed: ' + e.message); }
}
let _cfMapTempId = null;
let _cfMapSheets = [];

async function uploadCfExcel(inp) {
  if (!inp.files[0]) return;
  const fd = new FormData(); fd.append('file', inp.files[0]);
  inp.value = '';
  try {
    const res  = await fetch('/api/cashflow/preview-excel', { method:'POST', headers:{ 'Authorization':'Bearer '+state.token }, body:fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    _cfMapTempId  = data.tempId;
    _cfMapSheets  = data.sheets;
    _cfMapOpen();
  } catch(e) { toast('Upload failed: ' + e.message); }
}

function _cfMapOpen() {
  const sheetSel = document.getElementById('cf-map-sheet');
  sheetSel.innerHTML = _cfMapSheets.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  _cfMapPopulate(_cfMapSheets[0]);
  openModal('modal-cf-col-map');
}

function _cfMapPopulate(sheet) {
  if (!sheet) return;
  const cols = sheet.cols;
  function fillSel(id, auto, allowNone) {
    const sel = document.getElementById(id);
    const none = allowNone ? '<option value="__none__">— none —</option>' : '';
    sel.innerHTML = none + cols.map(c => `<option value="${c}">${c}</option>`).join('');
    const found = cols.find(c => auto.some(a => c.toLowerCase().includes(a)));
    if (found) sel.value = found;
    else if (allowNone) sel.value = '__none__';
    else sel.value = cols[0] || '';
  }
  fillSel('cf-map-month', ['month','date','period'], false);
  fillSel('cf-map-type',  ['type','direction','flow','in/out'], true);
  fillSel('cf-map-desc',  ['desc','name','item','label','source','from'], true);
  fillSel('cf-map-amt',   ['amount','amt','value','total','sum'], false);
  _cfMapRenderPreview(sheet);
}

function cfMapSheetChanged() {
  const name  = document.getElementById('cf-map-sheet').value;
  const sheet = _cfMapSheets.find(s => s.name === name);
  if (sheet) _cfMapPopulate(sheet);
}

function _cfMapRenderPreview(sheet) {
  const rows = sheet.preview;
  if (!rows.length) { document.getElementById('cf-map-preview').innerHTML = '<div style="font-size:11px;color:var(--text-2)">No data</div>'; return; }
  const cols = sheet.cols;
  const html = `<table class="table" style="font-size:11px">
    <thead><tr>${cols.map(c=>`<th style="white-space:nowrap">${c}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td style="white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis">${r[c]??''}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
  document.getElementById('cf-map-preview').innerHTML = html;
}

async function confirmCfImport() {
  const sheet   = document.getElementById('cf-map-sheet').value;
  const monthCol= document.getElementById('cf-map-month').value;
  const typeCol = document.getElementById('cf-map-type').value;
  const descCol = document.getElementById('cf-map-desc').value;
  const amtCol  = document.getElementById('cf-map-amt').value;
  const btn = document.getElementById('cf-map-import-btn');
  btn.disabled = true; btn.textContent = 'Importing…';
  const statusEl = document.getElementById('cf-map-status');
  statusEl.style.display = 'none';
  try {
    const body = new URLSearchParams({ tempId:_cfMapTempId, sheet, monthCol, typeCol:typeCol==='__none__'?'':typeCol, descCol:descCol==='__none__'?'':descCol, amtCol });
    const res  = await fetch(`/api/cashflow/upload-excel${_yq()}`, { method:'POST', headers:{ 'Authorization':'Bearer '+state.token, 'Content-Type':'application/x-www-form-urlencoded' }, body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    closeModal('modal-cf-col-map');
    await loadAll(); render();
    if (window.LottieUI) LottieUI.showAlert('Import Complete', `<strong>${data.imported} rows</strong> imported from <em>"${sheet}"</em>`, 'success');
    else toast(`Imported ${data.imported} rows from "${sheet}"`);
  } catch(e) {
    statusEl.textContent = e.message; statusEl.style.display = 'block';
    if (window.LottieUI) LottieUI.showAlert('Import Failed', e.message, 'error');
  } finally { btn.disabled = false; btn.textContent = '⬆ Import'; }
}

// ── Budget ────────────────────────────────────────────────────────────────────
function budgetCurrentMonth() { return MO[TODAY.getMonth()]; }
function renderBudget(c) {
  const curMo=budgetCurrentMonth();
  const totalAnnual=state.budget.reduce((a,b)=>a+budgetAnnual(b),0);
  const totalActual=state.budget.reduce((a,b)=>a+(b.months?.[curMo]?.actual||0),0);
  const budFilled=state.budget.filter(b=>b.cat&&b.cat.trim()&&b.cat!=='New Category'||budgetAnnual(b)>0);
  const budLabels=budFilled.map(b=>b.cat);
  const budActuals=budFilled.map(b=>b.months?.[curMo]?.actual||0);
  const budTargets=budFilled.map(b=>b.months?.[curMo]?.target||Math.round(budgetAnnual(b)/12));

  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab ${state.budgetTab!=='bud-edit'?'active':''}" onclick="state.budgetTab='bud-charts';switchView(this,'bud-charts')">Charts</button>
      <button class="view-tab ${state.budgetTab==='bud-edit'?'active':''}" onclick="state.budgetTab='bud-edit';switchView(this,'bud-edit')">Edit — Monthly Breakdown</button>
    </div>
    <div class="view-panel ${state.budgetTab!=='bud-edit'?'active':''}" id="bud-charts">
      ${(()=>{
        const moTarget = Math.round(totalAnnual/12);
        const overBudget = moTarget > 0 && totalActual > moTarget * 1.05;
        const pctUsed = moTarget > 0 ? Math.round(totalActual/moTarget*100) : 0;
        return `<div class="grid-3" style="margin-bottom:12px">
          <div class="metric"><div class="metric-label">Annual Budget</div><div class="metric-value">${fmt(totalAnnual)}</div></div>
          <div class="metric${overBudget?' ':' '}"><div class="metric-label">Actual ${curMo}</div><div class="metric-value" style="color:${overBudget?'var(--danger)':totalActual>0?'var(--text)':'var(--text-3)'}">${fmt(totalActual)}</div><div class="metric-sub">${pctUsed}% of monthly target${overBudget?' — <span style="color:var(--danger);font-weight:700">OVER</span>':''}</div></div>
          <div class="metric"><div class="metric-label">Monthly Target</div><div class="metric-value">${fmt(moTarget)}</div><div class="metric-sub">${Math.round(totalAnnual/12)?Math.round(totalAnnual/12/totalAnnual*100)+'% of annual':'—'}</div></div>
        </div>`;
      })()}
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">Budget vs Actual — ${curMo}</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-bud-bar"></canvas></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Expense Distribution</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-bud-donut"></canvas></div></div>
      </div>
    </div>
    <div class="view-panel ${state.budgetTab==='bud-edit'?'active':''}" id="bud-edit">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Budget — FY ${state.fiscalYear}</div>
            <div class="card-desc">Click ▾ Monthly on any row to set per-month targets &amp; actuals · Annual auto-calculates from months</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm" style="font-size:11px;color:var(--primary);border-color:var(--primary-bg)" onclick="openAI('budget')">✦ Ask Ayla</button>
            <button class="btn btn-sm" onclick="downloadExcelTemplate('budget')">📋 Template</button>
            <label class="btn btn-sm" style="cursor:pointer">⬆ Excel<input type="file" accept=".xlsx,.xls" style="display:none" onchange="uploadBudgetExcel(this)"></label>
            <button class="btn btn-sm" onclick="syncSource('/budget/sync','QuickBooks')">↻ Sync</button>
            <button class="btn btn-sm" onclick="cleanBudgetRows()" title="Delete all unnamed/empty rows">🧹 Clean Empty</button>
            <button class="btn btn-sm" onclick="openBudgetMapping()" title="Map budget categories to P&L rows">⇄ P&L Map</button>
            <button class="btn btn-primary btn-sm" onclick="addBudgetRow()">+ Row</button>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr>
              <th style="min-width:140px">Category</th>
              <th>Annual <span class="badge-auto">auto</span></th>
              <th>YoY <span style="font-size:9px;color:var(--text-3);font-weight:400">vs ${state.fiscalYear-1}</span></th>
              <th>${curMo} Target <span class="badge-manual">edit</span></th>
              <th>${curMo} Actual <span class="badge-qbo">QBO</span></th>
              <th>vs Budget</th>
              <th>Status</th>
              <th></th>
            </tr></thead>
            <tbody id="budget-tbody">${renderBudgetRows(curMo)}</tbody>
          </table>
        </div>
        <div class="save-bar" id="bud-savebar">
          <span class="save-hint">⚠ Unsaved changes</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm" onclick="discardBudget()">Discard</button>
            <button class="btn btn-primary btn-sm" onclick="saveBudget()">Save All</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  setTimeout(()=>{
    mkChart('chart-bud-bar','bar',{
      labels:budLabels,
      datasets:[
        {label:'Target',data:budTargets,backgroundColor:'rgba(37,99,235,0.18)',borderRadius:4,borderWidth:1.5,borderColor:'rgba(37,99,235,0.45)',borderSkipped:false},
        {label:'Actual',data:budActuals,backgroundColor:budActuals.map((v,i)=>v>budTargets[i]?'#DC2626':'#FF6600'),borderRadius:4}
      ]
    },{
      indexAxis:'y',
      scales:{
        x:{ ticks:{callback:v=>fmt(v),font:{size:10},color:'#5E6C84'}, grid:{color:'rgba(0,0,0,0.05)'} },
        y:{ reverse:false, ticks:{font:{size:10},color:'#5E6C84'}, grid:{display:false} }
      }
    });
    const colors=['#FF6600','#2563EB','#16A34A','#7C3AED','#D97706','#DC2626','#0891B2','#059669'];
    mkDoughnut('chart-bud-donut',budLabels,budActuals,colors.slice(0,budLabels.length));
  },50);
}

// Returns the annual budget for a row — always derived from sum of monthly targets if months exist
function budgetAnnual(r) {
  if (!r.months) return r.annual||0;
  const fromMonths = Object.values(r.months).reduce((s,m)=>s+(m.target||0),0);
  return fromMonths>0 ? fromMonths : (r.annual||0);
}

function renderBudgetRows(curMo) {
  return state.budget.map((r,i)=>{
    const annual = budgetAnnual(r);
    const moTgt  = r.months?.[curMo]?.target || Math.round(annual/12);
    const moAct  = r.months?.[curMo]?.actual || 0;
    const pct    = moTgt ? Math.round((moAct/moTgt)*100) : 0;
    const over   = pct > 100;
    const expanded = state.budgetExpanded.has(i);
    const ytdAct = MO.slice(0, MO.indexOf(curMo)+1).reduce((s,m)=>s+(r.months?.[m]?.actual||0),0);
    const prevRow = (state.prevBudget||[]).find(p=>p.cat&&p.cat.toLowerCase()===r.cat.toLowerCase());
    const prevAnnual = prevRow ? budgetAnnual(prevRow) : 0;
    const yoyPct = prevAnnual ? Math.round(((annual-prevAnnual)/prevAnnual)*100) : null;
    const yoyCell = yoyPct===null
      ? `<td style="font-size:10px;color:var(--text-3)">—</td>`
      : `<td style="font-size:11px;font-weight:600;color:${yoyPct>0?'var(--danger)':yoyPct<0?'var(--success)':'var(--text-3)'}">${yoyPct>0?'+':''}${yoyPct}%</td>`;

    const pnlMap=_getBudgetPnlMap();
    const pnlAlias=pnlMap[r.cat]||'';
    const summaryRow = `<tr id="brow-${i}" style="border-left:3px solid ${over?'var(--danger)':moAct>0?'var(--success)':'var(--border)'}">
      <td>
        <span class="editable-cat" style="cursor:pointer;border-bottom:1px dashed var(--border-2);padding-bottom:1px" onclick="editBudgetCat(${i},this)">${r.cat}</span>
        ${pnlAlias?`<div style="font-size:9px;color:var(--info);margin-top:1px">⇄ ${pnlAlias}</div>`:''}
        ${r.note?`<div style="font-size:10px;color:var(--text-3);margin-top:1px">${r.note}</div>`:''}
      </td>
      <td id="brow-annual-${i}" style="font-weight:600;color:var(--text-2)">${fmt(annual)}</td>
      ${yoyCell}
      <td><input class="input input-cell" type="text" value="${fmt(moTgt)}"
        onchange="updateBudgetMonthTarget(${i},'${curMo}',this.value)"
        oninput="showBudSave()" style="width:88px"></td>
      <td><input class="input input-cell" type="text" value="${fmt(moAct)}"
        onchange="updateMonthActual(${i},'${curMo}',this.value)"
        oninput="showBudSave()" style="width:88px"></td>
      <td class="${over?'val-neg':'val-pos'}" style="font-size:11px">${over?'+'+(fmt(moAct-moTgt)):'−'+(fmt(moTgt-moAct))}</td>
      <td>
        <div style="display:flex;align-items:center;gap:5px">
          <div class="progress-track"><div class="progress-fill${over?' over':''}" style="width:${Math.min(pct,100)}%"></div></div>
          <span style="font-size:10px;${over?'color:var(--danger)':moAct>0?'color:var(--success)':'color:var(--text-3)'}">${pct}%</span>
        </div>
        <div style="font-size:9px;color:var(--text-3);margin-top:2px">YTD: ${fmt(ytdAct)}</div>
      </td>
      <td>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;white-space:nowrap" onclick="toggleBudgetExpand(${i})">
            ${expanded?'▲ Hide':'▾ Monthly'}
          </button>
          <button class="del-btn" onclick="deleteBudgetRow(${r.id})">×</button>
        </div>
      </td>
    </tr>`;

    const expandedRow = expanded ? `<tr id="brow-exp-${i}">
      <td colspan="8" style="padding:0;background:var(--bg);border-bottom:2px solid var(--primary-bg)">
        <div style="padding:14px 18px">
          <div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">
            ${r.cat} — Monthly Budget Plan
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:11px">
              <thead>
                <tr style="background:var(--surface)">
                  <th style="padding:7px 10px;text-align:left;font-weight:600;color:var(--text-2);border-bottom:1px solid var(--border);min-width:60px">Month</th>
                  ${MO.map(m=>`<th style="padding:7px 8px;text-align:center;font-weight:600;color:var(--text-2);border-bottom:1px solid var(--border);min-width:90px;${m===curMo?'background:var(--primary-bg);color:var(--primary)':''}">${m}</th>`).join('')}
                  <th style="padding:7px 10px;text-align:right;font-weight:700;color:var(--text);border-bottom:1px solid var(--border);min-width:100px">Annual Total</th>
                </tr>
              </thead>
              <tbody>
                <tr style="background:var(--surface)">
                  <td style="padding:8px 10px;font-weight:600;color:var(--text-2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Target <span class="badge-manual" style="margin-left:3px">edit</span></td>
                  ${MO.map(m=>{
                    const t=r.months?.[m]?.target||Math.round(annual/12);
                    return `<td style="padding:4px 4px;text-align:center;${m===curMo?'background:rgba(255,102,0,0.05)':''}">
                      <input class="input input-cell" type="text" value="${fmt(t)}" style="width:84px;text-align:right;font-size:11px"
                        onchange="updateBudgetMonthTarget(${i},'${m}',this.value)"
                        oninput="showBudSave()">
                    </td>`;
                  }).join('')}
                  <td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--primary)" id="brow-annual-exp-${i}">${fmt(annual)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 10px;font-weight:600;color:var(--text-2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Actual <span class="badge-qbo" style="margin-left:3px">QBO</span></td>
                  ${MO.map(m=>{
                    const a=r.months?.[m]?.actual||0;
                    const t=r.months?.[m]?.target||Math.round(annual/12);
                    const over=a>t&&a>0;
                    return `<td style="padding:4px 4px;text-align:center;${m===curMo?'background:rgba(255,102,0,0.05)':''}">
                      <input class="input input-cell" type="text" value="${a?fmt(a):'—'}" style="width:84px;text-align:right;font-size:11px;${over?'color:var(--danger)':a>0?'color:var(--success)':'color:var(--text-3)'}"
                        onchange="updateMonthActual(${i},'${m}',this.value)"
                        oninput="showBudSave()">
                    </td>`;
                  }).join('')}
                  <td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--success)">${fmt(Object.values(r.months||{}).reduce((s,m)=>s+(m.actual||0),0))}</td>
                </tr>
                <tr style="background:var(--surface)">
                  <td style="padding:6px 10px;font-size:10px;color:var(--text-3)">% Achieved</td>
                  ${MO.map(m=>{
                    const a=r.months?.[m]?.actual||0;
                    const t=r.months?.[m]?.target||Math.round(annual/12);
                    const p=t?Math.round((a/t)*100):0;
                    const over=p>100;
                    return `<td style="padding:6px 4px;text-align:center;font-size:10px;font-weight:600;${over?'color:var(--danger)':p>0?'color:var(--success)':'color:var(--text-3)'};${m===curMo?'background:rgba(255,102,0,0.05)':''}">${a>0?p+'%':'—'}</td>`;
                  }).join('')}
                  <td style="padding:6px 10px;text-align:right;font-size:10px;color:var(--text-3)">&nbsp;</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
            <button class="btn btn-primary btn-sm" onclick="saveBudgetRow(${i})">Save ${r.cat}</button>
            <div style="font-size:10px;color:var(--text-3)">Click any cell to edit · Changes auto-sum to Annual Total</div>
            <button class="btn btn-sm" style="margin-left:auto;font-size:10px" onclick="openMonthItemsFromRow(${i},event)">+ Line Items for Month…</button>
          </div>
        </div>
      </td>
    </tr>` : '';

    return summaryRow + expandedRow;
  }).join('');
}

function toggleBudgetExpand(i) {
  if (state.budgetExpanded.has(i)) state.budgetExpanded.delete(i);
  else state.budgetExpanded.add(i);
  document.getElementById('budget-tbody').innerHTML = renderBudgetRows(budgetCurrentMonth());
}

function editBudgetCat(i, el) {
  const old=el.textContent.trim();
  const inp=document.createElement('input');
  inp.className='input'; inp.value=old; inp.style.cssText='width:130px;font-size:12px';
  el.replaceWith(inp); inp.focus(); inp.select();
  const save=async()=>{ const val=inp.value.trim()||old; state.budget[i].cat=val; try { await apiCall(`/budget/${state.budget[i].id}${_yq()}`,{method:'PUT',body:JSON.stringify({cat:val})}); toast('Renamed'); } catch {} render(); };
  inp.onblur=save; inp.onkeydown=e=>{ if(e.key==='Enter') inp.blur(); if(e.key==='Escape'){inp.value=old;inp.blur();} };
}

function updateBudgetMonthTarget(i, month, val) {
  const n = parseInt(String(val).replace(/[^0-9]/g,''));
  if (isNaN(n) || !state.budget[i]) return;
  if (!state.budget[i].months) state.budget[i].months = {};
  if (!state.budget[i].months[month]) state.budget[i].months[month] = {target:0, actual:0, details:[]};
  state.budget[i].months[month].target = n;
  // Annual auto-recalcs from sum of all monthly targets
  const newAnnual = Object.values(state.budget[i].months).reduce((s,m)=>s+(m.target||0),0);
  state.budget[i].annual = newAnnual;
  // Update annual display cells without full re-render
  const annualCell = document.getElementById('brow-annual-'+i);
  if (annualCell) annualCell.textContent = fmt(newAnnual);
  const annualExpCell = document.getElementById('brow-annual-exp-'+i);
  if (annualExpCell) annualExpCell.textContent = fmt(newAnnual);
}

function updateMonthActual(i, m, val) {
  const n = parseInt(String(val).replace(/[^0-9]/g,''));
  if (isNaN(n) || !state.budget[i]) return;
  if (!state.budget[i].months) state.budget[i].months = {};
  if (!state.budget[i].months[m]) state.budget[i].months[m] = {target:0, actual:0, details:[]};
  state.budget[i].months[m].actual = n;
}

function showBudSave() { document.getElementById('bud-savebar')?.classList.add('visible'); }

async function addBudgetRow() {
  try { const r=await apiCall(`/budget${_yq()}`,{method:'POST',body:JSON.stringify({cat:'New Category',annual:0})}); state.budget.push(r.item); state.budgetTab='bud-edit'; render(); toast('Row added — click name to rename'); } catch(e) { toast(e.message); }
}
async function cleanBudgetRows() {
  const empty = state.budget.filter(b=>(!b.cat||b.cat.trim()==='New Category')&&budgetAnnual(b)===0);
  if (!empty.length) { toast('No empty rows to remove'); return; }
  showConfirm(`Remove ${empty.length} unnamed/empty budget row${empty.length>1?'s':''}?`, async ()=>{
    await Promise.all(empty.map(b=>apiCall(`/budget/${b.id}${_yq()}`,{method:'DELETE'})));
    state.budget=state.budget.filter(b=>!empty.find(e=>e.id===b.id));
    render(); toast(`Removed ${empty.length} empty row${empty.length>1?'s':''}`);
  });
}
async function deleteBudgetRow(id) {
  const b = state.budget.find(x=>x.id===id);
  showConfirm(`Delete budget category "${b?.cat||'this category'}"?`, async () => {
    await apiCall(`/budget/${id}${_yq()}`,{method:'DELETE'}); state.budget=state.budget.filter(b=>b.id!==id); render();
  });
}

async function saveBudget() {
  const yq=_yq();
  try {
    await Promise.all(state.budget.map(b=>
      apiCall(`/budget/${b.id}${yq}`,{method:'PUT',body:JSON.stringify({annual:budgetAnnual(b),cat:b.cat,note:b.note||''})})
        .then(()=>Promise.all(MO.map(m=>
          apiCall(`/budget/${b.id}/month/${m}${yq}`,{method:'PUT',body:JSON.stringify({
            target: b.months?.[m]?.target || Math.round(budgetAnnual(b)/12),
            actual: b.months?.[m]?.actual || 0
          })})
        )))
    ));
    document.getElementById('bud-savebar')?.classList.remove('visible');
    toast('Budget saved'); render();
  } catch(e) { toast('Error: '+e.message); }
}

async function saveBudgetRow(i) {
  const b = state.budget[i];
  const yq=_yq();
  try {
    await apiCall(`/budget/${b.id}${yq}`,{method:'PUT',body:JSON.stringify({annual:budgetAnnual(b),cat:b.cat,note:b.note||''})});
    await Promise.all(MO.map(m=>
      apiCall(`/budget/${b.id}/month/${m}${yq}`,{method:'PUT',body:JSON.stringify({
        target: b.months?.[m]?.target || Math.round(budgetAnnual(b)/12),
        actual: b.months?.[m]?.actual || 0
      })})
    ));
    toast(`${b.cat} saved`);
  } catch(e) { toast(e.message); }
}

function discardBudget() { state.budgetExpanded.clear(); loadAll().then(render); }

function _getBudgetPnlMap() { try { return JSON.parse(localStorage.getItem('budget_pnl_map'))||{}; } catch { return {}; } }
function _setBudgetPnlMap(m) { localStorage.setItem('budget_pnl_map', JSON.stringify(m)); }

function openBudgetMapping() {
  const map = _getBudgetPnlMap();
  const cats = state.budget.map(b=>b.cat).filter(Boolean);
  const pnlRows = (state.statements?.pnl?.rows||[]).filter(r=>r.cat&&!r.computed).map(r=>r.cat);
  const pnlOpts = (pnlRows.length ? pnlRows : ['Revenue','COGS','Salaries','Marketing','Software & Tools','Travel','Professional Fees','Other OpEx'])
    .map(r=>`<option value="${r.replace(/"/g,'&quot;')}">${r}</option>`).join('');

  const old=document.getElementById('bud-map-panel'); if(old) old.remove();
  const panel=document.createElement('div');
  panel.id='bud-map-panel';
  panel.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.52);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  panel.innerHTML=`
    <div style="background:var(--surface);border-radius:12px;padding:24px;max-width:540px;width:100%;max-height:82vh;overflow-y:auto;box-shadow:var(--shadow-lg)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div style="font-size:15px;font-weight:700">Budget → P&L Category Map</div>
        <button class="modal-close" onclick="document.getElementById('bud-map-panel').remove()">×</button>
      </div>
      <div style="font-size:11px;color:var(--text-2);margin-bottom:14px">Map each budget category to its P&L equivalent so budget-vs-actual variance can be computed accurately. Mappings are stored in your browser.</div>
      <table class="table" style="font-size:11px">
        <thead><tr><th>Budget Category</th><th>P&L Row</th></tr></thead>
        <tbody>${cats.map(cat=>{
          const cur=map[cat]||'';
          const safeId='bmap-'+cat.replace(/[^a-z0-9]/gi,'_');
          return `<tr>
            <td style="font-weight:600">${cat}</td>
            <td><select id="${safeId}" class="input" style="font-size:11px;padding:3px 7px;width:100%">
              <option value="">— No mapping —</option>
              ${pnlOpts.replace(`value="${cur.replace(/"/g,'&quot;')}"`,`value="${cur.replace(/"/g,'&quot;')}" selected`)}
            </select></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px">
        <button class="btn" onclick="document.getElementById('bud-map-panel').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="saveBudgetMapping()">Save Mapping</button>
      </div>
    </div>`;
  document.body.appendChild(panel);
}

function saveBudgetMapping() {
  const map={};
  state.budget.forEach(b=>{
    const safeId='bmap-'+b.cat.replace(/[^a-z0-9]/gi,'_');
    const sel=document.getElementById(safeId);
    if(sel&&sel.value) map[b.cat]=sel.value;
  });
  _setBudgetPnlMap(map);
  document.getElementById('bud-map-panel')?.remove();
  toast('P&L mapping saved — budget variance will now use these mappings');
}

// Opens line-item detail modal for a specific month from the expanded row
function openMonthItemsFromRow(budIdx, evt) {
  const select = `<select class="input" id="items-month-sel" style="margin-bottom:12px" onchange="openMonthDetails(${budIdx},this.value)">
    ${MO.map(m=>`<option value="${m}">${m}</option>`).join('')}
  </select>`;
  document.getElementById('bud-detail-title').textContent = state.budget[budIdx].cat+' — Select Month';
  document.getElementById('bud-detail-content').innerHTML = `<div style="font-size:12px;color:var(--text-2);margin-bottom:8px">Select the month to view/add line items:</div>${select}`;
  openModal('modal-budget-detail');
}

function openMonthDetails(budIdx, month) {
  const b=state.budget[budIdx];
  const mo=b.months?.[month]||{target:0,actual:0,details:[]};
  const dets=Array.isArray(mo.details)?mo.details:[];
  document.getElementById('bud-detail-title').textContent=`${b.cat} — ${month} ${state.fiscalYear} — Payment Details`;
  document.getElementById('bud-detail-content').innerHTML=`
    <div style="margin-bottom:10px;display:flex;gap:8px;font-size:11px"><span>Target: <strong>${fmt(mo.target)}</strong></span><span>Actual: <strong>${fmt(mo.actual)}</strong></span></div>
    <table class="table" style="margin-bottom:12px">
      <thead><tr><th>Vendor / Description</th><th>Amount</th><th>Date</th><th>Note</th><th></th></tr></thead>
      <tbody id="det-tbody">${dets.map(d=>`<tr><td>${d.vendor}</td><td>${fmt(d.amount)}</td><td>${d.date||'—'}</td><td style="color:var(--text-2)">${d.note||''}</td><td><button class="del-btn" onclick="deleteDetail(${budIdx},'${month}',${d.id})">×</button></td></tr>`).join('')}</tbody>
    </table>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <input class="input" id="det-vendor" placeholder="Vendor / description" style="flex:2;min-width:120px">
      <input class="input input-cell" id="det-amount" placeholder="Amount" type="number">
      <input class="input" id="det-date" type="date" style="width:130px">
      <input class="input" id="det-note" placeholder="Note" style="flex:1;min-width:80px">
      <button class="btn btn-primary btn-sm" onclick="addDetail(${budIdx},'${month}')">Add</button>
    </div>`;
  openModal('modal-budget-detail');
}

async function addDetail(budIdx, month) {
  const vendor=document.getElementById('det-vendor').value.trim()||'—';
  const amount=Number(document.getElementById('det-amount').value)||0;
  const date=document.getElementById('det-date').value||'';
  const note=document.getElementById('det-note').value||'';
  const b=state.budget[budIdx];
  try {
    const r=await apiCall(`/budget/${b.id}/month/${month}/detail${_yq()}`,{method:'POST',body:JSON.stringify({vendor,amount,date,note})});
    if(!b.months[month].details) b.months[month].details=[];
    b.months[month].details.push(r.detail);
    openMonthDetails(budIdx,month);
    toast('Detail added');
  } catch(e) { toast(e.message); }
}

async function deleteDetail(budIdx, month, did) {
  const b=state.budget[budIdx];
  await apiCall(`/budget/${b.id}/month/${month}/detail/${did}${_yq()}`,{method:'DELETE'});
  if(b.months[month]?.details) b.months[month].details=b.months[month].details.filter(d=>d.id!==did);
  openMonthDetails(budIdx,month);
}

async function uploadBudgetExcel(inp) {
  if (!inp.files[0]) return;
  const fd=new FormData(); fd.append('file',inp.files[0]);
  try {
    const res=await fetch('/api/budget/upload-excel',{method:'POST',headers:{'Authorization':'Bearer '+state.token},body:fd});
    const d=await res.json(); if(!res.ok) throw new Error(d.error);
    await loadAll(); render();
    if (window.LottieUI) LottieUI.showAlert('Excel Imported', `<strong>${d.imported} budget rows</strong> loaded successfully`, 'success');
    else toast(`Excel imported — ${d.imported} rows`);
  } catch(e) { toast('Upload failed: '+e.message); }
}

// ── Revenue ───────────────────────────────────────────────────────────────────
function renderRevenue(c) {
  const MO_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const withAct=state.revenue.filter(r=>r.revenue>0);
  const ytdRev=withAct.reduce((a,r)=>a+r.revenue,0);
  const ytdTgt=withAct.reduce((a,r)=>a+r.target,0);
  const pct=ytdTgt?((ytdRev/ytdTgt)*100).toFixed(1):0;
  const rbt=state.revenueByType||[];
  const moCount=withAct.length||1;

  // Compute YTD total per type
  const typeRows=rbt.map(t=>{
    const ytd=(t.monthly||[]).slice(0,moCount).reduce((a,v)=>a+v,0);
    return {...t, ytd};
  });
  const typeTotalYtd=typeRows.reduce((a,t)=>a+t.ytd,0)||1;

  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab active" onclick="switchView(this,'rev-charts')">Overview</button>
      <button class="view-tab" onclick="switchView(this,'rev-bytype')">By Channel</button>
      <button class="view-tab" onclick="switchView(this,'rev-bycountry')">By Country</button>
      <button class="view-tab" onclick="switchView(this,'rev-invoices')">Invoices</button>
      <button class="view-tab" onclick="showSection('subscriptions');state.subTab='reports';renderSubscriptions(document.getElementById('main-content'))">SaaS KPIs</button>
      <button class="view-tab" onclick="switchView(this,'rev-edit')">Edit — 12 Months</button>
    </div>

    <!-- Overview -->
    <div class="view-panel active" id="rev-charts">
      <div class="grid-3" style="margin-bottom:12px">
        <div class="metric"><div class="metric-label">Revenue YTD</div><div class="metric-value">${fmt(ytdRev)}</div></div>
        <div class="metric"><div class="metric-label">Achievement</div><div class="metric-value" style="color:var(--success)">${pct}%</div></div>
        <div class="metric"><div class="metric-label">vs Target YTD</div><div class="metric-value" style="color:${ytdRev>=ytdTgt?'var(--success)':'var(--danger-text)'}">${ytdRev>=ytdTgt?'+':''}${fmt(ytdRev-ytdTgt)}</div></div>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">Revenue vs Target — FY ${state.fiscalYear}</div><div style="display:flex;gap:6px;align-items:center">${yearNavHTML()}<button class="btn btn-sm" onclick="syncSource('/revenue/sync','QuickBooks + HubSpot')">↻ Sync</button></div></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-rev-detail"></canvas></div></div>
    </div>

    <!-- By Channel -->
    <div class="view-panel" id="rev-bytype">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:14px">
        ${typeRows.map(t=>{
          const pctT=Math.round((t.ytd/typeTotalYtd)*100);
          return `<div class="metric" style="border-top:3px solid ${t.color}">
            <div class="metric-label">${t.type}</div>
            <div class="metric-value" style="color:${t.color}">${fmt(t.ytd)}</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">${pctT}% of revenue</div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="card"><div class="card-header"><div class="card-title">Revenue Split (YTD)</div></div><div class="chart-wrap"><canvas id="chart-rev-donut"></canvas></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Monthly by Channel</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-rev-stacked"></canvas></div></div>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="card-header"><div class="card-title">Channel Breakdown — Edit Actuals</div></div>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Channel</th>${MO_SHORT.map(m=>`<th style="text-align:right;font-size:11px">${m}</th>`).join('')}<th style="text-align:right">YTD Total</th></tr></thead>
            <tbody>${rbt.map((t,ti)=>`<tr>
              <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.color};margin-right:6px"></span><strong>${t.type}</strong></td>
              ${MO_SHORT.map((m,mi)=>`<td style="text-align:right;padding:4px 6px"><input class="input input-cell" type="text" style="width:62px;text-align:right" value="${(t.monthly||[])[mi]?fmt((t.monthly||[])[mi]):'—'}" onfocus="this.value='${(t.monthly||[])[mi]||0}';this.type='number'" onblur="this.type='text';this.value=(this.value&&Number(this.value)>0)?fmt(Number(this.value)):'—';updateRevType(${ti},${mi},this.value)" oninput="showRevTypeSave()"></td>`).join('')}
              <td style="text-align:right;font-weight:700;color:${t.color}">${fmt(typeRows[ti]?.ytd||0)}</td>
            </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="save-bar" id="rev-type-savebar"><span class="save-hint">⚠ Unsaved changes</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="loadAll().then(render)">Discard</button><button class="btn btn-primary btn-sm" onclick="saveRevType()">Save</button></div></div>
      </div>
      ${(()=>{
        const arTyped = (state.ar||[]).filter(x=>x.revenueType);
        if (!arTyped.length) return '';
        const byType={};
        arTyped.forEach(x=>{
          if(!byType[x.revenueType]) byType[x.revenueType]={total:0,paid:0,count:0};
          byType[x.revenueType].total+=x.amount;
          byType[x.revenueType].count++;
          if(x.status==='paid') byType[x.revenueType].paid+=x.amount;
        });
        const typeTotal=Object.values(byType).reduce((a,v)=>a+v.total,0)||1;
        const TYPE_COLS={'Enterprise':'#FF6600','SaaS':'#7C3AED','Government':'#2563EB','Tradeshow':'#D97706','Services':'#16A34A','Partnership':'#0891b2'};
        return `<div class="card" style="margin-top:14px">
          <div class="card-header"><div class="card-title">Invoice Revenue by Channel</div><div style="font-size:11px;color:var(--text-2)">From invoicing section — <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="showSection('ar')">View all AR →</button></div></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
            ${Object.entries(byType).map(([type,d])=>{
              const col=TYPE_COLS[type]||'#888';
              const pct=Math.round((d.total/typeTotal)*100);
              return `<div style="background:var(--surface-2);border-radius:8px;padding:10px;border-top:3px solid ${col}">
                <div style="font-size:10px;color:${col};font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${type}</div>
                <div style="font-size:16px;font-weight:700">${fmt(d.total)}</div>
                <div style="font-size:10px;color:var(--text-3);margin-top:2px">${d.count} invoice${d.count!==1?'s':''} · ${pct}%</div>
                ${d.paid?`<div style="font-size:10px;color:var(--success);margin-top:2px">${fmt(d.paid)} collected</div>`:''}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      })()}
    </div>

    <!-- By Country -->
    <div class="view-panel" id="rev-bycountry">
      ${(()=>{
        const byCountry={};
        state.clients.forEach(cl=>{byCountry[cl.country]=(byCountry[cl.country]||{rev:0,clients:[]}); byCountry[cl.country].rev+=cl.revenue; byCountry[cl.country].clients.push(cl.name);});
        const countries=Object.entries(byCountry).sort((a,b)=>b[1].rev-a[1].rev);
        const totalRev=countries.reduce((a,[,v])=>a+v.rev,0)||1;
        const CCOLS=['#FF6600','#2563EB','#16A34A','#7C3AED','#D97706','#DC2626'];
        return `<div class="grid-2">
          <div class="card"><div class="card-header"><div class="card-title">Revenue by Country</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-rev-country-bar"></canvas></div></div>
          <div class="card"><div class="card-header"><div class="card-title">Country Split</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-rev-country-donut"></canvas></div></div>
        </div>
        ${(()=>{
          const {slice:ctrySlice, ctrl:ctryCtrl} = _paginate(countries, 'rev-country');
          return `<div class="card" style="margin-top:14px">
            <div class="card-header"><div class="card-title">Revenue by Country — Client Breakdown</div></div>
            <table class="table">
              <thead><tr><th>Country</th><th>Clients</th><th style="text-align:right">Revenue</th><th style="text-align:right">Share</th></tr></thead>
              <tbody>
                ${ctrySlice.map(([country,d],i)=>{
                  const gi = countries.findIndex(([c])=>c===country);
                  return `<tr>
                    <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${CCOLS[gi%CCOLS.length]};margin-right:6px"></span><strong>${country}</strong></td>
                    <td style="font-size:11px;color:var(--text-2)">${d.clients.join(', ')}</td>
                    <td style="text-align:right;font-weight:700">${fmt(d.rev)}</td>
                    <td style="text-align:right"><div style="display:flex;align-items:center;gap:6px;justify-content:flex-end"><div style="width:60px;height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden"><div style="width:${Math.round((d.rev/totalRev)*100)}%;height:100%;background:${CCOLS[gi%CCOLS.length]};border-radius:3px"></div></div>${Math.round((d.rev/totalRev)*100)}%</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
            ${ctryCtrl}
          </div>`;
        })()}`;
      })()}
    </div>

    <!-- Invoices -->
    <div class="view-panel" id="rev-invoices">
      ${(()=>{
        const invAll = state.ar || [];
        const pending = invAll.filter(x=>x.status==='pending');
        const overdue = invAll.filter(x=>x.status==='overdue');
        const paid    = invAll.filter(x=>x.status==='paid');
        const totalPending = pending.reduce((s,x)=>s+x.amount,0);
        const totalOverdue = overdue.reduce((s,x)=>s+x.amount,0);
        const totalPaid = paid.reduce((s,x)=>s+x.amount,0);
        const sColor = s=>({pending:'var(--info)',overdue:'var(--danger)',paid:'var(--success)'}[s]||'var(--text-2)');
        const sBg = s=>({pending:'var(--info-bg)',overdue:'var(--danger-bg)',paid:'var(--success-bg)'}[s]||'var(--surface-2)');
        const rows = [...overdue,...pending,...paid];
        return `
        <div class="grid-3" style="margin-bottom:12px">
          <div class="metric" style="border-top:3px solid var(--danger)">
            <div class="metric-label">Overdue</div>
            <div class="metric-value" style="color:var(--danger)">${fmt(totalOverdue)}</div>
            <div class="metric-sub">${overdue.length} invoice${overdue.length!==1?'s':''}</div>
          </div>
          <div class="metric" style="border-top:3px solid var(--info)">
            <div class="metric-label">Pending</div>
            <div class="metric-value" style="color:var(--info)">${fmt(totalPending)}</div>
            <div class="metric-sub">${pending.length} invoice${pending.length!==1?'s':''}</div>
          </div>
          <div class="metric" style="border-top:3px solid var(--success)">
            <div class="metric-label">Collected YTD</div>
            <div class="metric-value" style="color:var(--success)">${fmt(totalPaid)}</div>
            <div class="metric-sub">${paid.length} invoice${paid.length!==1?'s':''}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div><div class="card-title">All Invoices</div><div class="card-desc">Sorted by priority — overdue first</div></div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm" style="font-size:11px;color:var(--primary);border-color:var(--primary-bg)" onclick="openAI('ar')">✦ Ask Ayla</button>
              <button class="btn btn-primary btn-sm" onclick="openAddAR()">+ New Invoice</button>
            </div>
          </div>
            <div style="display:flex;flex-direction:column;gap:0">
            ${rows.length===0?emptyState('No invoices yet', 'Click + Invoice to add your first AR entry'):rows.map((x,i)=>{
              const daysOvr = x.dueDate ? Math.ceil((TODAY - new Date(x.dueDate+'T00:00:00'))/864e5) : 0;
              const duePill = x.status==='overdue'
                ? `<span style="font-size:10px;font-weight:700;color:var(--danger);background:var(--danger-bg);padding:2px 7px;border-radius:10px;white-space:nowrap">${daysOvr}d overdue</span>`
                : x.status==='pending' && x.dueDate
                  ? (daysOvr>=0
                    ? `<span style="font-size:10px;font-weight:600;color:var(--warning);background:var(--warning-bg);padding:2px 7px;border-radius:10px;white-space:nowrap">Due today</span>`
                    : `<span style="font-size:10px;color:var(--text-3);background:var(--surface-2);padding:2px 7px;border-radius:10px;white-space:nowrap">${Math.abs(daysOvr)}d left</span>`)
                  : '';
              const initials = (x.client||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
              const avatarBg = x.status==='overdue'?'var(--danger-bg)':x.status==='paid'?'var(--success-bg)':'var(--info-bg)';
              const avatarClr = x.status==='overdue'?'var(--danger)':x.status==='paid'?'var(--success)':'var(--info)';
              return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:${i<rows.length-1?'0.5px solid var(--border)':'none'};border-left:3px solid ${sColor(x.status)};background:${x.status==='overdue'?'rgba(220,38,38,0.02)':'transparent'};transition:background .12s" onmouseenter="this.style.background='var(--surface-2)'" onmouseleave="this.style.background='${x.status==='overdue'?'rgba(220,38,38,0.02)':'transparent'}'">
                <div style="width:36px;height:36px;border-radius:50%;background:${avatarBg};color:${avatarClr};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${initials}</div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="font-size:13px;font-weight:700;color:var(--text)">${x.client}</span>
                    ${x.invoice?`<span style="font-size:10px;font-family:monospace;color:var(--text-3);background:var(--surface-2);padding:1px 6px;border-radius:4px">${x.invoice}</span>`:''}
                    ${duePill}
                  </div>
                  <div style="display:flex;gap:12px;margin-top:3px;flex-wrap:wrap">
                    ${x.revenueType?`<span style="font-size:11px;color:var(--text-3)">${x.revenueType}</span>`:''}
                    ${x.createdAt?`<span style="font-size:11px;color:var(--text-3)">Issued ${x.createdAt.split('T')[0]}</span>`:''}
                    ${x.dueDate?`<span style="font-size:11px;color:${x.status==='overdue'?'var(--danger)':'var(--text-3)'}">Due ${fmtDate(x.dueDate)}</span>`:''}
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
                  <div style="text-align:right">
                    <div style="font-size:16px;font-weight:800;font-family:'Montserrat',sans-serif;color:${x.status==='overdue'?'var(--danger)':x.status==='paid'?'var(--success)':'var(--text)'}">${fmt(x.amount)}</div>
                    <div style="margin-top:2px"><span style="font-size:10px;font-weight:700;text-transform:capitalize;padding:2px 8px;border-radius:10px;background:${sBg(x.status)};color:${sColor(x.status)}">${x.status}</span></div>
                  </div>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="openEditAR(${x.id})">Edit</button>
                    ${x.status!=='paid'?`<button class="btn btn-sm" style="font-size:10px;padding:3px 8px;background:var(--success-bg);color:var(--success);border-color:rgba(22,163,74,.2)" onclick="markARPaid(${x.id})">✓ Paid</button>`:''}
                    <button class="del-btn" style="font-size:13px;padding:2px 7px" onclick="deleteAR(${x.id})">×</button>
                  </div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      })()}
    </div>

    <!-- SaaS KPIs -->
    <div class="view-panel" id="rev-kpis">
      ${(()=>{
        // Use enriched linked data when available — revenueType defaults to 'Services' on all records
        const linkedAR   = state._linked?.ar || state.ar;
        const paidInv    = linkedAR.filter(x=>x.status==='paid');
        const paidSaasInv = paidInv.filter(x=>x.revenueType==='Enterprise'||x.revenueType==='SaaS');
        const arr = paidSaasInv.reduce((s,x)=>s+x.amount,0);
        const mrr = Math.round(arr/12);
        const paidTotal = paidInv.reduce((s,x)=>s+x.amount,0);
        const saasRatio = paidTotal ? Math.round((arr/paidTotal)*100) : 0;
        const saasClientNames = [...new Set(paidSaasInv.map(x=>x.client.toLowerCase()))];
        const saasClients = saasClientNames;
        const arpa = saasClientNames.length ? Math.round(arr/saasClientNames.length) : 0;
        const ytdRevKpi = state.revenue.filter(r=>r.revenue>0).reduce((s,r)=>s+r.revenue,0);
        const ytdExpKpi = state.revenue.filter(r=>r.revenue>0).reduce((s,r)=>s+r.expenses,0);
        const grossMargin = ytdRevKpi ? Math.round(((ytdRevKpi-ytdExpKpi)/ytdRevKpi)*100) : 0;
        const totalAR = state.ar.filter(x=>x.status!=='paid').reduce((s,x)=>s+x.amount,0);
        const dso = ytdRevKpi ? Math.round((totalAR/(ytdRevKpi/6))*30) : 0;
        const ltv = arpa && dso ? Math.round(arpa * (12 / Math.max(dso/30,1))) : 0;
        return `<div class="card">
          <div class="card-header">
            <div><div class="card-title">SaaS & Financial KPIs</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">Key ratios computed from live client and revenue data</div></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
            <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid #FF6600">
              <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">ARR</div>
              <div style="font-size:20px;font-weight:700">${fmt(arr)}</div>
              <div style="font-size:10px;color:var(--text-2);margin-top:3px">Annual Recurring Revenue</div>
            </div>
            <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid #2563EB">
              <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">MRR</div>
              <div style="font-size:20px;font-weight:700">${fmt(mrr)}</div>
              <div style="font-size:10px;color:var(--text-2);margin-top:3px">Monthly Recurring Revenue</div>
            </div>
            ${(()=>{
              const saasTgt = state.appSettings?.saasRatioTarget || 0;
              const saasOk  = !saasTgt || saasRatio >= saasTgt;
              return `<div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid ${saasOk?'#16A34A':'var(--warning)'}">
              <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">SaaS%${saasTgt?` <span style="font-weight:400;text-transform:none">(target ${saasTgt}%)</span>`:''}</div>
              <div style="font-size:20px;font-weight:700;color:${saasOk?'inherit':'var(--warning)'}">${saasRatio}%${!saasOk?` <span style="font-size:11px">↓ below target</span>`:''}</div>
              <div style="font-size:10px;color:var(--text-2);margin-top:3px">of total client revenue</div>
            </div>`;
            })()}
            <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid #7C3AED">
              <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">ARPA</div>
              <div style="font-size:20px;font-weight:700">${fmt(arpa)}</div>
              <div style="font-size:10px;color:var(--text-2);margin-top:3px">Avg Revenue Per Account</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
            <div style="background:var(--bg);border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:18px;font-weight:700;color:${grossMargin>20?'var(--success)':grossMargin>10?'var(--warning)':'var(--danger)'}">${grossMargin}%</div>
              <div style="font-size:10px;color:var(--text-3);margin-top:3px">Gross Margin</div>
            </div>
            <div style="background:var(--bg);border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:18px;font-weight:700;color:${dso<30?'var(--success)':dso<60?'var(--warning)':'var(--danger)'}">${dso}d</div>
              <div style="font-size:10px;color:var(--text-3);margin-top:3px">Days Sales Outstanding</div>
            </div>
            <div style="background:var(--bg);border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:18px;font-weight:700;color:var(--primary)">${saasClients.length}</div>
              <div style="font-size:10px;color:var(--text-3);margin-top:3px">SaaS Clients</div>
            </div>
            <div style="background:var(--bg);border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:18px;font-weight:700;color:var(--text)">${fmt(ltv)}</div>
              <div style="font-size:10px;color:var(--text-3);margin-top:3px">Est. LTV (ARPA/Churn)</div>
            </div>
          </div>
        </div>`;
      })()}
    </div>

    <!-- Edit 12 Months -->
    <div class="view-panel" id="rev-edit">
      <div class="card">
        <div class="card-header"><div class="card-title">Revenue Targets — 12 Months</div><button class="btn btn-sm" onclick="syncSource('/revenue/sync','QuickBooks')">↻ Sync</button></div>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Month</th><th>Actual <span class="badge-qbo">QBO</span></th><th>Target <span class="badge-manual">edit</span></th><th>Variance</th><th>MoM Growth <span class="badge-auto">auto</span></th><th>Expenses <span class="badge-qbo">QBO</span></th><th>Margin</th></tr></thead>
            <tbody>${state.revenue.map((r,i)=>{
              const v=r.revenue-r.target;
              const mg=r.revenue?Math.round(((r.revenue-r.expenses)/r.revenue)*100):0;
              const prev=state.revenue[i-1]?.revenue||0;
              const mom=r.revenue&&prev?Math.round(((r.revenue-prev)/prev)*100):null;
              return `<tr>
                <td><strong>${r.month}</strong></td>
                <td style="color:var(--text-2)">${r.revenue?fmt(r.revenue):'—'}</td>
                <td><input class="input input-cell" type="text" value="${fmt(r.target)}" onchange="updateRevenue(${i},'target',this.value)" oninput="this.classList.add('modified');showRevSave()"></td>
                <td class="${v>=0?'val-pos':'val-neg'}">${r.revenue?(v>=0?'+':'')+(fmt(v)):'—'}</td>
                <td class="${mom===null?'':mom>=0?'val-pos':'val-neg'}" style="font-size:11px">${mom===null?'—':mom>=0?'+'+mom+'%':mom+'%'}</td>
                <td style="color:var(--text-2)">${r.expenses?fmt(r.expenses):'—'}</td>
                <td>${r.revenue?mg+'%':'—'}</td>
              </tr>`;}).join('')}
            </tbody>
          </table>
        </div>
        <div class="save-bar" id="rev-savebar"><span class="save-hint">⚠ Unsaved changes</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="discardRevenue()">Discard</button><button class="btn btn-primary btn-sm" onclick="saveRevenue()">Save</button></div></div>
      </div>
    </div>
  </div>`;

  setTimeout(()=>{
    // Overview bar chart
    mkChart('chart-rev-detail','bar',{
      labels:state.revenue.map(r=>r.month),
      datasets:[
        {label:'Revenue',data:state.revenue.map(r=>r.revenue),backgroundColor:'#FF6600',borderRadius:4},
        {label:'Target', data:state.revenue.map(r=>r.target), backgroundColor:'rgba(0,0,0,0.08)',borderRadius:4}
      ]
    });
    // Donut — revenue by type YTD
    mkChart('chart-rev-donut','doughnut',{
      labels:typeRows.map(t=>t.type),
      datasets:[{data:typeRows.map(t=>t.ytd),backgroundColor:typeRows.map(t=>t.color),borderWidth:2,borderColor:'#fff'}]
    },{plugins:{legend:{display:true,position:'right',labels:{boxWidth:12,font:{size:11}}}}});
    // Stacked bar — monthly by type
    mkChart('chart-rev-stacked','bar',{
      labels:state.revenue.map(r=>r.month),
      datasets:rbt.map(t=>({
        label:t.type,
        data:(t.monthly||new Array(12).fill(0)),
        backgroundColor:t.color,
        borderRadius:2,
        stack:'rev'
      }))
    },{scales:{x:{stacked:true,grid:{display:false},ticks:{color:'#5E6C84',font:{size:10}}},y:{stacked:true,ticks:{color:'#5E6C84'},grid:{color:'rgba(0,0,0,0.05)'}}}});
    // Country charts
    const byCountry={};
    const CCOLS=['#FF6600','#2563EB','#16A34A','#7C3AED','#D97706','#DC2626'];
    state.clients.forEach(cl=>{byCountry[cl.country]=(byCountry[cl.country]||0)+cl.revenue;});
    const cLabels=Object.keys(byCountry), cData=Object.values(byCountry);
    mkChart('chart-rev-country-bar','bar',{labels:cLabels,datasets:[{data:cData,backgroundColor:CCOLS.slice(0,cLabels.length),borderRadius:6}]});
    mkChart('chart-rev-country-donut','doughnut',{labels:cLabels,datasets:[{data:cData,backgroundColor:CCOLS.slice(0,cLabels.length),borderWidth:2,borderColor:'#fff'}]},{plugins:{legend:{display:true,position:'right',labels:{boxWidth:12,font:{size:11}}}}});
  },50);
}
function updateRevenue(i,f,v){const n=parseInt(String(v).replace(/[^0-9]/g,''));if(!isNaN(n))state.revenue[i][f]=n;}
function showRevSave(){document.getElementById('rev-savebar')?.classList.add('visible');}
async function saveRevenue(){try{await apiCall(`/revenue${_yq()}`,{method:'PUT',body:JSON.stringify({revenue:state.revenue})});toast('Revenue saved');render();}catch(e){toast(e.message);}}
function discardRevenue(){loadAll().then(render);}
function updateRevType(ti,mi,val){
  const n=parseInt(String(val).replace(/[^0-9]/g,''));
  if(!isNaN(n)&&state.revenueByType[ti]){
    if(!state.revenueByType[ti].monthly) state.revenueByType[ti].monthly=new Array(12).fill(0);
    state.revenueByType[ti].monthly[mi]=n;
  }
}
function showRevTypeSave(){document.getElementById('rev-type-savebar')?.classList.add('visible');}
async function saveRevType(){try{await apiCall(`/revenue/by-type${_yq()}`,{method:'PUT',body:JSON.stringify(state.revenueByType)});toast('Revenue by channel saved');render();}catch(e){toast(e.message);}}

// ── Sales Pipeline ────────────────────────────────────────────────────────────
const STAGE_COLORS={'Prospecting':'#97A0AF','Qualification':'#2563EB','Proposal':'#D97706','Negotiation':'#FF6600','Closed Won':'#16A34A','Closed Lost':'#DC2626'};

function switchPipelineView(v) { state.pipelineView = v; render(); }

function renderPipeline(c) {
  if (!state.pipelineView) state.pipelineView = 'pipeline';
  if (state.pipelineView === 'forecast') { renderPipelineForecast(c); return; }

  const byType={}, byStage={};
  let totalVal=0, weightedVal=0;
  state.pipeline.forEach(d=>{
    byType[d.type]=(byType[d.type]||0)+d.value;
    byStage[d.stage]=(byStage[d.stage]||0)+d.value;
    totalVal+=d.value; weightedVal+=d.value*(d.probability/100);
  });
  const active=state.pipeline.filter(d=>d.stage!=='Closed Won'&&d.stage!=='Closed Lost');
  const closedWonDeals=state.pipeline.filter(d=>d.stage==='Closed Won');
  const closedWonVal=closedWonDeals.reduce((a,d)=>a+d.value,0);
  const _kpiNow=new Date();
  const _kpiMonths6=Array.from({length:6},(_,i)=>{ const d=new Date(_kpiNow.getFullYear(),_kpiNow.getMonth()-5+i,1); return {y:d.getFullYear(),m:d.getMonth(),label:d.toLocaleString('en',{month:'short'})}; });
  const _kpiMonthlyWon=_kpiMonths6.map(mo=>closedWonDeals.filter(d=>{ const cd=new Date(d.closeDate); return cd.getFullYear()===mo.y&&cd.getMonth()===mo.m; }).reduce((a,d)=>a+d.value,0));
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div class="view-tabs" style="width:fit-content">
        <button class="view-tab active" onclick="switchPipelineView('pipeline')"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-right:5px"><path d="M1 7h12M7 1l6 6-6 6"/></svg>Sales Pipeline</button>
        <button class="view-tab" onclick="switchPipelineView('forecast')"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-right:5px"><polyline points="1,11 4,7 7,9 10,4 13,2"/></svg>Pipeline Forecast</button>
      </div>
      <button class="btn btn-sm" style="font-size:11px;color:var(--primary);border-color:var(--primary-bg)" onclick="openAI('pipeline')">✦ Ask Ayla</button>
    </div>
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab active" onclick="switchView(this,'pipe-charts')">Overview</button>
      <button class="view-tab" onclick="switchView(this,'pipe-kpi')">Sales KPIs</button>
      <button class="view-tab" onclick="switchView(this,'pipe-list')">All Deals</button>
    </div>
    <div class="view-panel active" id="pipe-charts">
      <div class="grid-4" style="margin-bottom:12px">
        <div class="metric"><div class="metric-label">Total Pipeline</div><div class="metric-value">${fmt(totalVal)}</div><div class="metric-sub">${state.pipeline.length} total deals</div></div>
        <div class="metric"><div class="metric-label">Weighted Forecast</div><div class="metric-value" style="color:var(--primary)">${fmt(weightedVal)}</div><div class="metric-sub">probability-adjusted</div></div>
        <div class="metric"><div class="metric-label">Active Deals</div><div class="metric-value">${active.length}</div><div class="metric-sub">in progress</div></div>
        <div class="metric" style="background:var(--success-bg);border-color:rgba(22,163,74,.2)"><div class="metric-label" style="color:var(--success-text)">Closed Won</div><div class="metric-value" style="color:var(--success)">${fmt(closedWonVal)}</div><div class="metric-sub" style="color:var(--success-text)">${closedWonDeals.length} deal${closedWonDeals.length!==1?'s':''} closed</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">Pipeline by Channel</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="pipe-type-chart"></canvas></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Deals by Stage</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="pipe-stage-chart"></canvas></div></div>
      </div>
    </div>
    <div class="view-panel" id="pipe-kpi">
      ${(()=>{
        const STAGES = ['Prospecting','Qualification','Proposal','Negotiation','Closed Won','Closed Lost'];
        const won  = state.pipeline.filter(d => d.stage === 'Closed Won');
        const lost = state.pipeline.filter(d => d.stage === 'Closed Lost');
        const closed = won.length + lost.length;
        const winRate = closed ? Math.round((won.length / closed) * 100) : 0;
        const avgDeal = won.length ? Math.round(won.reduce((a,d)=>a+d.value,0) / won.length) : 0;
        const avgActive = active.length ? Math.round(active.reduce((a,d)=>a+d.value,0) / active.length) : 0;
        // Pipeline velocity: avg days from creation to close for won deals
        const velocities = won.map(d => {
          const c = d.createdAt ? Math.ceil((new Date(d.closeDate) - new Date(d.createdAt)) / 864e5) : null;
          return c && c > 0 ? c : null;
        }).filter(v => v !== null);
        const avgVelocity = velocities.length ? Math.round(velocities.reduce((a,v)=>a+v,0)/velocities.length) : null;
        // Quota attainment: compare closedWonVal to appSettings.salesQuota
        const quota = state.appSettings?.salesQuota || 0;
        const quotaPct = quota ? Math.min(Math.round((closedWonVal / quota) * 100), 999) : 0;
        // By-rep stats
        const byRep = {};
        state.pipeline.forEach(d => {
          const r = d.owner || 'Unassigned';
          if (!byRep[r]) byRep[r] = { won:0, lost:0, wonVal:0, active:0, activeVal:0 };
          if (d.stage==='Closed Won')  { byRep[r].won++;  byRep[r].wonVal+=d.value; }
          else if (d.stage==='Closed Lost') byRep[r].lost++;
          else { byRep[r].active++; byRep[r].activeVal+=d.value; }
        });
        // Stage conversion funnel
        const stageCounts = STAGES.slice(0,-1).map(s => state.pipeline.filter(d=>d.stage===s||d.stage==='Closed Won'||d.stage==='Closed Lost').length);
        const funnelCounts = STAGES.slice(0,5).map(s => ({
          stage: s,
          count: state.pipeline.filter(d => {
            const si = STAGES.indexOf(d.stage), ti = STAGES.indexOf(s);
            return si >= ti;
          }).length
        }));
        const maxFunnel = funnelCounts[0]?.count || 1;
        // Monthly closed won (last 6 months)
        const now = new Date();
        const months6 = Array.from({length:6},(_,i)=>{ const d=new Date(now.getFullYear(),now.getMonth()-5+i,1); return {y:d.getFullYear(),m:d.getMonth(),label:d.toLocaleString('en',{month:'short'})}; });
        const monthlyWon = months6.map(mo => won.filter(d=>{ const cd=new Date(d.closeDate); return cd.getFullYear()===mo.y&&cd.getMonth()===mo.m; }).reduce((a,d)=>a+d.value,0));
        const REP_COLS = ['#FF6600','#2563EB','#16A34A','#7C3AED','#D97706'];
        return `
        <!-- Top KPI row -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:14px">
          <div class="metric" style="border-top:3px solid var(--success)">
            <div class="metric-label">Win Rate</div>
            <div class="metric-value" style="color:var(--success)">${winRate}%</div>
            <div class="metric-sub">${won.length}W · ${lost.length}L of ${closed} closed</div>
          </div>
          <div class="metric" style="border-top:3px solid var(--primary)">
            <div class="metric-label">Avg Deal Size (Won)</div>
            <div class="metric-value" style="color:var(--primary)">${fmt(avgDeal)}</div>
            <div class="metric-sub">Active avg: ${fmt(avgActive)}</div>
          </div>
          <div class="metric" style="border-top:3px solid #7C3AED">
            <div class="metric-label">Pipeline Velocity</div>
            <div class="metric-value" style="color:#7C3AED">${avgVelocity !== null ? avgVelocity+'d' : '—'}</div>
            <div class="metric-sub">avg days to close</div>
          </div>
          <div class="metric" style="border-top:3px solid var(--info)">
            <div class="metric-label">Closed Won YTD</div>
            <div class="metric-value" style="color:var(--info)">${fmt(closedWonVal)}</div>
            <div class="metric-sub">${won.length} deal${won.length!==1?'s':''}</div>
          </div>
          ${quota ? `<div class="metric" style="border-top:3px solid ${quotaPct>=100?'var(--success)':quotaPct>=70?'var(--warning)':'var(--danger)'}">
            <div class="metric-label">Quota Attainment</div>
            <div class="metric-value" style="color:${quotaPct>=100?'var(--success)':quotaPct>=70?'var(--warning)':'var(--danger)'}">${quotaPct}%</div>
            <div class="metric-sub">${fmt(closedWonVal)} / ${fmt(quota)}</div>
          </div>` : `<div class="metric" style="border:1.5px dashed var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
            <div style="font-size:11px;color:var(--text-3);text-align:center">Set a sales quota in Settings</div>
            <button onclick="showSection('settings')" style="font-size:10px;padding:3px 8px;border-radius:6px;background:var(--primary-bg);color:var(--primary);border:none;cursor:pointer">Set Quota →</button>
          </div>`}
        </div>

        <!-- Funnel + Monthly won -->
        <div class="grid-2" style="margin-bottom:14px">
          <div class="card">
            <div class="card-header"><div class="card-title">Stage Conversion Funnel</div></div>
            <div style="display:flex;flex-direction:column;gap:6px;padding:4px 0">
              ${funnelCounts.map((f,i)=>{
                const pct = Math.round((f.count/maxFunnel)*100);
                const nextCount = funnelCounts[i+1]?.count;
                const convRate = nextCount !== undefined && f.count > 0 ? Math.round((nextCount/f.count)*100) : null;
                return `<div>
                  <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
                    <span style="font-weight:600;color:${STAGE_COLORS[f.stage]||'var(--text-2)'}">${f.stage}</span>
                    <span style="color:var(--text-2)">${f.count} deal${f.count!==1?'s':''}${convRate!==null?` <span style="color:var(--text-3);font-size:10px">→ ${convRate}% conv.</span>`:''}`
                    + `</span>
                  </div>
                  <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden">
                    <div style="height:100%;background:${STAGE_COLORS[f.stage]||'var(--primary)'};width:${pct}%;border-radius:4px;transition:width .4s"></div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Monthly Closed Won</div></div>
            <div class="chart-wrap chart-wrap-sm"><canvas id="kpi-monthly-won"></canvas></div>
          </div>
        </div>

        <!-- By rep -->
        ${Object.keys(byRep).length ? `
        <div class="card">
          <div class="card-header"><div class="card-title">Performance by Rep</div></div>
          <div style="overflow-x:auto">
            <table class="table">
              <thead><tr>
                <th>Rep</th>
                <th style="text-align:center">Won</th>
                <th style="text-align:center">Lost</th>
                <th style="text-align:center">Win Rate</th>
                <th style="text-align:right">Won Value</th>
                <th style="text-align:center">Active</th>
                <th style="text-align:right">Active Value</th>
                <th style="min-width:100px">Win Rate Bar</th>
              </tr></thead>
              <tbody>${Object.entries(byRep).sort((a,b)=>b[1].wonVal-a[1].wonVal).map(([rep,d],i)=>{
                const repClosed = d.won+d.lost;
                const repWinRate = repClosed ? Math.round((d.won/repClosed)*100) : 0;
                const col = REP_COLS[i%REP_COLS.length];
                return `<tr>
                  <td><span style="font-weight:600">${rep}</span></td>
                  <td style="text-align:center"><span style="color:var(--success);font-weight:700">${d.won}</span></td>
                  <td style="text-align:center"><span style="color:var(--danger)">${d.lost}</span></td>
                  <td style="text-align:center"><strong style="color:${repWinRate>=60?'var(--success)':repWinRate>=40?'var(--warning)':'var(--danger)'}">${repClosed?repWinRate+'%':'—'}</strong></td>
                  <td style="text-align:right;font-weight:700">${fmt(d.wonVal)}</td>
                  <td style="text-align:center">${d.active}</td>
                  <td style="text-align:right;color:var(--text-2)">${fmt(d.activeVal)}</td>
                  <td><div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden"><div style="height:100%;background:${col};width:${repClosed?repWinRate:0}%;border-radius:3px"></div></div></td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>` : ''}`;
      })()}
    </div>

    <div class="view-panel" id="pipe-list">
      <div class="card">
        <div class="card-header"><div><div class="card-title">Sales Pipeline — All Deals</div><div class="card-desc">${state.appSettings?.hubspotConnected?'HubSpot connected · manual override enabled':'Manual entry — connect HubSpot in Settings to sync'}</div></div><div style="display:flex;gap:6px">${state.appSettings?.hubspotConnected?`<button class="btn btn-sm" onclick="syncSource('/pipeline/sync','HubSpot')">↻ HubSpot</button>`:''}<button class="btn btn-primary btn-sm" onclick="openAddDeal()">+ Add Deal</button></div></div>
        <!-- Pipeline Filters -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 0 14px;border-bottom:1px solid var(--border);margin-bottom:12px">
          <input class="input" style="width:180px;font-size:12px" placeholder="Search name, client…" value="${state._pipeFilter.q}" oninput="state._pipeFilter.q=this.value;state._pages.pipeline=0;renderPipeline(document.getElementById('main-content'))">
          <select class="input" style="width:150px;font-size:12px" onchange="state._pipeFilter.stage=this.value;state._pages.pipeline=0;renderPipeline(document.getElementById('main-content'))">
            <option value="">All Stages</option>
            ${[...new Set(state.pipeline.map(d=>d.stage).filter(Boolean))].map(s=>`<option value="${s}"${state._pipeFilter.stage===s?' selected':''}>${s}</option>`).join('')}
          </select>
          <select class="input" style="width:150px;font-size:12px" onchange="state._pipeFilter.owner=this.value;state._pages.pipeline=0;renderPipeline(document.getElementById('main-content'))">
            <option value="">All Owners</option>
            ${[...new Set(state.pipeline.map(d=>d.owner).filter(Boolean))].map(o=>`<option value="${o}"${state._pipeFilter.owner===o?' selected':''}>${o}</option>`).join('')}
          </select>
          <select class="input" style="width:140px;font-size:12px" onchange="state._pipeFilter.sortBy=this.value;renderPipeline(document.getElementById('main-content'))">
            <option value="">Sort: Default</option>
            <option value="value"${state._pipeFilter.sortBy==='value'?' selected':''}>Sort: Value ↓</option>
            <option value="closeDate"${state._pipeFilter.sortBy==='closeDate'?' selected':''}>Sort: Close Date</option>
            <option value="probability"${state._pipeFilter.sortBy==='probability'?' selected':''}>Sort: Probability</option>
          </select>
          ${(state._pipeFilter.q||state._pipeFilter.stage||state._pipeFilter.owner||state._pipeFilter.sortBy)?`<button class="btn btn-sm" style="font-size:11px" onclick="state._pipeFilter={stage:'',owner:'',q:'',sortBy:'',sortDir:'asc'};renderPipeline(document.getElementById('main-content'))">✕ Clear</button>`:''}
        </div>
        ${(()=>{
          let pl = [...state.pipeline];
          const f = state._pipeFilter;
          if (f.q)     pl = pl.filter(d=>(d.name+' '+d.client).toLowerCase().includes(f.q.toLowerCase()));
          if (f.stage) pl = pl.filter(d=>d.stage===f.stage);
          if (f.owner) pl = pl.filter(d=>d.owner===f.owner);
          if (f.sortBy==='value')       pl.sort((a,b)=>b.value-a.value);
          else if (f.sortBy==='closeDate') pl.sort((a,b)=>(a.closeDate||'').localeCompare(b.closeDate||''));
          else if (f.sortBy==='probability') pl.sort((a,b)=>b.probability-a.probability);
          const {slice:plSlice, ctrl:plCtrl} = _paginate(pl, 'pipeline'); return plSlice.map(d=>{
          const col=STAGE_COLORS[d.stage]||'#475569';
          const wtd=Math.round(d.value*d.probability/100);
          const hasInvoice = state.ar.some(x => x.pipelineDealId === d.id);
          return `<div class="deal-row">
            <div style="width:3px;border-radius:2px;background:${col};align-self:stretch;flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:600">${d.name}</div>
              <div style="font-size:10px;color:var(--text-2);margin-top:2px">${d.client} · ${d.owner} · Close: ${fmtDate(d.closeDate)}</div>
            </div>
            <span class="stage-badge" style="background:${col}22;color:${col}">${d.stage}</span>
            ${d.stage==='Closed Won'?`<span title="${hasInvoice?'AR invoice exists':'No AR invoice yet'}" style="font-size:10px;padding:1px 7px;border-radius:7px;font-weight:700;background:${hasInvoice?'var(--success-bg)':'rgba(220,38,38,.08)'};color:${hasInvoice?'var(--success)':'var(--danger)'}">📄 ${hasInvoice?'Invoiced':'No Invoice'}</span>`:''}
            <span class="tag ${d.type==='Enterprise'?'tag-primary':d.type==='Government'?'tag-info':'tag-purple'}">${d.type}</span>
            <div style="text-align:right;min-width:90px"><div style="font-size:13px;font-weight:700">${fmt(d.value)}</div><div style="font-size:10px;color:var(--text-2)">${d.probability}% → ${fmt(wtd)}</div></div>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="editDeal(${d.id})">Edit</button>
            <button class="del-btn" onclick="deleteDeal(${d.id})">×</button>
          </div>`;}).join('') + plCtrl; })()}
      </div>
    </div>

  </div>`;
  setTimeout(()=>{
    const typeLabels=Object.keys(byType), typeData=Object.values(byType);
    mkDoughnut('pipe-type-chart',typeLabels,typeData,['#FF6600','#2563EB','#7C3AED']);
    const FUNNEL_ORDER=['Prospecting','Qualification','Proposal','Negotiation','On Hold','Closed Won','Closed Lost'];
    const orderedStages=[...FUNNEL_ORDER.filter(s=>byStage[s]!==undefined),...Object.keys(byStage).filter(s=>!FUNNEL_ORDER.includes(s))];
    const stLabels=orderedStages, stData=orderedStages.map(s=>byStage[s]);
    mkChart('pipe-stage-chart','bar',{labels:stLabels,datasets:[{data:stData,backgroundColor:stLabels.map(s=>STAGE_COLORS[s]||'#97A0AF'),borderRadius:4}]});
    mkChart('kpi-monthly-won','bar',{labels:_kpiMonths6.map(m=>m.label),datasets:[{label:'Closed Won',data:_kpiMonthlyWon,backgroundColor:'rgba(22,163,74,0.75)',borderRadius:4}]},{scales:{y:{ticks:{callback:v=>v>=1e6?'$'+(v/1e6).toFixed(1)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+v}}}});
  },50);
}

function openAddDeal() {
  document.getElementById('deal-modal-title').textContent='Add Deal';
  ['deal-name','deal-client','deal-owner-email','deal-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  _populateOwnerDL('');
  document.getElementById('deal-value').value=''; document.getElementById('deal-prob').value='75';
  document.getElementById('deal-close').value=''; document.getElementById('deal-followup').value='';
  document.getElementById('deal-type').value='Enterprise'; document.getElementById('deal-stage').value='Prospecting';
  delete document.getElementById('modal-deal').dataset.editId;
  openModal('modal-deal');
}
function editDeal(id) {
  const d=state.pipeline.find(x=>x.id===id); if(!d) return;
  document.getElementById('deal-modal-title').textContent='Edit Deal';
  document.getElementById('deal-name').value=d.name; document.getElementById('deal-client').value=d.client;
  setSelectValue(document.getElementById('deal-type'), d.type);
  document.getElementById('deal-value').value=d.value;
  document.getElementById('deal-prob').value=d.probability;
  setSelectValue(document.getElementById('deal-stage'), d.stage);
  document.getElementById('deal-close').value=d.closeDate;
  _populateOwnerDL(d.owner||'');
  document.getElementById('deal-owner-email').value=d.ownerEmail||''; document.getElementById('deal-followup').value=d.followUpDate||'';
  document.getElementById('deal-notes').value=d.notes||'';
  document.getElementById('modal-deal').dataset.editId=id;
  openModal('modal-deal');
}
async function saveDeal() {
  const data={name:document.getElementById('deal-name').value.trim(),client:document.getElementById('deal-client').value.trim(),type:document.getElementById('deal-type').value,value:Number(document.getElementById('deal-value').value)||0,probability:Number(document.getElementById('deal-prob').value)||0,stage:document.getElementById('deal-stage').value,closeDate:document.getElementById('deal-close').value,followUpDate:document.getElementById('deal-followup').value||null,owner:document.getElementById('deal-owner').value.trim(),ownerEmail:document.getElementById('deal-owner-email').value.trim(),notes:document.getElementById('deal-notes').value,lastUpdated:new Date().toISOString().split('T')[0]};
  if (!data.name) { toast('Deal name required'); return; }
  // Enforce probability for terminal stages
  if (data.stage==='Closed Won')  data.probability=100;
  if (data.stage==='Closed Lost') data.probability=0;
  // Warn on duplicate deal name (new deals only)
  const eid=document.getElementById('modal-deal').dataset.editId;
  if (!eid) {
    const dupe=state.pipeline.find(d=>d.name.toLowerCase()===data.name.toLowerCase());
    if (dupe) { if (!confirm(`A deal named "${dupe.name}" already exists (${dupe.stage}). Save anyway?`)) return; }
    // Warn if client doesn't exist in client master
    if (data.client) {
      const clientExists = state.clients.some(c=>!c.archived&&c.name.toLowerCase()===data.client.toLowerCase());
      if (!clientExists) toast(`ℹ "${data.client}" is not in your Clients list. Consider adding them as a client.`);
    }
  }
  try {
    if (eid) {
      const r = await apiCall(`/pipeline/${eid}`, {method:'PUT', body:JSON.stringify(data)});
      const i = state.pipeline.findIndex(x => x.id === Number(eid));
      if (i > -1) state.pipeline[i] = r.deal;
      if (r.arDraft) {
        state.ar.push(r.arDraft);
        closeModal('modal-deal'); render();
        toast(`✓ Deal saved — draft invoice ${r.arDraft.invoice} created`);
        // Banner with jump-to-AR link
        const banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--success-bg);border:1px solid rgba(22,163,74,.3);border-radius:10px;padding:12px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,.12);max-width:420px';
        banner.innerHTML = `<div style="font-size:18px">📄</div><div style="flex:1"><div style="font-size:12px;font-weight:700;color:var(--success)">Draft Invoice Auto-Created</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">${r.arDraft.invoice} · ${r.arDraft.client} · ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(r.arDraft.amount)}</div></div><button style="font-size:11px;padding:5px 10px;border-radius:6px;background:var(--success);color:#fff;border:none;cursor:pointer;font-weight:600" onclick="showSection('ar');document.querySelector('.invoice-banner')?.remove()">View AR →</button><button style="background:none;border:none;cursor:pointer;color:var(--text-3);font-size:14px;padding:2px 4px" onclick="this.closest('.invoice-banner').remove()">✕</button>`;
        banner.className = 'invoice-banner';
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 8000);
        return;
      }
    } else {
      const r = await apiCall('/pipeline', {method:'POST', body:JSON.stringify(data)});
      state.pipeline.push(r.deal);
    }
    closeModal('modal-deal'); render(); toast('Deal saved');
  } catch(e) { toast(e.message); }
}
async function deleteDeal(id) {
  const d = state.pipeline.find(x=>x.id===id);
  showConfirm(`Delete deal "${d?.name||'this deal'}"?`, async () => {
    await apiCall(`/pipeline/${id}`,{method:'DELETE'}); state.pipeline=state.pipeline.filter(d=>d.id!==id); render();
  });
}

// ── Clients ───────────────────────────────────────────────────────────────────
function renderClients(c) {
  if (!state.showArchivedClients) state.showArchivedClients = false;
  c.innerHTML=`
  <div class="clients-grid">
    <div class="card" style="max-height:680px;overflow-y:auto">
      <div class="card-header" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:center"><div class="card-title">Clients</div><span style="font-size:10px;padding:2px 8px;border-radius:4px;background:var(--info-bg);color:var(--info)">QuickBooks</span></div>
        <div style="display:flex;gap:6px"><button class="btn btn-sm" style="flex:1" onclick="syncSource('/clients/sync','QuickBooks')">↻ Sync</button><button class="btn btn-primary btn-sm" onclick="openAddClient()">+ Add</button></div>
        <button class="btn btn-sm" id="archive-toggle-btn" style="font-size:10px;color:var(--text-2)" onclick="toggleArchivedClients()">${state.showArchivedClients?'Hide Archived':'Show Archived'} (${state.clients.filter(x=>x.archived).length})</button>
      </div>
      <input type="text" class="search-input" id="client-search" placeholder="Search clients..." oninput="filterClients(this.value)">
      <div id="clients-list"></div>
    </div>
    <div id="client-detail-wrap"><div class="card" style="display:flex;align-items:center;justify-content:center;min-height:240px;color:var(--text-3);font-size:12px">Select a client to view details</div></div>
  </div>`;
  renderClientsList();
  if (state.selectedClientId) showClient(state.selectedClientId);
}

const CLIENT_COLORS=[['#f97316','rgba(249,115,22,0.15)'],['#3b82f6','rgba(59,130,246,0.15)'],['#22c55e','rgba(34,197,94,0.15)'],['#a855f7','rgba(168,85,247,0.15)'],['#ef4444','rgba(239,68,68,0.15)']];

function renderClientsList(filter='') {
  // Pre-compute AR-derived revenue per client (paid invoices only)
  const arByClient = {};
  state.ar.filter(x=>x.status==='paid').forEach(x=>{
    const key=(x.client||'').toLowerCase().trim();
    arByClient[key]=(arByClient[key]||0)+x.amount;
  });
  const list=state.clients.filter(c=>{
    if (!state.showArchivedClients && c.archived) return false;
    if (state.showArchivedClients && !c.archived) return false;
    return !filter||c.name.toLowerCase().includes(filter.toLowerCase())||c.type.toLowerCase().includes(filter.toLowerCase())||c.country.toLowerCase().includes(filter.toLowerCase());
  });
  const el=document.getElementById('clients-list'); if(!el) return;
  el.innerHTML=list.length ? list.map((c,i)=>{
    const init=c.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const col=CLIENT_COLORS[i%CLIENT_COLORS.length];
    const arRev=arByClient[(c.name||'').toLowerCase().trim()]||0;
    const displayRev=arRev||c.revenue;
    return `<div class="client-item${state.selectedClientId===c.id?' selected':''}" onclick="showClient(${c.id})" style="${c.archived?'opacity:.6':''}">
      <div class="client-avatar" style="background:${col[1]};color:${col[0]}">${init}</div>
      <div style="flex:1;min-width:0"><div class="client-name">${c.name}${c.archived?' <span style="font-size:9px;background:var(--surface-2);color:var(--text-3);padding:1px 5px;border-radius:3px;margin-left:4px">Archived</span>':''}</div><div class="client-sub">${c.type} · ${c.country}</div></div>
      <div style="font-size:12px;font-weight:600">${fmt(displayRev)}</div>
    </div>`;
  }).join('') : emptyState('No clients found', filter ? 'Try a different search term' : 'Add your first client to get started');
}
function filterClients(v){renderClientsList(v);}
function toggleArchivedClients() { state.showArchivedClients=!state.showArchivedClients; state.selectedClientId=null; render(); }

function showClient(id) {
  state.selectedClientId=id;
  const c=state.clients.find(x=>x.id===id); if(!c) return;
  renderClientsList(document.getElementById('client-search')?.value||'');
  // Derive revenue from paid AR invoices linked to this client
  const cInv=state.ar.filter(x=>x.client.toLowerCase()===c.name.toLowerCase()&&x.status==='paid');
  const arTotal=cInv.reduce((a,x)=>a+x.amount,0);
  const arSaas=cInv.filter(x=>x.revenueType==='Enterprise'||x.revenueType==='SaaS').reduce((a,x)=>a+x.amount,0);
  const arServ=cInv.filter(x=>x.revenueType!=='Enterprise'&&x.revenueType!=='SaaS').reduce((a,x)=>a+x.amount,0);
  const dispTotal=arTotal||c.revenue; const dispSaas=arTotal?arSaas:c.saas; const dispServ=arTotal?arServ:(c.services||0);
  const saasP=dispTotal?Math.round((dispSaas/dispTotal)*100):0;
  // Build last-6-month trend from invoice createdAt dates
  const now=new Date();
  const trendMonths=Array.from({length:6},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth()-5+i,1);return{label:d.toLocaleString('en',{month:'short'}),y:d.getFullYear(),m:d.getMonth()};});
  const trendData=trendMonths.map(mo=>cInv.filter(x=>{const d=new Date(x.createdAt||x.dueDate);return d.getFullYear()===mo.y&&d.getMonth()===mo.m;}).reduce((a,x)=>a+x.amount,0));
  const renewDays=Math.ceil((new Date(c.renewal+'T00:00:00')-TODAY)/864e5);
  const init=c.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('client-detail-wrap').innerHTML=`
  <div style="display:flex;flex-direction:column;gap:10px">
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:44px;height:44px;border-radius:50%;background:var(--primary-bg);border:1.5px solid var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--primary);font-size:14px;flex-shrink:0">${init}</div>
        <div style="flex:1"><div style="font-size:15px;font-weight:700">${c.name}</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">${c.type} · ${c.country}${c.fromQBO?' <span style="font-size:9px;padding:1px 6px;border-radius:3px;background:var(--info-bg);color:var(--info);margin-left:4px">QuickBooks</span>':''}</div></div>
        <button class="btn btn-sm" onclick="editClient(${c.id})">Edit</button>
        <button class="btn btn-sm" style="background:var(--warning-bg);color:var(--warning-text);border:1px solid rgba(217,119,6,.2)" onclick="archiveClient(${c.id})" title="${c.archived?'Unarchive':'Archive'}">${c.archived?'↩ Restore':'Archive'}</button>
        <button class="del-btn" onclick="deleteClient(${c.id})">×</button>
      </div>
      <div class="grid-2" style="gap:8px">
        <div class="metric"><div class="metric-label">Total Revenue</div><div class="metric-value">${fmt(dispTotal)}</div></div>
        <div class="metric"><div class="metric-label">SaaS Ratio</div><div class="metric-value">${saasP}%</div></div>
        <div class="metric"><div class="metric-label">SaaS Revenue</div><div class="metric-value">${fmt(dispSaas)}</div></div>
        <div class="metric"><div class="metric-label">Services</div><div class="metric-value">${fmt(dispServ)}</div></div>
      </div>
    </div>
    <div class="card"><div class="card-title" style="margin-bottom:10px">Revenue Trend — Last 6 Months</div><div class="chart-wrap chart-wrap-sm"><canvas id="chart-client-trend"></canvas></div></div>
    <div class="card">
      <div class="grid-2" style="gap:12px">
        <div><div class="card-title" style="margin-bottom:8px">SaaS vs Services</div><div style="height:140px;position:relative"><canvas id="chart-client-split"></canvas></div></div>
        <div>
          <div class="card-title" style="margin-bottom:8px">Contract Details</div>
          <div class="detail-row"><span class="detail-label">Renewal</span><span class="detail-value" style="color:${renewDays<90?'var(--danger-text)':'var(--text)'}">${fmtDate(c.renewal)} <span class="tag ${renewDays<60?'tag-danger':renewDays<90?'tag-warning':'tag-neutral'}" style="font-size:9px">${renewDays}d</span></span></div>
          <div class="detail-row"><span class="detail-label">Annual Value</span><span class="detail-value">${fmt(dispTotal)}</span></div>
          <div class="detail-row"><span class="detail-label">Country</span><span class="detail-value">${c.country}</span></div>
          <div class="detail-row"><span class="detail-label">Segment</span><span class="detail-value">${c.type}</span></div>
          ${c.contact?`<div class="detail-row"><span class="detail-label">Contact</span><span class="detail-value">${c.contact}</span></div>`:''}
          ${c.email?`<div class="detail-row"><span class="detail-label">Email</span><span class="detail-value"><a href="mailto:${c.email}" style="color:var(--primary);text-decoration:none">${c.email}</a></span></div>`:''}
          ${c.phone?`<div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value">${c.phone}</span></div>`:''}
          ${c.address?`<div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${c.address}</span></div>`:''}
          ${c.chargeAmount?`<div class="detail-row"><span class="detail-label">Monthly Charge</span><span class="detail-value">${fmt(c.chargeAmount)}${c.billingCycle?' <span style="font-size:10px;text-transform:capitalize;color:var(--text-2)">/ '+c.billingCycle+'</span>':''}</span></div>`:''}
          ${c.paymentTerms?`<div class="detail-row"><span class="detail-label">Payment Terms</span><span class="detail-value" style="text-transform:uppercase">${c.paymentTerms}</span></div>`:''}
          ${c.qbId?`<div class="detail-row"><span class="detail-label">QBO ID</span><span class="detail-value" style="font-family:monospace;font-size:10px;color:var(--text-2)">${c.qbId}</span></div>`:''}
        </div>
      </div>
    </div>
    <div class="card"><div class="card-title" style="margin-bottom:7px">CFO Notes</div><div style="font-size:12px;color:var(--text-2);line-height:1.6">${c.notes||'No notes added.'}</div></div>
    ${(()=>{
      const cDeals = state.pipeline.filter(d => d.client?.toLowerCase() === c.name.toLowerCase() && d.stage !== 'Closed Lost');
      if (!cDeals.length) return '';
      const stageCol = {'Closed Won':'var(--success)','Negotiation':'var(--primary)','Proposal':'var(--warning)','Qualification':'#7C3AED','Prospecting':'var(--text-2)','On Hold':'var(--text-3)'};
      return `<div class="card">
        <div class="card-header"><div class="card-title">Pipeline Deals</div><div class="card-desc">${cDeals.length} active deal${cDeals.length>1?'s':''}</div></div>
        <table class="table">
          <thead><tr><th>Deal</th><th>Channel</th><th style="text-align:right">Value</th><th>Probability</th><th>Close Date</th><th>Stage</th></tr></thead>
          <tbody>${cDeals.map(d=>`<tr>
            <td style="font-weight:600">${d.name}</td>
            <td style="font-size:11px;color:var(--text-2)">${d.type||'—'}</td>
            <td style="text-align:right">${fmt(d.value)}</td>
            <td><div style="display:flex;align-items:center;gap:5px"><div style="height:4px;width:40px;background:var(--surface-2);border-radius:2px;overflow:hidden"><div style="height:100%;width:${d.probability}%;background:var(--primary)"></div></div><span style="font-size:10px">${d.probability}%</span></div></td>
            <td style="font-size:11px;color:var(--text-2)">${fmtDate(d.closeDate)||'—'}</td>
            <td><span style="font-size:10px;color:${stageCol[d.stage]||'var(--text-2)'}">● ${d.stage}</span></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    })()}
  </div>`;
  setTimeout(()=>{
    mkChart('chart-client-trend','line',{
      labels:trendMonths.map(m=>m.label),
      datasets:[{data:trendData,borderColor:'#FF6600',backgroundColor:'rgba(255,102,0,0.07)',fill:true,borderWidth:2,pointRadius:3,pointBackgroundColor:'#FF6600',tension:.3}]
    });
    mkDoughnut('chart-client-split',['Enterprise/SaaS','Services'],[dispSaas,dispServ],['#FF6600','#2563EB']);
  },50);
}

function openAddClient() {
  document.getElementById('client-modal-title').textContent='Add Client';
  ['cl-name','cl-revenue','cl-saas','cl-notes','cl-contact','cl-email','cl-phone','cl-address','cl-charge-amount'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('cl-type').value='Enterprise'; document.getElementById('cl-renewal').value='2027-01-01';
  setSelectValue(document.getElementById('cl-billing-cycle'), '');
  setSelectValue(document.getElementById('cl-payment-terms'), '');
  delete document.getElementById('modal-client').dataset.editId; openModal('modal-client');
}
function editClient(id) {
  const c=state.clients.find(x=>x.id===id); if(!c) return;
  document.getElementById('client-modal-title').textContent='Edit — '+c.name;
  document.getElementById('cl-name').value=c.name;
  setSelectValue(document.getElementById('cl-type'), c.type);
  setSelectValue(document.getElementById('cl-country'), c.country);
  document.getElementById('cl-revenue').value=c.revenue;
  document.getElementById('cl-saas').value=c.saas; document.getElementById('cl-renewal').value=c.renewal;
  document.getElementById('cl-notes').value=c.notes||'';
  document.getElementById('cl-contact').value=c.contact||'';
  document.getElementById('cl-email').value=c.email||'';
  document.getElementById('cl-phone').value=c.phone||'';
  document.getElementById('cl-address').value=c.address||'';
  document.getElementById('cl-charge-amount').value=c.chargeAmount||'';
  setSelectValue(document.getElementById('cl-billing-cycle'), c.billingCycle||'');
  setSelectValue(document.getElementById('cl-payment-terms'), c.paymentTerms||'');
  document.getElementById('modal-client').dataset.editId=id; openModal('modal-client');
}
async function saveClient() {
  const name=document.getElementById('cl-name').value.trim(); if(!name){toast('Name required');return;}
  const data={name,type:document.getElementById('cl-type').value,country:document.getElementById('cl-country').value||'—',revenue:parseInt(document.getElementById('cl-revenue').value)||0,saas:parseInt(document.getElementById('cl-saas').value)||0,renewal:document.getElementById('cl-renewal').value||'2027-01-01',notes:document.getElementById('cl-notes').value,contact:document.getElementById('cl-contact').value.trim(),email:document.getElementById('cl-email').value.trim(),phone:document.getElementById('cl-phone').value.trim(),address:document.getElementById('cl-address').value.trim(),chargeAmount:parseFloat(document.getElementById('cl-charge-amount').value)||0,billingCycle:document.getElementById('cl-billing-cycle').value||'',paymentTerms:document.getElementById('cl-payment-terms').value||''};
  const eid=document.getElementById('modal-client').dataset.editId;
  try {
    if (eid) { const r=await apiCall(`/clients/${eid}`,{method:'PUT',body:JSON.stringify(data)}); const i=state.clients.findIndex(c=>c.id===Number(eid)); if(i>-1) state.clients[i]=r.client; state.selectedClientId=Number(eid); }
    else { const r=await apiCall('/clients',{method:'POST',body:JSON.stringify(data)}); state.clients.push(r.client); state.selectedClientId=r.client.id; }
    closeModal('modal-client'); render(); toast('Client saved');
  } catch(e){toast(e.message);}
}
async function archiveClient(id) {
  const c = state.clients.find(x=>x.id===id);
  const action = c?.archived ? 'Restore' : 'Archive';
  showConfirm(`${action} "${c?.name||'this client'}"?`, async () => {
    const r = await apiCall(`/clients/${id}/archive`, {method:'PUT'});
    const i = state.clients.findIndex(x=>x.id===id);
    if (i>-1) state.clients[i] = r.client;
    state.selectedClientId = null;
    render();
    toast(`Client ${r.client.archived?'archived':'restored'}`);
  }, { okLabel: action, okClass: c?.archived ? 'btn-primary' : 'btn-warning' });
}
async function deleteClient(id) {
  const c = state.clients.find(x=>x.id===id);
  showConfirm(`Delete "${c?.name||'this client'}"? This cannot be undone.`, async () => {
    await apiCall(`/clients/${id}`,{method:'DELETE'});
    state.clients=state.clients.filter(c=>c.id!==id); state.selectedClientId=null; render();
  }, { okLabel:'Delete Client', okClass:'btn-danger' });
}

// ── Liabilities ───────────────────────────────────────────────────────────────
function renderLiabilities(c) {
  const totalLiab = state.liabilities.reduce((s,cat)=>{
    cat.total=(cat.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0); return s+cat.total;
  },0);
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Total Liabilities</div><div class="card-desc">${state.liabilities.length} categories</div></div>
          <button class="btn btn-primary btn-sm" onclick="addLiabCategory()">+ Category</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:var(--danger-bg);border:1px solid rgba(220,38,38,.2);border-radius:9px;padding:12px 16px;margin-bottom:14px">
          <span style="font-size:12px;color:var(--danger-text);font-weight:600">Total Outstanding</span>
          <span style="font-family:'Montserrat',sans-serif;font-size:22px;font-weight:700;color:var(--danger)">${fmt(totalLiab)}</span>
        </div>
        <div class="chart-wrap chart-wrap-lg"><canvas id="liab-chart"></canvas></div>
      </div>
      <div class="card" style="overflow-y:auto;max-height:500px">
        <div class="card-title" style="margin-bottom:12px">Category Breakdown</div>
        ${state.liabilities.map(cat=>{
          const catTotal=(cat.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0);
          const pct=totalLiab?Math.round((catTotal/totalLiab)*100):0;
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:12px;font-weight:600">${cat.name}</span>
              <span style="font-family:'Montserrat',sans-serif;font-weight:700;color:var(--danger-text)">${fmt(catTotal)}</span>
            </div>
            <div style="height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden;margin-bottom:4px"><div style="height:100%;border-radius:3px;background:var(--danger);width:${pct}%"></div></div>
            <div style="font-size:10px;color:var(--text-3)">${pct}% of total · ${cat.breakdown?.length||0} items</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div id="liab-categories">
      ${state.liabilities.map((cat,ci)=>{
        const catTotal=(cat.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0);
        return `<div class="liab-cat">
          <div class="liab-cat-header" onclick="toggleLiabCat(${ci})">
            <div style="display:flex;align-items:center;gap:10px">
              <span id="liab-arrow-${ci}" style="font-size:10px;color:var(--text-3)">${state.liabExpanded.has(ci)?'▼':'▶'}</span>
              <span class="liab-cat-name">${cat.name}</span>
              <span style="font-size:10px;color:var(--text-2)">${cat.breakdown?.length||0} items</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="liab-cat-total">${fmt(catTotal)}</span>
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openAddLiabRow(${cat.id})">+ Row</button>
              <button class="del-btn" onclick="event.stopPropagation();deleteLiabCat(${cat.id})">×</button>
            </div>
          </div>
          <div class="liab-breakdown" id="liab-body-${ci}" style="display:${state.liabExpanded.has(ci)?'block':'none'}">
            ${cat.breakdown?.length ? `
            <table class="table" style="margin-bottom:8px">
              <thead><tr><th>Description</th><th>Due Date</th><th style="text-align:right">Amount</th><th></th></tr></thead>
              <tbody>${(cat.breakdown||[]).map(row=>`
                <tr>
                  <td>${row.name}</td>
                  <td>${row.dueDate?`<span class="${daysTo(row.dueDate)<0?'val-neg':daysTo(row.dueDate)<7?'val-neg':''}">${fmtDate(row.dueDate)} ${cdBadge(row.dueDate)}</span>`:'—'}</td>
                  <td style="text-align:right;font-weight:600;color:var(--danger-text)">${fmt(row.amount)}</td>
                  <td><button class="del-btn" onclick="deleteLiabRow(${cat.id},${row.id})">×</button></td>
                </tr>`).join('')}
              </tbody>
            </table>` : '<div style="font-size:11px;color:var(--text-3);padding:8px 0">No items — click + Row to add</div>'}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  setTimeout(()=>{
    const lLabels=state.liabilities.map(l=>l.name);
    const lData=state.liabilities.map(l=>(l.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0));
    mkDoughnut('liab-chart',lLabels,lData,['#DC2626','#D97706','#7C3AED','#2563EB','#FF6600']);
  },50);
}

function toggleLiabCat(ci) {
  if (state.liabExpanded.has(ci)) state.liabExpanded.delete(ci);
  else state.liabExpanded.add(ci);
  const body=document.getElementById(`liab-body-${ci}`), arrow=document.getElementById(`liab-arrow-${ci}`);
  if(body) body.style.display=state.liabExpanded.has(ci)?'block':'none';
  if(arrow) arrow.textContent=state.liabExpanded.has(ci)?'▼':'▶';
}

function addLiabCategory() {
  document.getElementById('liab-cat-name').value='';
  openModal('modal-liab-cat');
}

async function saveLiabCategory() {
  const name=document.getElementById('liab-cat-name').value.trim(); if(!name) { toast('Name required'); return; }
  try { const r=await apiCall('/liabilities',{method:'POST',body:JSON.stringify({name})}); state.liabilities.push(r.category); closeModal('modal-liab-cat'); render(); toast('Category added'); } catch(e){toast(e.message);}
}

async function deleteLiabCat(id) {
  showConfirm('Delete this category and all its rows?', async ()=>{
    await apiCall(`/liabilities/${id}`,{method:'DELETE'}); state.liabilities=state.liabilities.filter(c=>c.id!==id); render();
  });
}

let _liabCatId=null;
function openAddLiabRow(catId) {
  _liabCatId=catId;
  document.getElementById('liab-modal-title').textContent='Add Liability Row';
  document.getElementById('liab-modal-content').innerHTML=`
    <div class="form-row"><label>Description</label><input type="text" id="liab-row-name" placeholder="e.g. AWS Cloud Services"></div>
    <div class="form-row"><label>Due Date</label><input type="date" id="liab-row-due"></div>
    <div class="form-row"><label>Amount ($)</label><input type="number" id="liab-row-amount" placeholder="42000"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal('modal-liability')">Cancel</button><button class="btn btn-primary" onclick="saveLiabRow()">Add Row</button></div>`;
  openModal('modal-liability');
}

async function saveLiabRow() {
  const name=document.getElementById('liab-row-name').value.trim();
  const dueDate=document.getElementById('liab-row-due').value;
  const amount=Number(document.getElementById('liab-row-amount').value)||0;
  if(!name||!amount){toast('Name and amount required');return;}
  try {
    const r=await apiCall(`/liabilities/${_liabCatId}/breakdown`,{method:'POST',body:JSON.stringify({name,dueDate,amount})});
    const cat=state.liabilities.find(c=>c.id===_liabCatId);
    if(cat){cat.breakdown.push(r.row);cat.total=r.category.total;}
    closeModal('modal-liability'); render(); toast('Row added');
  } catch(e){toast(e.message);}
}

async function deleteLiabRow(catId,rowId) {
  try {
    const r=await apiCall(`/liabilities/${catId}/breakdown/${rowId}`,{method:'DELETE'});
    const cat=state.liabilities.find(c=>c.id===catId);
    if(cat){cat.breakdown=cat.breakdown.filter(b=>b.id!==rowId);cat.total=r.category.total;}
    render(); toast('Row deleted');
  } catch(e){toast(e.message);}
}

// ── Account Receivables ───────────────────────────────────────────────────────
function renderAR(c) {
  const pending = state.ar.filter(x=>x.status==='pending');
  const overdue  = state.ar.filter(x=>x.status==='overdue');
  const paid     = state.ar.filter(x=>x.status==='paid');
  const totalPending = pending.reduce((s,x)=>s+x.amount,0);
  const totalOverdue = overdue.reduce((s,x)=>s+x.amount,0);
  const unlinked = state.ar.filter(x=>!x.clientId);

  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    ${unlinked.length>0?`<div style="background:rgba(220,38,38,0.07);border:1px solid rgba(220,38,38,0.2);border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px">
      <span>🔗 <strong>${unlinked.length} invoice${unlinked.length>1?'s':''}</strong> have client names that don't match any client record (e.g. a typo). Unlinked invoices are excluded from client-level analytics.</span>
      <button class="btn btn-sm" style="font-size:10px;white-space:nowrap;flex-shrink:0;color:var(--danger)" onclick="fixArUnlinked()">Fix Unlinked →</button>
    </div>`:''}
    <div class="grid-3" style="margin-bottom:2px">
      <div class="metric"><div class="metric-label">Pending</div><div class="metric-value" style="color:var(--info)">${fmt(totalPending)}</div><div class="metric-sub">${pending.length} invoices</div></div>
      <div class="metric"><div class="metric-label">Overdue</div><div class="metric-value" style="color:var(--danger)">${fmt(totalOverdue)}</div><div class="metric-sub">${overdue.length} invoices</div></div>
      <div class="metric"><div class="metric-label">Collected YTD</div><div class="metric-value" style="color:var(--success)">${fmt(paid.reduce((s,x)=>s+x.amount,0))}</div><div class="metric-sub">${paid.length} invoices</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">AR by Status</div></div>
        <div class="chart-wrap chart-wrap-lg"><canvas id="ar-chart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">AR by Client</div></div>
        <div class="chart-wrap chart-wrap-lg"><canvas id="ar-client-chart"></canvas></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">All Receivables</div><div class="card-desc">Track outstanding invoices by client</div></div>
        <div style="display:flex;gap:6px">
          ${isViewerRole()?'':`<button class="btn btn-sm" onclick="syncARToQBO(event)" style="font-size:11px">↻ Push to QBO</button>`}
          ${isViewerRole()?'':`<button class="btn btn-primary btn-sm" onclick="openAddAR()">+ Add AR</button>`}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:0 0 12px;flex-wrap:wrap">
        <div style="display:flex;gap:4px">
          ${[{v:'',l:'All'},{v:'pending',l:'Pending'},{v:'overdue',l:'Overdue'},{v:'paid',l:'Paid'},{v:'sent',l:'Sent'}].map(({v,l})=>`<button onclick="setArFilter('status','${v}')" style="font-size:11px;padding:4px 12px;border-radius:20px;border:1px solid ${state._arFilter.status===v?'var(--primary)':'var(--border)'};background:${state._arFilter.status===v?'var(--primary-bg)':'var(--surface-2)'};color:${state._arFilter.status===v?'var(--primary)':'var(--text-2)'};cursor:pointer;font-weight:${state._arFilter.status===v?'700':'400'};transition:all .15s">${l}</button>`).join('')}
        </div>
        <input type="text" placeholder="Search client or invoice…" value="${state._arFilter.q||''}" oninput="setArFilter('q',this.value)" style="font-size:12px;padding:5px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--text);outline:none;min-width:180px;flex:1;max-width:280px">
        ${(state._arFilter.status||state._arFilter.q)?`<button onclick="clearArFilter()" style="font-size:11px;padding:4px 10px;border-radius:8px;border:1px solid var(--border);background:none;color:var(--text-2);cursor:pointer">✕ Clear</button>`:''}
      </div>
      <div style="overflow-x:auto">
        ${(()=>{
          const f = state._arFilter;
          const filtered = state.ar.filter(x => {
            if (f.status && x.status !== f.status) return false;
            if (f.q) { const q=f.q.toLowerCase(); if(!x.client.toLowerCase().includes(q)&&!(x.invoice||'').toLowerCase().includes(q)) return false; }
            return true;
          });
          const {slice:arSlice, ctrl:arCtrl} = _paginate(filtered, 'ar'); return `
        <table class="table">
          <thead><tr><th>Client</th><th>Invoice</th><th>Issued</th><th>Due Date</th><th style="text-align:right">Amount</th><th>Status</th><th>Type</th><th>Days</th><th></th></tr></thead>
          <tbody>${arSlice.map(x=>{
            const days=daysTo(x.dueDate);
            const statusColor={pending:'var(--info)',sent:'var(--primary)',overdue:'var(--danger)',paid:'var(--success)'}[x.status]||'var(--text-2)';
            return `<tr>
              <td><strong>${x.client}</strong>${x.pipelineDealId?`<div style="font-size:9px;color:var(--primary);margin-top:2px;font-weight:600">📎 Pipeline</div>`:''}${x.qboId?`<div style="font-size:9px;color:#0AB27D;font-weight:600;margin-top:1px">QB #${x.qboId}</div>`:''}</td>
              <td style="font-family:monospace;font-size:11px;color:var(--text-2)">${x.invoice||'—'}</td>
              <td style="font-size:11px;color:var(--text-2)">${x.issuedDate?fmtDate(x.issuedDate):'—'}</td>
              <td>${x.dueDate?fmtDate(x.dueDate):'—'}</td>
              <td style="text-align:right;font-weight:700;font-family:'Montserrat',sans-serif">${fmt(x.amount)}</td>
              <td><span class="tag" style="background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}33;text-transform:capitalize">${x.status}</span></td>
              <td style="font-size:11px;color:var(--text-2)">${x.revenueType||'—'}</td>
              <td>${x.dueDate?cdBadge(x.dueDate):'—'}</td>
              <td style="display:flex;gap:4px">
                ${isViewerRole()?'':`<button class="btn btn-sm" style="font-size:10px;padding:2px 7px" onclick="openEditAR(${x.id})">Edit</button>`}
                ${isViewerRole()?`<span class="tag" style="text-transform:capitalize;font-size:10px">${x.status}</span>`:`<select class="input" style="font-size:11px;padding:3px 6px;width:90px" onchange="updateARStatus(${x.id},this.value)">
                  <option value="pending"${x.status==='pending'?' selected':''}>Pending</option>
                  <option value="sent"${x.status==='sent'?' selected':''}>Sent</option>
                  <option value="overdue"${x.status==='overdue'?' selected':''}>Overdue</option>
                  <option value="paid"${x.status==='paid'?' selected':''}>Paid</option>
                </select>`}
                ${isViewerRole()?'':`<button class="del-btn" onclick="deleteAR(${x.id})">×</button>`}
              </td>
            </tr>`;}).join('')}
          </tbody>
        </table>
        ${arCtrl}`; })()}
      </div>
    </div>
  </div>`;

  setTimeout(()=>{
    mkDoughnut('ar-chart',['Pending','Overdue','Paid'],[totalPending,totalOverdue,paid.reduce((s,x)=>s+x.amount,0)],['#2563EB','#DC2626','#16A34A']);
    // Group by client, color by predominant status (overdue = red, pending = blue)
    const byClient={}, byClientStatus={};
    state.ar.filter(x=>x.status!=='paid').forEach(x=>{
      byClient[x.client]=(byClient[x.client]||0)+x.amount;
      if (x.status==='overdue') byClientStatus[x.client]='overdue';
      else if (!byClientStatus[x.client]) byClientStatus[x.client]='pending';
    });
    const cLabels=Object.keys(byClient), cData=Object.values(byClient);
    const cColors=cLabels.map(c=>byClientStatus[c]==='overdue'?'#DC2626':'#2563EB');
    mkChart('ar-client-chart','bar',{labels:cLabels,datasets:[{data:cData,backgroundColor:cColors,borderRadius:5}]},{plugins:{legend:{display:true,labels:{generateLabels:()=>[{text:'Overdue',fillStyle:'#DC2626'},{text:'Pending',fillStyle:'#2563EB'}]}}}});
  },50);
}

async function saveAR() {
  const client=document.getElementById('ar-client').value.trim();
  const invoice=document.getElementById('ar-invoice').value.trim();
  const issuedDate=document.getElementById('ar-issued')?.value||'';
  const dueDate=document.getElementById('ar-due').value;
  const amount=Number(document.getElementById('ar-amount').value)||0;
  const status=document.getElementById('ar-status').value;
  const revenueType=document.getElementById('ar-rev-type')?.value||'';
  const planType=document.getElementById('ar-plan-type')?.value||'';
  if(!client||!amount){toast('Client and amount required');return;}
  if(!issuedDate){toast('Issued date is required');document.getElementById('ar-issued')?.focus();return;}
  const eid=document.getElementById('modal-ar').dataset.editId;

  // For new invoices, check if client exists; if not, offer to create
  if(!eid && !_arSkipClientCheck) {
    try {
      const chk=await apiCall(`/ar/check-client?name=${encodeURIComponent(client)}`);
      if(!chk.exists) {
        // Show inline client-not-found banner inside the modal
        const warn=document.getElementById('ar-client-warn');
        if(warn){
          warn.style.display='block';
          warn.innerHTML=`<div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:7px;padding:10px 12px;font-size:11px;color:var(--warning-text);display:flex;align-items:center;justify-content:space-between;gap:10px">
            <span>⚠ <strong>${client}</strong> is not in your client list.</span>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="btn btn-sm" style="font-size:10px;padding:3px 10px" onclick="document.getElementById('ar-client-warn').style.display='none';_arSkipClientCheck=true;saveAR()">Save Anyway</button>
              <button class="btn btn-primary btn-sm" style="font-size:10px;padding:3px 10px" onclick="quickAddClientFromAR('${client.replace(/'/g,"\\'")}')">+ Add Client</button>
            </div>
          </div>`;
          return;
        }
      }
    } catch(e){}
  }
  _arSkipClientCheck=false;

  try {
    const payload={client,invoice,issuedDate,dueDate,amount,status,revenueType,planType};
    let clientUpdated=false;
    if(eid){
      const r=await apiCall(`/ar/${eid}`,{method:'PUT',body:JSON.stringify(payload)});
      const i=state.ar.findIndex(x=>x.id===Number(eid));
      if(i>-1)state.ar[i]={...state.ar[i],...r.item};
    } else {
      const r=await apiCall('/ar',{method:'POST',body:JSON.stringify(payload)});
      state.ar.push(r.item);
      clientUpdated=r.clientUpdated||false;
      if(clientUpdated) {
        const updatedClients=await apiCall('/clients');
        state.clients=updatedClients;
      }
    }
    closeModal('modal-ar'); render();
    toast(eid ? 'Invoice updated' : `Invoice added${clientUpdated ? ` · ${client}'s revenue updated`:''}`);
  } catch(e){toast(e.message);}
}
let _arSkipClientCheck=false;
async function quickAddClientFromAR(name) {
  try {
    const r=await apiCall('/clients',{method:'POST',body:JSON.stringify({name,type:'Enterprise',country:'—',revenue:0,saas:0})});
    state.clients.push(r.client);
    document.getElementById('ar-client-warn').style.display='none';
    toast(`Client "${name}" created`);
    _arSkipClientCheck=true;
    saveAR();
  } catch(e){toast('Failed to create client: '+e.message);}
}
async function syncARToQBO(ev) {
  const btn=ev?.target;
  if(btn){btn.textContent='Syncing…';btn.disabled=true;}
  try {
    const r=await apiCall('/ar/sync-to-qbo',{method:'POST'});
    const fresh=await apiCall('/ar');
    state.ar=fresh;
    render();
    toast(r.message||(r.pushed+' invoice(s) pushed to QuickBooks'));
  } catch(e){toast(e.message);}
  finally{if(btn){btn.textContent='↻ Push to QBO';btn.disabled=false;}}
}

function setArFilter(key, val) {
  state._arFilter[key] = val;
  state._pages['ar'] = 0;
  render();
}
function clearArFilter() {
  state._arFilter = { status: '', q: '' };
  state._pages['ar'] = 0;
  render();
}

function fixArUnlinked() {
  const unlinked = state.ar.filter(x=>!x.clientId);
  if (!unlinked.length) { toast('No unlinked invoices'); return; }
  const clientOpts = (state.clients||[]).filter(c=>!c.archived)
    .map(c=>`<option value="${c.name.replace(/"/g,'&quot;')}">${c.name}</option>`).join('');
  const old = document.getElementById('ar-fix-panel');
  if (old) old.remove();
  const panel = document.createElement('div');
  panel.id = 'ar-fix-panel';
  panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.52);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';
  panel.innerHTML=`
    <div style="background:var(--surface);border-radius:12px;padding:24px;max-width:600px;width:100%;max-height:82vh;overflow-y:auto;box-shadow:var(--shadow-lg)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div style="font-size:15px;font-weight:700">Fix Unlinked Invoices (${unlinked.length})</div>
        <button class="modal-close" onclick="document.getElementById('ar-fix-panel').remove()">×</button>
      </div>
      <div style="font-size:11px;color:var(--text-2);margin-bottom:14px">The invoice client names below do not match any record in your client list — likely a typo (e.g. "JU" instead of "JJ"). Select the correct client and click Link.</div>
      ${unlinked.map(x=>`
        <div id="fix-row-${x.id}" style="padding:10px 0;border-bottom:0.5px solid var(--border);display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--danger)">"${x.client||'(blank)'}"</div>
            <div style="font-size:10px;color:var(--text-3)">${x.invoice||'No inv#'} · ${fmt(x.amount)} · ${x.status}</div>
          </div>
          <select id="fix-cl-${x.id}" class="input" style="font-size:11px;padding:4px 8px">
            <option value="">— select correct client —</option>
            ${clientOpts}
          </select>
          <button class="btn btn-primary btn-sm" style="font-size:10px;padding:4px 12px;white-space:nowrap" onclick="relinkAR(${x.id})">Link</button>
        </div>`).join('')}
      <div style="margin-top:14px;text-align:right">
        <button class="btn" onclick="document.getElementById('ar-fix-panel').remove()">Close</button>
      </div>
    </div>`;
  document.body.appendChild(panel);
}

async function relinkAR(id) {
  const sel = document.getElementById('fix-cl-'+id);
  const newClient = sel?.value;
  if (!newClient) { toast('Select a client first'); return; }
  const item = state.ar.find(x=>x.id===id);
  if (!item) return;
  try {
    const r = await apiCall(`/ar/${id}`,{method:'PUT',body:JSON.stringify({...item,client:newClient})});
    const idx = state.ar.findIndex(x=>x.id===id);
    if (idx>-1) state.ar[idx] = {...state.ar[idx],...r.item};
    const row = document.getElementById('fix-row-'+id);
    if (row) { row.style.opacity='0.4'; row.style.pointerEvents='none'; row.querySelector('div').innerHTML=`<div style="font-size:11px;color:var(--success)">✓ Linked to "${newClient}"</div>`; }
    toast(`Invoice relinked to "${newClient}"`);
    setTimeout(()=>render(),600);
  } catch(e) { toast('Error: '+e.message); }
}

function _arShowPlanRow(type) {
  const row=document.getElementById('ar-plan-row');
  if(row) row.style.display=type==='Enterprise'?'block':'none';
}
function _populateClientDL() {
  const dl = document.getElementById('dl-ar-clients'); if (!dl) return;
  dl.innerHTML = (state.clients || []).filter(c => !c.archived).map(c => `<option value="${c.name.replace(/"/g,'&quot;')}">`).join('');
}
function _populateDealDL() {
  const dl = document.getElementById('dl-pipeline-deals'); if (!dl) return;
  dl.innerHTML = (state.pipeline || []).filter(d => d.stage !== 'Closed Lost').map(d => `<option value="${(d.name||'').replace(/"/g,'&quot;')}">`).join('');
}
function _populateOwnerDL(currentVal) {
  const sel = document.getElementById('deal-owner'); if (!sel) return;
  const archivedReps = state.commSettings?.archivedReps || [];
  const customReps   = state.commSettings?.customReps   || [];
  const fromComms    = (state.commissions || []).map(c => c.repName).filter(Boolean);
  const fromPipeline = (state.pipeline    || []).map(d => d.owner).filter(Boolean);
  const all = [...new Set([...fromComms, ...fromPipeline, ...customReps])];
  const active = all.filter(r => !archivedReps.includes(r)).sort();
  const opts = ['<option value="">— select rep —</option>',
    ...active.map(r => `<option value="${r.replace(/"/g,'&quot;')}"${r===currentVal?' selected':''}>` + r.replace(/</g,'&lt;') + '</option>'),
    // keep current value selectable even if archived/not in list
    ...(currentVal && !active.includes(currentVal) ? [`<option value="${currentVal.replace(/"/g,'&quot;')}" selected>${currentVal.replace(/</g,'&lt;')} (archived)</option>`] : [])
  ];
  sel.innerHTML = opts.join('');
}
function autoFillCommFromDeal(dealName) {
  const deal = (state.pipeline || []).find(d => d.name?.toLowerCase() === dealName.toLowerCase());
  if (!deal) return;
  const clientEl = document.getElementById('comm-client');
  const valueEl  = document.getElementById('comm-value');
  if (clientEl && !clientEl.value) clientEl.value = deal.client || '';
  if (valueEl  && !valueEl.value)  { valueEl.value = deal.value || ''; calcCommAmt(); }
}

function openAddAR(){
  document.getElementById('modal-ar').dataset.editId='';
  document.getElementById('ar-modal-title').textContent='Add Invoice';
  ['ar-client','ar-invoice','ar-amount'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('ar-due').value='';
  const issuedEl=document.getElementById('ar-issued'); if(issuedEl) issuedEl.value=TODAY.toISOString().split('T')[0];
  document.getElementById('ar-status').value='pending';
  const rt=document.getElementById('ar-rev-type');if(rt)rt.value='Services';
  const pt=document.getElementById('ar-plan-type');if(pt)pt.value='';
  _arShowPlanRow('');
  const w=document.getElementById('ar-client-warn');if(w)w.style.display='none';
  _arSkipClientCheck=false;
  _populateClientDL();
  openModal('modal-ar');
}
function openEditAR(id){
  const x=state.ar.find(a=>a.id===id);if(!x)return;
  document.getElementById('modal-ar').dataset.editId=id;
  document.getElementById('ar-modal-title').textContent='Edit AR Entry';
  document.getElementById('ar-client').value=x.client||'';
  document.getElementById('ar-invoice').value=x.invoice||'';
  const issuedEl2=document.getElementById('ar-issued'); if(issuedEl2) issuedEl2.value=x.issuedDate||'';
  document.getElementById('ar-due').value=x.dueDate||'';
  document.getElementById('ar-amount').value=x.amount||0;
  setSelectValue(document.getElementById('ar-status'), x.status||'pending');
  const rt=document.getElementById('ar-rev-type'); if(rt) setSelectValue(rt, x.revenueType||'Services');
  const pt=document.getElementById('ar-plan-type'); if(pt) setSelectValue(pt, x.planType||'');
  _arShowPlanRow(x.revenueType||'');
  _populateClientDL();
  openModal('modal-ar');
}

async function updateARStatus(id,status) {
  try {
    await apiCall(`/ar/${id}`,{method:'PUT',body:JSON.stringify({status})});
    const x=state.ar.find(a=>a.id===id); if(x) x.status=status;
    render();
  } catch(e){toast(e.message);}
}

async function markARPaid(id) {
  await updateARStatus(id, 'paid');
  toast('Invoice marked as paid');
}

async function deleteAR(id) {
  showConfirm('Delete this AR entry?', async () => {
    await apiCall(`/ar/${id}`,{method:'DELETE'}); state.ar=state.ar.filter(x=>x.id!==id); render();
  });
}

// ── Financial Statements ──────────────────────────────────────────────────────
async function renderStatements(c) {
  if (!state.statements) {
    try { const [pnl,bs]=await Promise.all([apiCall('/statements/pnl'),apiCall('/statements/balance-sheet')]); state.statements={pnl,balanceSheet:bs}; } catch{}
  }
  const pnl=state.statements?.pnl;
  const bs=state.statements?.balanceSheet;
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab active" onclick="switchView(this,'stmt-pnl')">Profit & Loss</button>
      <button class="view-tab" onclick="switchView(this,'stmt-bs')">Balance Sheet</button>
      <button class="view-tab" onclick="switchView(this,'stmt-recon')">Reconciliation</button>
    </div>
    <div class="view-panel active" id="stmt-pnl">
      <div class="card" style="padding:0">
        <div class="card-header" style="padding:16px 20px;border-bottom:1px solid var(--border)">
          <div>
            <div class="card-title">Profit & Loss Statement</div>
            <div style="font-size:11px;color:var(--text-2);margin-top:2px">Fiscal Year ${pnl?.year||2026} · Monthly actuals · QBO + manual</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span id="pnl-dirty" style="display:none;font-size:11px;color:var(--warning-text);font-weight:600">⚠ Unsaved changes</span>
            <button class="btn btn-sm" id="pnl-future-toggle" onclick="togglePnLFutureColumns()" title="Show/hide future months">Hide future</button>
            <button class="btn btn-primary btn-sm" id="pnl-save-btn" style="display:none" onclick="savePnL()">Save P&L</button>
            <button class="btn btn-sm" onclick="exportStatementPDF('pnl')" title="Export as PDF">⬇ PDF</button>
          </div>
        </div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
          <table style="border-collapse:collapse;table-layout:fixed;width:100%;min-width:900px;font-size:12px">
            <colgroup>
              <col style="width:185px">
              ${MO.map(()=>'<col style="width:1fr">').join('')}
              <col style="width:95px">
            </colgroup>
            <thead>
              <tr style="background:var(--surface-2);border-bottom:2px solid var(--border)">
                <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-2);position:sticky;left:0;background:var(--surface-2);z-index:3;border-right:2px solid var(--border)">Line Item</th>
                ${MO.map(m=>`<th style="padding:10px 4px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-2)">${m}</th>`).join('')}
                <th style="padding:10px 10px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text);background:var(--surface-2);border-left:2px solid var(--border)">FY Total</th>
              </tr>
            </thead>
            <tbody>${renderPnLRows(pnl)}</tbody>
          </table>
        </div>
        ${(()=>{
          const paidComm = (state.commissions||[]).filter(c=>c.status==='paid').reduce((a,c)=>a+(c.amount||0),0);
          const pendingComm = (state.commissions||[]).filter(c=>c.status!=='paid'&&c.status!=='rejected').reduce((a,c)=>a+(c.amount||0),0);
          if (!paidComm && !pendingComm) return '';
          if (paidComm > 0) return `<div style="padding:10px 16px;background:rgba(37,99,235,0.05);border-top:1px solid rgba(37,99,235,0.15);font-size:11px;color:var(--info-text);display:flex;align-items:center;gap:8px">
            <span style="font-size:14px">💰</span>
            <span><strong>${fmt(paidComm)} in paid commissions auto-included</strong> as "Sales Commissions" OpEx row above.${pendingComm>0?` ${fmt(pendingComm)} pending/approved not yet included.`:''} <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="showSection('commissions')">View Commissions →</button></span>
          </div>`;
          return `<div style="padding:10px 16px;background:rgba(217,119,6,0.07);border-top:1px solid rgba(217,119,6,0.2);font-size:11px;color:var(--warning-text);display:flex;align-items:center;gap:8px">
            <span style="font-size:14px">⚠</span>
            <span><strong>${fmt(pendingComm)} in pending commissions</strong> not yet reflected in P&L — mark as Paid to auto-include. <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;margin-left:4px" onclick="showSection('commissions')">View Commissions →</button></span>
          </div>`;
        })()}
      </div>
    </div>
    <div class="view-panel" id="stmt-bs">
      <div class="card" style="padding:0">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <div>
            <div class="card-title">Balance Sheet</div>
            <div style="font-size:11px;color:var(--text-2);margin-top:2px">As of ${bs?.asOf||'2026-04-30'}${bs?.lastSynced?` · Synced ${new Date(bs.lastSynced).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`:' · <span style="color:var(--warning)">Not yet synced — use ↻ Sync All</span>'}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span id="bs-dirty" style="display:none;font-size:11px;color:var(--warning-text);font-weight:600">⚠ Unsaved changes</span>
            <button class="btn btn-sm" onclick="syncBsAll()" title="Sync Assets & Liabilities from live modules">↻ Sync All</button>
            <button class="btn btn-sm" onclick="exportStatementPDF('bs')">⬇ PDF</button>
            <button class="btn btn-primary btn-sm" onclick="saveBalanceSheet()">Save</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;overflow-x:auto">
          ${(()=>{
            const bsTotals={assets:(bs?.assets||[]).reduce((a,i)=>a+i.value,0),liabilities:(bs?.liabilities||[]).reduce((a,i)=>a+i.value,0),equity:(bs?.equity||[]).reduce((a,i)=>a+i.value,0)};
            const lplusE=bsTotals.liabilities+bsTotals.equity;
            const diff=Math.abs(bsTotals.assets-lplusE);
            const balanced=diff<1;
            return [
            {sec:'assets',label:'Assets',accent:'#16A34A',accentVar:'var(--success)',bg:'rgba(22,163,74,0.04)',syncFn:'syncBsAssets()'},
            {sec:'liabilities',label:'Liabilities',accent:'#DC2626',accentVar:'var(--danger)',bg:'rgba(220,38,38,0.04)',syncFn:'syncBsLiabilities()'},
            {sec:'equity',label:'Equity',accent:'#2563EB',accentVar:'var(--info)',bg:'rgba(37,99,235,0.04)',syncFn:null}
          ].map(({sec,label,accent,accentVar,bg,syncFn},ci)=>{
            const items=bs?.[sec]||[];
            const total=items.reduce((a,i)=>a+i.value,0);
            const syncBtn=syncFn?`<button class="btn btn-sm" style="font-size:10px;padding:2px 7px;margin-left:auto" onclick="${syncFn}" title="Sync from live modules">↻ Sync</button>`:'';
            const maxItem = Math.max(...items.map(i=>Math.abs(i.value)),1);
            return `<div style="padding:18px 20px;${ci>0?'border-left:1px solid var(--border)':''}background:${bg}">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <div style="width:3px;height:28px;border-radius:2px;background:${accentVar};flex-shrink:0"></div>
                <div>
                  <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${accentVar}">${label}</div>
                  <div style="font-size:19px;font-weight:800;font-family:'Montserrat',sans-serif;line-height:1.1;color:var(--text)">${fmt(total)}</div>
                </div>
                ${syncBtn}
              </div>
              <div style="height:2px;background:${accentVar};border-radius:1px;margin:10px 0 12px"></div>
              ${items.map((item,idx)=>{
                const pct=total>0?Math.max(4,Math.round((Math.abs(item.value)/maxItem)*100)):0;
                return `<div style="margin-bottom:8px">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:3px">
                    <input class="input" style="flex:1;padding:3px 6px;font-size:11px;background:transparent;border-color:transparent;color:var(--text-2)" value="${item.label}"
                      onchange="updateBsLabel('${sec}',${idx},this.value);bsMarkDirty()"
                      onfocus="this.style.background='var(--surface)';this.style.borderColor='var(--primary)'"
                      onblur="this.style.background='transparent';this.style.borderColor='transparent'">
                    <input class="input" style="width:90px;text-align:right;padding:3px 6px;font-size:12px;font-family:'Montserrat',sans-serif;font-weight:700;color:var(--text);background:transparent;border-color:transparent"
                      value="${fmt(item.value)}"
                      onfocus="this.value='${item.value}';this.type='number';this.style.background='var(--surface)';this.style.borderColor='var(--primary)'"
                      onblur="this.type='text';this.value=fmtKInput(this);this.style.background='transparent';this.style.borderColor='transparent';updateBsValue('${sec}',${idx},this.dataset.raw||this.value);bsMarkDirty()"
                      onchange="this.dataset.raw=this.value">
                  </div>
                  <div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${accentVar};border-radius:2px;opacity:0.5"></div>
                  </div>
                </div>`;
              }).join('')}
              <button class="btn btn-sm" style="width:100%;margin:4px 0 0;font-size:11px;border-style:dashed;background:transparent" onclick="addBsItem('${sec}')">+ Add Line</button>
            </div>`;
          }).join('')+`<div style="grid-column:1/-1;border-top:2px solid var(--border);padding:16px 24px;display:flex;justify-content:space-between;align-items:center;background:${balanced?'rgba(22,163,74,0.06)':'rgba(220,38,38,0.06)'}">
            <div>
              <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin-bottom:4px">Total Liabilities + Equity</div>
              <div style="font-size:22px;font-weight:800;font-family:'Montserrat',sans-serif">${fmt(lplusE)}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:18px;font-weight:700;color:${balanced?'var(--success)':'var(--danger)'}">${balanced?'✓ Balanced':'⚠ Off by '+fmt(diff)}</div>
              <div style="font-size:10px;color:var(--text-3);margin-top:3px">${balanced?'Assets = Liabilities + Equity':'Difference detected'}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin-bottom:4px">Total Assets</div>
              <div style="font-size:22px;font-weight:800;font-family:'Montserrat',sans-serif">${fmt(bsTotals.assets)}</div>
            </div>
          </div>`; })()}
        </div>
      </div>
    </div>
    <div class="view-panel" id="stmt-recon">
      ${renderReconTab()}
    </div>
  </div>`;
}

function renderReconTab() {
  const arPaidItems = (state.ar||[]).filter(x=>x.status==='paid');
  const arPaid = arPaidItems.reduce((s,x)=>s+x.amount,0);
  const revYtd = (state.revenue||[]).filter(r=>r.revenue>0).reduce((a,r)=>a+r.revenue,0);
  const gap = arPaid - revYtd;
  const gapPct = revYtd ? (Math.abs(gap)/revYtd*100).toFixed(1) : 0;

  // Per-client AR paid breakdown
  const byClient = {};
  arPaidItems.forEach(x => { byClient[x.client]=(byClient[x.client]||0)+x.amount; });
  const topClients = Object.entries(byClient).sort((a,b)=>b[1]-a[1]);

  // Monthly breakdown of AR paid (by issuedDate or dueDate)
  const byMonth = {};
  MO.forEach(m => byMonth[m]=0);
  arPaidItems.forEach(x => {
    const d = x.issuedDate||x.dueDate||'';
    if(d) { const mo=MO[new Date(d+'T00:00:00').getMonth()]; if(mo) byMonth[mo]+=x.amount; }
  });
  const revByMonth = {};
  MO.forEach((m,i) => { revByMonth[m]=(state.revenue||[]).find(r=>r.month===m||r.month===i+1)?.revenue||0; });

  const rowStyle='display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--border);font-size:12px';
  const bridgeRows = [
    { label:'AR Paid (cash collected)', value:arPaid, color:'var(--success)', bold:true },
    { label:'Less: Revenue recognised in Revenue Module', value:-revYtd, color:'var(--text-2)', bold:false },
    { label:'Unexplained gap', value:gap, color:Math.abs(gap)>50000?'var(--warning)':'var(--success)', bold:true },
  ];

  return `<div style="display:flex;flex-direction:column;gap:14px">
    <div class="grid-3">
      <div class="metric"><div class="metric-label">AR Paid (Collected)</div><div class="metric-value" style="color:var(--success)">${fmt(arPaid)}</div><div class="metric-sub">${arPaidItems.length} paid invoices</div></div>
      <div class="metric"><div class="metric-label">Revenue Recognised</div><div class="metric-value">${fmt(revYtd)}</div><div class="metric-sub">Revenue module YTD</div></div>
      <div class="metric"><div class="metric-label">Gap</div><div class="metric-value" style="color:${Math.abs(gap)>50000?'var(--warning)':'var(--success)'}">${gap>=0?'+':''}${fmt(gap)}</div><div class="metric-sub">${gapPct}% of revenue</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Reconciliation Bridge</div></div>
        ${bridgeRows.map(r=>`<div style="${rowStyle}${r.bold?';font-weight:700':''}">
          <span style="color:var(--text-2)">${r.label}</span>
          <span style="font-family:'Montserrat',sans-serif;color:${r.color}">${r.value>=0?'+':''}${fmt(r.value)}</span>
        </div>`).join('')}
        <div style="margin-top:12px;padding:10px;background:var(--surface-2);border-radius:8px;font-size:11px;color:var(--text-2)">
          <strong>Common causes of gap:</strong><br>
          • Multi-year contracts — cash collected upfront, revenue recognised monthly<br>
          • Timing — invoices paid in one period, revenue recorded in another<br>
          • Deferred revenue — advance payments not yet earned<br>
          • Revenue module not updated — ensure monthly entries are current
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">AR Paid by Client</div></div>
        <div style="max-height:260px;overflow-y:auto">
          ${topClients.length ? topClients.map(([cl,amt])=>{
            const pct=Math.round(amt/arPaid*100);
            return `<div style="${rowStyle}">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:11px">${cl}</div>
                <div style="margin-top:3px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:var(--success);border-radius:2px"></div>
                </div>
              </div>
              <span style="font-family:'Montserrat',sans-serif;font-size:12px;font-weight:700;margin-left:12px;flex-shrink:0">${fmt(amt)}</span>
            </div>`;
          }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:12px 0;text-align:center">No paid invoices</div>'}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Monthly: AR Collected vs Revenue Recognised</div></div>
      <div style="overflow-x:auto">
        <table class="table" style="font-size:11px;min-width:700px">
          <thead><tr><th>Month</th>${MO.map(m=>`<th style="text-align:right;font-size:10px">${m}</th>`).join('')}<th style="text-align:right">Total</th></tr></thead>
          <tbody>
            <tr><td style="font-weight:600;color:var(--success)">AR Collected</td>${MO.map(m=>`<td style="text-align:right">${byMonth[m]?fmt(byMonth[m]):'—'}</td>`).join('')}<td style="text-align:right;font-weight:700">${fmt(arPaid)}</td></tr>
            <tr><td style="font-weight:600">Revenue Module</td>${MO.map(m=>`<td style="text-align:right">${revByMonth[m]?fmt(revByMonth[m]):'—'}</td>`).join('')}<td style="text-align:right;font-weight:700">${fmt(revYtd)}</td></tr>
            <tr style="background:var(--surface-2)"><td style="font-weight:600;color:var(--warning-text)">Gap</td>${MO.map(m=>{const g=byMonth[m]-revByMonth[m];const gc=Math.abs(g)>10000?'var(--warning)':'var(--text-3)';return '<td style="text-align:right;font-size:10px;color:'+gc+'">'+(g?(g>=0?'+':'')+fmt(g):'—')+'</td>';}).join('')}<td style="text-align:right;font-weight:700;color:${Math.abs(gap)>50000?'var(--warning)':'var(--success)'}">${gap>=0?'+':''}${fmt(gap)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function getCommByMonth() {
  const byMo = {};
  (state.commissions||[]).filter(c => c.status === 'paid').forEach(c => {
    const rawDate = c.date || c.createdAt;
    const mo = rawDate ? new Date(rawDate).toLocaleString('en-US', { month:'short' }) : null;
    if (mo && MO.includes(mo)) byMo[mo] = (byMo[mo]||0) + (c.amount||0);
  });
  return byMo;
}

function renderPnLRows(pnl) {
  if (!pnl?.rows) return '<tr><td colspan="14" style="text-align:center;color:var(--text-3);padding:20px">No P&L data. Connect QuickBooks to auto-populate.</td></tr>';
  const revenue=pnl.rows.find(r=>r.id==='revenue');
  const cogs=pnl.rows.find(r=>r.id==='cogs');
  const opexRows=pnl.rows.filter(r=>r.type==='opex');

  // Inject paid commissions as an auto-populated OpEx row (if not already in pnl.rows)
  const hasCommRow = pnl.rows.some(r => r.id === '_commissions');
  const commByMo = getCommByMonth();
  const hasPaidComm = Object.values(commByMo).some(v => v > 0);
  if (hasPaidComm && !hasCommRow) {
    const commRow = { id: '_commissions', cat: 'Sales Commissions', type: 'opex', months: commByMo, _auto: true };
    pnl.rows.splice(pnl.rows.findIndex(r => r.id === 'totopex' || r.type === 'total'), 0, commRow);
    opexRows.push(commRow);
  }

  // Sticky label cell builders — consistent style to avoid z-index/background bleed
  const CAT_BASE = 'position:sticky;left:0;z-index:2;padding:8px 12px;border-right:2px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:185px';
  const cellCat   = t => `<td style="${CAT_BASE};background:var(--surface);color:var(--text-2)">${t}</td>`;
  const cellSub   = t => `<td style="${CAT_BASE};background:var(--surface-2);font-weight:600;color:var(--text)">${t}</td>`;
  const cellTotal = t => `<td style="${CAT_BASE};background:#FFF7F5;font-weight:700;color:var(--primary)">${t}</td>`;

  const moCell = (v, bold=false, negative=false) => {
    const color = negative ? (v<0?'color:var(--danger)':v>0?'color:var(--success)':'') : '';
    return `<td style="text-align:right;padding:8px 8px;border-left:1px solid var(--border);font-size:11px;${bold?'font-weight:700;':''} ${color}">${v?fmt(v):'<span style="color:var(--border-2)">—</span>'}</td>`;
  };
  const totalCell = (v, bold=false, negative=false) => {
    const color = negative ? (v<0?'color:var(--danger)':v>0?'color:var(--success)':'') : 'color:var(--text)';
    return `<td style="text-align:right;padding:8px 10px;border-left:2px solid var(--border);font-size:11px;font-weight:700;${color}">${fmt(v)}</td>`;
  };

  // Section divider helper
  const sectionHeader = (label, color, bg) =>
    `<tr style="background:${bg};border-top:2px solid ${color}">
      <td colspan="${MO.length+2}" style="padding:5px 12px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:${color};position:sticky;left:0">${label}</td>
    </tr>`;

  let prevType = null;
  return pnl.rows.map(row=>{
    let prefix = '';
    const rtype = row.computed ? (row.type==='total'?'total':'subtotal') : (row._auto ? 'opex' : row.type);
    if (rtype !== prevType) {
      if (rtype === 'income') prefix = sectionHeader('Revenue','#2563EB','rgba(37,99,235,0.04)');
      else if (rtype === 'cogs') prefix = sectionHeader('Cost of Goods Sold','#DC2626','rgba(220,38,38,0.03)');
      else if (rtype === 'opex' && prevType !== 'opex') prefix = sectionHeader('Operating Expenses','#D97706','rgba(217,119,6,0.04)');
      prevType = rtype;
    }

    if (row.computed) {
      const vals={};
      if (row.formula==='revenue-cogs') MO.forEach(m=>vals[m]=(revenue?.months[m]||0)-(cogs?.months[m]||0));
      else if (row.formula==='sum-opex') MO.forEach(m=>vals[m]=opexRows.reduce((a,r)=>a+(r.months[m]||0),0));
      else if (row.formula==='gross-totopex') {
        const gross=pnl.rows.find(r=>r.id==='gross'), totopex=pnl.rows.find(r=>r.id==='totopex');
        MO.forEach(m=>vals[m]=(gross?computed_gross(m,revenue,cogs):0)-(totopex?computed_totopex(m,opexRows):0));
      }
      const total=MO.reduce((a,m)=>a+(vals[m]||0),0);
      const moCellLive = (v,m,bold,neg) => { const color=neg?(v<0?'color:var(--danger)':v>0?'color:var(--success)':''):''; return `<td id="pnl-computed-${row.id}-${m}" style="text-align:right;padding:8px 8px;border-left:1px solid var(--border);font-size:11px;${bold?'font-weight:700;':''}${color}">${v?fmt(v):'<span style="color:var(--border-2)">—</span>'}</td>`; };
      if (row.type==='total') return prefix+`<tr style="background:linear-gradient(90deg,#FFF3ED,#FFF7F5);border-top:2px solid var(--primary)">
        ${cellTotal(row.cat)}
        ${MO.map(m=>moCellLive(vals[m],m,true,true)).join('')}
        <td id="pnl-total-${row.id}" style="text-align:right;padding:8px 10px;border-left:2px solid var(--primary);font-size:13px;font-weight:800;font-family:'Montserrat',sans-serif;${total<0?'color:var(--danger)':total>0?'color:var(--success)':''}">${fmt(total)}</td>
      </tr>`;
      return prefix+`<tr style="background:var(--surface-2);border-top:1.5px solid var(--border)">
        ${cellSub(row.cat)}
        ${MO.map(m=>moCellLive(vals[m],m,false,row.id==='gross')).join('')}
        <td id="pnl-total-${row.id}" style="text-align:right;padding:8px 10px;border-left:2px solid var(--border);font-size:12px;font-weight:700;${total<0?'color:var(--danger)':total>0?'color:var(--success)':''}">${fmt(total)}</td>
      </tr>`;
    }
    // Auto-populated commission row (read-only, sourced from Commissions module)
    if (row._auto && row.id === '_commissions') {
      const total=MO.reduce((a,m)=>a+(row.months[m]||0),0);
      return prefix+`<tr style="background:rgba(37,99,235,0.04);border-top:1px solid var(--border)" title="Auto-populated from paid commissions in the Commissions module">
        <td style="position:sticky;left:0;z-index:2;padding:8px 12px;border-right:2px solid var(--border);white-space:nowrap;max-width:185px;background:rgba(37,99,235,0.04);color:var(--info-text);font-size:12px">
          💰 ${row.cat} <span style="font-size:9px;font-weight:700;color:var(--info);background:var(--info-bg);padding:1px 5px;border-radius:4px;margin-left:4px">AUTO</span>
        </td>
        ${MO.map(m=>`<td style="text-align:right;padding:8px 8px;border-left:1px solid var(--border);font-size:11px;color:${(row.months[m]||0)>0?'var(--text)':'var(--text-3)'}">${(row.months[m]||0)?fmt(row.months[m]):'—'}</td>`).join('')}
        <td style="text-align:right;padding:8px 10px;border-left:2px solid var(--border);font-size:11px;font-weight:700;color:var(--text)">${fmt(total)}</td>
      </tr>`;
    }
    // Regular data row — editable inline inputs
    const isIncome=row.type==='income', isCogs=row.type==='cogs';
    const sectionBg = isIncome?'rgba(37,99,235,0.015)' : isCogs?'rgba(220,38,38,0.015)' : '';
    const total=MO.reduce((a,m)=>a+(row.months[m]||0),0);
    const rowId=row.id;
    return prefix+`<tr style="${sectionBg?'background:'+sectionBg:''};border-top:1px solid var(--border)">
      ${cellCat(row.cat)}
      ${MO.map(m=>{
        const isFuture = MO.indexOf(m) > MO.indexOf(budgetCurrentMonth());
        const hasData  = (row.months[m]||0) > 0;
        const futureBg = isFuture ? 'rgba(217,119,6,0.05)' : (isIncome?'rgba(37,99,235,0.015)':isCogs?'rgba(220,38,38,0.015)':'transparent');
        const futureTitle = isFuture ? 'title="Future month — actuals should not be entered manually"' : '';
        return `<td style="padding:2px 3px;border-left:1px solid var(--border);background:${futureBg}" ${futureTitle}>
        <input type="text" value="${fmt(row.months[m]||0)}"
          style="width:100%;text-align:right;background:transparent;border:none;outline:none;font-size:11px;color:${isFuture&&hasData?'var(--warning)':'var(--text)'};padding:4px 3px;cursor:pointer"
          onfocus="pnlCellFocus(this,${row.months[m]||0})"
          onblur="pnlCellBlur(this,'${rowId}','${m}',${isFuture})"
          onkeydown="if(event.key==='Enter'){this.blur()}" autocomplete="off">
      </td>`;}).join('')}
      <td id="pnl-total-${rowId}" style="text-align:right;padding:8px 8px;border-left:2px solid var(--border);font-size:11px;font-weight:700;color:var(--text)">${fmt(total)}</td>
    </tr>`;
  }).join('');
}
function computed_gross(m,revenue,cogs){return (revenue?.months[m]||0)-(cogs?.months[m]||0);}
function computed_totopex(m,opexRows){return opexRows.reduce((a,r)=>a+(r.months[m]||0),0);} // commissions injected into opexRows by renderPnLRows
function togglePnLFutureColumns() {
  const curMoIdx = MO.indexOf(budgetCurrentMonth());
  const table = document.querySelector('#stmt-pnl table');
  if (!table) return;
  const btn = document.getElementById('pnl-future-toggle');
  const hiding = btn?.textContent === 'Hide future';
  table.querySelectorAll('th, td').forEach(cell => {
    const cellIdx = Array.from(cell.parentElement.children).indexOf(cell) - 1; // -1 for first sticky col
    if (cellIdx > curMoIdx && cellIdx < MO.length) {
      cell.style.display = hiding ? 'none' : '';
    }
  });
  if (btn) btn.textContent = hiding ? 'Show future' : 'Hide future';
}

function pnlCellFocus(el, raw) {
  el.value = raw;
  el.type = 'number';
  el.style.background = 'var(--surface)';
  el.style.border = '1px solid var(--primary)';
  el.style.borderRadius = '3px';
  el.style.cursor = 'text';
}
function pnlCellBlur(el, rowId, month, isFuture=false) {
  const n = Number(el.value) || 0;
  el.type = 'text';
  el.value = fmt(n);
  el.style.background = 'transparent';
  el.style.border = 'none';
  el.style.borderRadius = '0';
  if (isFuture && n > 0) {
    const avg = (() => {
      const row = state.statements?.pnl?.rows?.find(r=>r.id===rowId);
      if (!row) return 0;
      const curIdx = MO.indexOf(budgetCurrentMonth());
      const vals = MO.slice(0, curIdx).map(m=>row.months[m]||0).filter(v=>v>0);
      return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
    })();
    if (avg > 0 && n > avg * 3) {
      toast(`⚠ ${month} is a future month and this value (${fmt(n)}) is 3× the monthly average (${fmt(avg)}). Verify before saving.`);
    }
  }
  updatePnLCell(rowId, month, n);
}
function updatePnLCell(rowId, month, value) {
  if (!state.statements?.pnl?.rows) return;
  const row = state.statements.pnl.rows.find(r=>r.id===rowId);
  if (!row || row.computed) return;
  if (!row.months) row.months={};
  row.months[month] = value;
  const total = MO.reduce((a,m)=>a+(row.months[m]||0),0);
  const tc = document.getElementById('pnl-total-'+rowId);
  if (tc) tc.textContent = fmt(total);
  // Live-update computed rows in the DOM
  _recalcPnLComputed(month);
  const dirty=document.getElementById('pnl-dirty'), btn=document.getElementById('pnl-save-btn');
  if(dirty) dirty.style.display='inline';
  if(btn) btn.style.display='inline-block';
  // Auto-save after 1.5s of inactivity
  clearTimeout(updatePnLCell._t);
  updatePnLCell._t = setTimeout(()=>savePnL(true), 1500);
}

function _recalcPnLComputed(changedMonth) {
  if (!state.statements?.pnl?.rows) return;
  const rows = state.statements.pnl.rows;
  const revenue = rows.find(r=>r.id==='revenue');
  const cogs    = rows.find(r=>r.id==='cogs');
  const opexRows = rows.filter(r=>r.type==='opex');
  const months = changedMonth ? [changedMonth] : MO;
  months.forEach(m => {
    const rev = revenue?.months[m]||0;
    const cos = cogs?.months[m]||0;
    const gross = rev - cos;
    const commByMo = getCommByMonth();
    const totopex = opexRows.reduce((a,r)=>a+(r.months[m]||0),0) + (commByMo[m]||0);
    const ebitda = gross - totopex;
    ['gross','totopex','ebitda'].forEach(id => {
      const el = document.getElementById(`pnl-computed-${id}-${m}`);
      if (!el) return;
      const val = id==='gross'?gross : id==='totopex'?totopex : ebitda;
      el.textContent = val ? fmt(val) : '—';
      el.style.color = val<0 ? 'var(--danger)' : val>0 ? 'var(--success)' : '';
    });
    // Also update totals in the total column
    const totCols = {gross:gross, totopex:totopex, ebitda:ebitda};
    ['gross','totopex','ebitda'].forEach(id => {
      const tc = document.getElementById('pnl-total-'+id);
      if (tc) { const tot=MO.reduce((a,mo)=>a+(id==='gross'?computed_gross(mo,revenue,cogs):id==='totopex'?computed_totopex(mo,opexRows):(computed_gross(mo,revenue,cogs)-computed_totopex(mo,opexRows))),0); tc.textContent=fmt(tot); tc.style.color=tot<0?'var(--danger)':tot>0?'var(--success)':''; }
    });
  });
}
async function savePnL(silent=false) {
  try {
    await apiCall('/statements/pnl',{method:'PUT',body:JSON.stringify(state.statements.pnl)});
    const dirty=document.getElementById('pnl-dirty'), btn=document.getElementById('pnl-save-btn');
    if(dirty) dirty.style.display='none';
    if(btn) btn.style.display='none';
    if(!silent) toast('P&L saved');
  } catch(e){if(!silent) toast('Error: '+e.message);}
}

function fmtKInput(el) {
  const v=Number(String(el.value).replace(/[^0-9.-]/g,''))||0;
  el.dataset.raw=String(v); return fmt(v);
}
function bsMarkDirty() { const el=document.getElementById('bs-dirty'); if(el) el.style.display='inline'; }
function updateBsLabel(sec,idx,val){ if(state.statements?.balanceSheet?.[sec]?.[idx]) state.statements.balanceSheet[sec][idx].label=val; }
function updateBsValue(sec,idx,val){ const n=Number(String(val).replace(/[^0-9.-]/g,''))||0; if(state.statements?.balanceSheet?.[sec]?.[idx]) state.statements.balanceSheet[sec][idx].value=n; }
async function addBsItem(sec) {
  try { await apiCall('/statements/balance-sheet/item',{method:'POST',body:JSON.stringify({section:sec,label:'New Item',value:0})}); state.statements=null; render(); } catch(e){toast(e.message);}
}
async function saveBalanceSheet() {
  if (!state.statements?.balanceSheet) return;
  // Auto-sync liabilities from live module before every save (single source of truth)
  const liabItems = (state.liabilities||[]).map(cat=>({
    label: cat.name,
    value: (cat.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0)
  })).filter(x=>x.value>0);
  if (liabItems.length) state.statements.balanceSheet.liabilities = liabItems;

  // Stamp the sync time
  state.statements.balanceSheet.lastSynced = new Date().toISOString();

  try {
    await apiCall('/statements/balance-sheet',{method:'PUT',body:JSON.stringify(state.statements.balanceSheet)});
    const el=document.getElementById('bs-dirty'); if(el) el.style.display='none';
    toast('Balance sheet saved — liabilities auto-synced from module');
    state.statements=null;
    renderStatements(document.getElementById('main-content'));
  } catch(e){toast(e.message);}
}

function exportStatementPDF(type) {
  downloadStatementPDF(type === 'pnl' ? 'pnl' : 'bs');
}

async function syncBsLiabilities() {
  if (!state.statements?.balanceSheet) return;
  const liabItems = state.liabilities.map(cat => ({
    label: cat.name,
    value: (cat.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0)
  })).filter(x=>x.value>0);
  if (!liabItems.length) { toast('No liability data found in Liabilities module'); return; }
  state.statements.balanceSheet.liabilities = liabItems;
  bsMarkDirty();
  toast('Liabilities synced from module — click Save to persist');
  renderStatements(document.getElementById('main-content'));
}

async function syncBsAssets() {
  if (!state.statements?.balanceSheet) return;
  const cashTotal = (state.banks||[]).reduce((a,b)=>a+(b.balance||0),0);
  const arTotal = (state.ar||[]).filter(x=>x.status==='pending'||x.status==='overdue').reduce((a,x)=>a+(x.amount||0),0);
  const assetItems = [];
  if (cashTotal > 0) assetItems.push({ label: 'Cash & Bank Balances', value: cashTotal });
  if (arTotal > 0)   assetItems.push({ label: 'Accounts Receivable', value: arTotal });
  (state.statements.balanceSheet.assets||[]).filter(i=>
    !['cash & bank balances','accounts receivable'].includes(i.label.toLowerCase())
  ).forEach(i=>assetItems.push(i));
  if (!assetItems.length) { toast('No asset data found'); return; }
  state.statements.balanceSheet.assets = assetItems;
  bsMarkDirty();
  toast('Assets synced from Cash & AR modules — click Save to persist');
  renderStatements(document.getElementById('main-content'));
}

async function syncBsAll() {
  await syncBsAssets();
  await syncBsLiabilities();
  toast('Balance Sheet fully synced — click Save to persist');
}

// ── Calendar ──────────────────────────────────────────────────────────────────
async function renderCalendar(c) {
  // Check GCal connection status
  let gcalStatus = { configured: false, connected: false };
  try { gcalStatus = await apiCall('/events/gcal/status'); } catch {}

  const gcalBtn = gcalStatus.connected
    ? `<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:rgba(34,197,94,.15);color:#22c55e;border:0.5px solid rgba(34,197,94,.3)">● Google Calendar connected</span>
       <button class="btn btn-sm" onclick="syncGcal()">↻ Sync</button>`
    : gcalStatus.configured
      ? `<button class="btn btn-primary btn-sm" onclick="connectGcal()">Connect Google Calendar</button>`
      : `<span style="font-size:10px;color:var(--text-3)">Add credentials to .env to connect</span>`;

  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div class="card-header">
        <div class="card-title">Scheduler — ${MONTHS[state.calMonth]} ${state.calYear}</div>
        <div style="display:flex;gap:6px;align-items:center">
          ${gcalBtn}
          <button class="btn btn-primary btn-sm" onclick="openAddEvent()">+ Event</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <button class="btn btn-sm" style="padding:4px 10px" onclick="calMove(-1)">‹</button>
        <div style="display:flex;align-items:center;gap:8px">
          <strong id="cal-label">${MONTHS[state.calMonth]} ${state.calYear}</strong>
          <button class="btn btn-sm" style="padding:3px 9px;font-size:11px" onclick="calGoToday()">Today</button>
        </div>
        <button class="btn btn-sm" style="padding:4px 10px" onclick="calMove(1)">›</button>
      </div>
      <div class="cal-grid">${DAYS.map(d=>`<div class="cal-hd">${d}</div>`).join('')}</div>
      <div class="cal-grid" style="margin-top:3px" id="cal-days"></div>
      <div style="margin-top:14px;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;font-weight:600">Upcoming Events &amp; Tasks</span>
        <div style="display:flex;gap:10px;font-size:10px;color:var(--text-3)">
          <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block"></span>Tax</span>
          <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#f97316;display:inline-block"></span>Event</span>
          <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#7C3AED;display:inline-block"></span>Task</span>
        </div>
      </div>
      <div id="events-list"></div>
    </div>
  </div>`;
  renderCalDays(); renderEventsList();

  // Listen for the OAuth popup completing
  window.addEventListener('message', (e) => {
    if (e.data === 'gcal_connected') { toast('Google Calendar connected!'); renderCalendar(c); }
  }, { once: true });
}

function renderCalDays() {
  const el=document.getElementById('cal-days'); if(!el) return;
  const first=new Date(state.calYear,state.calMonth,1).getDay();
  const dim=new Date(state.calYear,state.calMonth+1,0).getDate();
  const prev=new Date(state.calYear,state.calMonth,0).getDate();
  const eD={},tD={},taskD={};
  state.events.forEach(e=>{ const d=new Date(e.date+'T00:00:00'); if(d.getFullYear()===state.calYear&&d.getMonth()===state.calMonth){eD[d.getDate()]=true;if(e.type==='tax')tD[d.getDate()]=true;} });
  state.tasks.filter(t=>!t.done&&t.deadline).forEach(t=>{ const d=new Date(t.deadline+'T00:00:00'); if(d.getFullYear()===state.calYear&&d.getMonth()===state.calMonth) taskD[d.getDate()]=(taskD[d.getDate()]||0)+1; });
  let html='';
  for(let i=0;i<first;i++) html+=`<div class="cal-day dim">${prev-first+1+i}</div>`;
  for(let d=1;d<=dim;d++){
    const isTd=state.calYear===TODAY.getFullYear()&&state.calMonth===TODAY.getMonth()&&d===TODAY.getDate();
    const taxDot=tD[d]?`<div class="cal-dot" style="background:${isTd?'#fff':'#ef4444'}"></div>`:'';
    const evDot=!tD[d]&&eD[d]?`<div class="cal-dot" style="background:${isTd?'#fff':'#f97316'}"></div>`:'';
    const taskDot=taskD[d]?`<div class="cal-dot" style="background:${isTd?'#fff':'#7C3AED'}"></div>`:'';
    html+=`<div class="cal-day${isTd?' today':''}" style="cursor:pointer" onclick="calDayClick(${d})" title="View ${MONTHS[state.calMonth]} ${d}">${d}${taxDot}${evDot}${taskDot}</div>`;
  }
  el.innerHTML=html;
}

function calMove(dir){ state.calMonth+=dir; if(state.calMonth>11){state.calMonth=0;state.calYear++;} if(state.calMonth<0){state.calMonth=11;state.calYear--;} document.getElementById('cal-label').textContent=MONTHS[state.calMonth]+' '+state.calYear; renderCalDays(); }
function calGoToday(){ state.calYear=TODAY.getFullYear(); state.calMonth=TODAY.getMonth(); document.getElementById('cal-label').textContent=MONTHS[state.calMonth]+' '+state.calYear; renderCalDays(); renderEventsList(); }

function calDayClick(day) {
  const dateStr = `${state.calYear}-${String(state.calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const dayEvents = state.events.filter(e=>e.date===dateStr);
  const dayTasks  = state.tasks.filter(t=>t.deadline===dateStr&&!t.done);
  const label = `${MONTHS[state.calMonth]} ${day}, ${state.calYear}`;
  const evHtml = dayEvents.length ? dayEvents.map(e=>`
    <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:.5px solid var(--border)">
      <div style="width:28px;height:28px;border-radius:6px;background:${EVT_COLORS[e.type]||'#888'}22;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">📅</div>
      <div>
        <div style="font-size:12px;font-weight:600">${e.title}</div>
        ${e.description?`<div style="font-size:11px;color:var(--text-2);margin-top:2px">${e.description}</div>`:''}
        <div style="font-size:10px;color:var(--text-3);margin-top:2px">${e.time?`${e.time} · `:''}${EVT_TAGS[e.type]||e.type}</div>
        ${e.zoomLink?`<a href="${e.zoomLink}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#2D8CFF;background:rgba(45,140,255,0.10);padding:2px 8px;border-radius:4px;margin-top:5px;text-decoration:none;font-weight:600">🎥 Join Zoom</a>`:''}
      </div>
    </div>`).join('') : '';
  const tkHtml = dayTasks.length ? dayTasks.map(t=>`
    <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:.5px solid var(--border)">
      <div style="width:28px;height:28px;border-radius:6px;background:rgba(124,58,237,.12);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">✓</div>
      <div>
        <div style="font-size:12px;font-weight:600">${t.title}</div>
        <span style="font-size:10px;background:var(--warning-bg);color:var(--warning-text);padding:2px 6px;border-radius:4px;font-weight:600">${t.priority||'normal'}</span>
      </div>
    </div>`).join('') : '';
  if (!evHtml && !tkHtml) { toast(`No events or tasks on ${label}`); return; }
  const modal = document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML=`<div style="background:var(--surface);border-radius:14px;padding:0;width:420px;max-width:95vw;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:14px;font-weight:700">${label}</div>
      <button onclick="this.closest('.day-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-2);padding:0 4px">×</button>
    </div>
    <div style="padding:16px 20px;overflow-y:auto">
      ${dayEvents.length?`<div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Events (${dayEvents.length})</div>${evHtml}`:''}
      ${dayTasks.length?`<div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-top:${dayEvents.length?'14px':'0'};margin-bottom:6px">Tasks (${dayTasks.length})</div>${tkHtml}`:''}
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border)">
      <button class="btn btn-primary btn-sm" onclick="openAddEvent();this.closest('.day-modal').remove()">+ Add Event</button>
    </div>
  </div>`;
  modal.classList.add('day-modal');
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.remove(); });
  document.body.appendChild(modal);
}

const EVT_COLORS={tax:'#ef4444',meeting:'#3b82f6',deadline:'#f59e0b',task:'#22c55e',planning:'#a855f7'};
const EVT_TAGS={tax:'Tax',meeting:'Meeting',deadline:'Deadline',task:'Task',planning:'Planning'};

function cdBadge(d){ const n=daysTo(d); if(n<0) return ''; if(n===0) return '<span class="countdown cd-urgent">Today</span>'; if(n<=3) return `<span class="countdown cd-urgent">${n}d</span>`; if(n<=14) return `<span class="countdown cd-soon">${n}d</span>`; return `<span class="countdown cd-ok">${n}d</span>`; }

function renderEventsList() {
  let evts = state.events.filter(e=>daysTo(e.date)>=0).map(e=>({...e, _kind:'event'}));
  let tasks = state.tasks.filter(t=>!t.done&&t.deadline&&daysTo(t.deadline)>=0).map(t=>({...t, _kind:'task', date:t.deadline}));
  const ef = state._evtFilter || {};
  if (ef.type==='task') evts=[];
  else if (ef.type) evts=evts.filter(e=>e.type===ef.type);
  if (ef.type && ef.type!=='task') tasks=[];
  const combined = [...evts, ...tasks].sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,20);
  const el=document.getElementById('events-list'); if(!el) return;
  el.innerHTML=`<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
    <select class="input" style="font-size:11px;max-width:150px" onchange="state._evtFilter.type=this.value;renderEventsList()">
      <option value=""${!ef.type?' selected':''}>All Types</option>
      <option value="meeting"${ef.type==='meeting'?' selected':''}>Meetings</option>
      <option value="deadline"${ef.type==='deadline'?' selected':''}>Deadlines</option>
      <option value="tax"${ef.type==='tax'?' selected':''}>Tax</option>
      <option value="planning"${ef.type==='planning'?' selected':''}>Planning</option>
      <option value="task"${ef.type==='task'?' selected':''}>Tasks only</option>
    </select>
    ${ef.type?`<button class="btn btn-sm" style="font-size:10px" onclick="state._evtFilter.type='';renderEventsList()">✕ Clear</button>`:''}
    <span style="font-size:10px;color:var(--text-3);margin-left:auto">${combined.length} upcoming</span>
  </div>` + (combined.length ? combined.map(item=>{
    if (item._kind==='task') {
      const PRIO_COL={high:'#ef4444',medium:'#f97316',low:'#94a3b8'};
      const col=PRIO_COL[item.priority]||'#7C3AED';
      return `<div class="event-item"><div class="event-bar" style="background:${col}"></div><div style="flex:1;min-width:0"><div class="event-title">${item.title}</div><div class="event-meta"><span class="tag" style="background:${col}22;color:${col}">Task</span><span>${fmtDate(item.date)}</span><span style="font-size:10px;color:var(--text-3);text-transform:capitalize">${item.priority||'medium'} priority</span>${cdBadge(item.date)}</div></div><button class="del-btn" onclick="deleteTask(${item.id})">×</button></div>`;
    }
    const col=EVT_COLORS[item.type]||'#94a3b8';
    const zoomBtn=item.zoomLink?`<a href="${item.zoomLink}" target="_blank" rel="noopener" class="btn btn-sm" style="font-size:10px;padding:2px 7px;background:rgba(45,140,255,0.10);color:#2D8CFF;border:1px solid rgba(45,140,255,0.25);text-decoration:none">🎥 Join</a>`:'';
    return `<div class="event-item"><div class="event-bar" style="background:${col}"></div><div style="flex:1;min-width:0"><div class="event-title">${item.title}</div><div class="event-meta"><span class="tag" style="background:${col}22;color:${col}">${EVT_TAGS[item.type]||item.type}</span><span>${fmtDate(item.date)}</span>${item.time?`<span style="font-size:10px;color:var(--text-3)">${item.time}</span>`:''} ${item.amount?`<strong>${fmt(item.amount)}</strong>`:''} ${cdBadge(item.date)}</div></div><div style="display:flex;gap:4px;flex-shrink:0">${zoomBtn}<button class="btn btn-sm" style="font-size:10px;padding:2px 7px" onclick="openEditEvent(${item.id})">Edit</button><button class="del-btn" onclick="deleteEvent(${item.id})">×</button></div></div>`;
  }).join('') : `<div style="text-align:center;padding:24px;color:var(--text-2);font-size:12px">No upcoming events${ef.type?' matching this filter':''}.</div>`);
}

function openAddEvent() {
  ['evt-title','evt-note','evt-amount','evt-time'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('evt-date').value=TODAY.toISOString().split('T')[0];
  document.getElementById('evt-type').value='meeting';
  document.getElementById('evt-recur').value='none';
  document.getElementById('evt-modal-title').textContent='Add Calendar Event';
  document.getElementById('evt-save-btn').textContent='Save Event';
  const zlRow=document.getElementById('evt-zoom-link-row'); if(zlRow) zlRow.style.display='none';
  const zlInp=document.getElementById('evt-zoom-link'); if(zlInp) zlInp.value='';
  delete document.getElementById('modal-event').dataset.editId;
  openModal('modal-event');
}

function openEditEvent(id) {
  const e=state.events.find(x=>x.id===id); if(!e) return;
  document.getElementById('evt-modal-title').textContent='Edit Event';
  document.getElementById('evt-title').value=e.title||'';
  document.getElementById('evt-date').value=e.date||'';
  const timeEl=document.getElementById('evt-time'); if(timeEl) timeEl.value=e.time||'';
  setSelectValue(document.getElementById('evt-type'), e.type||'meeting');
  setSelectValue(document.getElementById('evt-recur'), e.recur||'none');
  document.getElementById('evt-amount').value=e.amount||'';
  document.getElementById('evt-note').value=e.note||'';
  const zlRow=document.getElementById('evt-zoom-link-row');
  const zlInp=document.getElementById('evt-zoom-link');
  if(zlInp) zlInp.value=e.zoomLink||'';
  if(zlRow) zlRow.style.display=e.zoomLink?'block':'none';
  document.getElementById('evt-save-btn').textContent='Save Changes';
  document.getElementById('modal-event').dataset.editId=id;
  openModal('modal-event');
}

async function saveEvent() {
  const title=document.getElementById('evt-title').value.trim(), date=document.getElementById('evt-date').value;
  if (!title||!date){toast('Title and date required');return;}
  const time=document.getElementById('evt-time')?.value||'';
  const zoomLink=document.getElementById('evt-zoom-link')?.value||null;
  const payload={type:document.getElementById('evt-type').value,title,date,time,note:document.getElementById('evt-note').value,amount:document.getElementById('evt-amount').value||null,recur:document.getElementById('evt-recur').value,zoomLink};
  const editId=document.getElementById('modal-event').dataset.editId;
  try {
    if(editId){
      const r=await apiCall(`/events/${editId}`,{method:'PUT',body:JSON.stringify(payload)});
      const i=state.events.findIndex(x=>x.id===Number(editId));
      if(i>-1) state.events[i]={...state.events[i],...payload};
      closeModal('modal-event'); renderCalDays(); renderEventsList(); toast('Event updated');
    } else {
      const r=await apiCall('/events',{method:'POST',body:JSON.stringify(payload)});
      state.events.push(r.event); closeModal('modal-event'); renderCalDays(); renderEventsList(); toast('Event saved');
    }
  } catch(e){toast(e.message);}
}
async function deleteEvent(id) { await apiCall(`/events/${id}`,{method:'DELETE'}); state.events=state.events.filter(e=>e.id!==id); renderCalDays(); renderEventsList(); }

async function createZoomMeeting() {
  const title=document.getElementById('evt-title')?.value.trim();
  const date=document.getElementById('evt-date')?.value;
  const time=document.getElementById('evt-time')?.value||'';
  if(!title||!date){toast('Enter a title and date first');return;}
  const btn=document.getElementById('evt-zoom-btn');
  if(btn){btn.textContent='Generating…';btn.disabled=true;}
  try {
    const r=await apiCall('/events/zoom/create',{method:'POST',body:JSON.stringify({title,date,time})});
    const zlInp=document.getElementById('evt-zoom-link');
    const zlRow=document.getElementById('evt-zoom-link-row');
    if(zlInp) zlInp.value=r.joinUrl;
    if(zlRow) zlRow.style.display='block';
    toast('Zoom meeting created — link is ready');
  } catch(e){toast('Zoom: '+e.message);}
  finally{if(btn){btn.textContent='🎥 Generate Zoom Meeting';btn.disabled=false;}}
}

function copyZoomLink() {
  const v=document.getElementById('evt-zoom-link')?.value;
  if(v) navigator.clipboard.writeText(v).then(()=>toast('Zoom link copied')).catch(()=>toast('Copy failed'));
}

function connectGcal() {
  const popup = window.open('/api/events/gcal/auth', 'gcal_auth', 'width=520,height=640,left=200,top=100');
  if (!popup) toast('Allow popups for this site to connect Google Calendar');
}

async function disconnectGcal() {
  if (!confirm('Disconnect Google Calendar & Drive? Events will no longer sync and Drive uploads will fall back to local storage.')) return;
  try {
    await apiCall('/events/gcal/disconnect', { method: 'DELETE' });
    toast('Google disconnected');
    renderSettings(document.getElementById('main-content'));
  } catch(e) { toast('Disconnect failed: ' + e.message, 'error'); }
}

async function syncGcal() {
  try {
    const r = await apiCall('/events/gcal/sync', { method: 'POST' });
    if (r.needsAuth) { connectGcal(); return; }
    await loadAll();
    render();
    toast(r.message || 'Sync complete');
  } catch(e) { toast(e.message); }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
function renderTasks(c) {
  const open=state.tasks.filter(t=>!t.done), done=state.tasks.filter(t=>t.done);
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div class="card-header"><div class="card-title">Tasks</div><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="toggleDone()">${state.showDone?'Hide done':'Show done'}</button><button class="btn btn-sm" onclick="previewEmail('/reports/task-reminder-preview')">Preview Reminder Email</button><button class="btn btn-sm" style="color:var(--primary);border-color:var(--primary-bg)" onclick="openAI('tasks')">✦ Ask Ayla</button><button class="btn btn-primary btn-sm" onclick="openAddTask()">+ Task</button></div></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--text-2)">${open.length} open · ${done.length} completed</span>
        <select class="input" style="font-size:11px;max-width:130px;margin-left:auto" onchange="state._taskFilter.priority=this.value;renderTasksList()">
          <option value=""${!state._taskFilter?.priority?' selected':''}>All Priorities</option>
          <option value="high"${state._taskFilter?.priority==='high'?' selected':''}>High</option>
          <option value="medium"${state._taskFilter?.priority==='medium'?' selected':''}>Medium</option>
          <option value="low"${state._taskFilter?.priority==='low'?' selected':''}>Low</option>
        </select>
        <select class="input" style="font-size:11px;max-width:140px" onchange="state._taskFilter.sort=this.value;renderTasksList()">
          <option value="default"${(state._taskFilter?.sort||'default')==='default'?' selected':''}>Default order</option>
          <option value="deadline"${state._taskFilter?.sort==='deadline'?' selected':''}>By deadline</option>
          <option value="priority"${state._taskFilter?.sort==='priority'?' selected':''}>By priority</option>
        </select>
        ${state._taskFilter?.priority||state._taskFilter?.sort!=='default'?`<button class="btn btn-sm" style="font-size:10px" onclick="state._taskFilter={priority:'',sort:'default'};renderTasksList()">✕ Clear</button>`:''}
      </div>
      <div id="tasks-list"></div>
    </div>
  </div>`;
  renderTasksList();
}

function renderTasksList() {
  const el=document.getElementById('tasks-list'); if(!el) return;
  let vis=state.tasks.filter(t=>state.showDone||!t.done);
  const tf=state._taskFilter||{};
  if (tf.priority) vis=vis.filter(t=>(t.priority||'medium')===tf.priority);
  if (tf.sort==='deadline') vis=[...vis].sort((a,b)=>(a.deadline||'9999')>(b.deadline||'9999')?1:-1);
  else if (tf.sort==='priority') { const PO={high:0,medium:1,low:2}; vis=[...vis].sort((a,b)=>(PO[a.priority||'medium']||1)-(PO[b.priority||'medium']||1)); }
  const PRIO_COL={high:'var(--danger)',medium:'var(--warning)',low:'var(--text-3)'};
  el.innerHTML=vis.length?vis.map(t=>`
    <div class="task-row" style="padding-left:6px;border-left:2px solid ${PRIO_COL[t.priority]||'var(--text-3)'}">
      <div class="checkbox${t.done?' done':''}" onclick="toggleTask(${t.id})"></div>
      <div style="flex:1;min-width:0">
        <div class="task-title${t.done?' done':''}">
          ${t.title}${t.taskType==='ceo'?'<span class="task-ceo-badge">From CEO</span>':t.taskType==='cpo'?'<span class="task-ceo-badge" style="background:var(--info-bg);color:var(--info)">From CPO</span>':''}${t.recurring?`<span style="margin-left:6px;font-size:10px;font-weight:700;color:var(--primary);background:var(--primary-bg);padding:2px 7px;border-radius:5px">↻ ${t.recurringInterval||'weekly'}</span>`:''}${t.done&&t.recurring?'<span style="margin-left:4px;font-size:10px;color:var(--success)">✓ renewed</span>':''}
        </div>
        <div class="task-due">${t.deadline?`Due: ${fmtDate(t.deadline)} ${cdBadge(t.deadline)}`:(t.due||'No deadline')} · <span style="text-transform:capitalize;color:${PRIO_COL[t.priority]||'var(--text-3)'}">${t.priority||'medium'} priority</span>${t.ceoNote?`<span style="margin-left:6px;color:var(--text-2);font-style:italic">"${t.ceoNote.slice(0,40)}${t.ceoNote.length>40?'…':''}"</span>`:''}</div>
        ${(t.taskType==='ceo'||t.taskType==='cpo')&&!t.done?`
        <div style="margin-top:6px">
          <button onclick="toggleAylaSugg(${t.id},this)" style="font-size:11px;font-weight:600;color:var(--primary);background:var(--primary-bg);border:none;border-radius:5px;padding:3px 10px;cursor:pointer">💡 Ayla's Suggestion</button>
          <div id="ayla-sugg-${t.id}" style="display:none;margin-top:8px;background:linear-gradient(135deg,#FFF7F5,#fff);border:1px solid #FFD4C0;border-radius:8px;padding:10px 12px;font-size:12px;color:#5E6C84;line-height:1.55">${generateTaskSuggestion(t)}</div>
        </div>`:``}
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        ${t.done?`<button class="btn btn-sm" style="font-size:10px;padding:2px 7px;color:var(--success);border-color:rgba(22,163,74,.35);font-weight:600" onclick="openTaskNotify(${t.id})">✉ Notify</button>`:''}
        <button class="btn btn-sm" style="font-size:10px;padding:2px 7px" onclick="openEditTask(${t.id})">Edit</button>
        <button class="del-btn" onclick="deleteTask(${t.id})">×</button>
      </div>
    </div>`).join('') : emptyState('No tasks yet', 'Add a task to get started');
}

function toggleAylaSugg(id, btn) {
  const el=document.getElementById('ayla-sugg-'+id); if(!el) return;
  const open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  btn.textContent=open?'💡 Ayla\'s Suggestion':'▲ Hide Suggestion';
}

function generateTaskSuggestion(task) {
  const t=task.title.toLowerCase();
  const totalCash=state.banks.reduce((a,b)=>a+b.total,0);
  const reserved=state.reserves.reduce((a,r)=>a+r.amount,0);
  const available=totalCash-reserved;
  const ytdRev=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.revenue,0);
  const ytdExp=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.expenses,0);
  const totalLiab=state.liabilities.reduce((s,c)=>s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0),0);
  const totalAR=state.ar.filter(x=>x.status!=='paid').reduce((s,x)=>s+x.amount,0);
  const overdueAR=state.ar.filter(x=>x.status==='overdue').reduce((s,x)=>s+x.amount,0);
  const margin=ytdRev?Math.round(((ytdRev-ytdExp)/ytdRev)*100):0;
  const pipeWtd=state.pipeline.reduce((a,d)=>a+d.value*(d.probability/100),0);

  if (t.includes('cash')||t.includes('liquidity')||t.includes('runway')) {
    const burnRate=state.budget.reduce((a,b)=>a+(b.months?.['Apr']?.actual||0),0);
    const runway=burnRate?Math.round(available/burnRate):0;
    return `<strong>🤖 Ayla:</strong> Current available cash is <strong>${fmt(available)}</strong> with ~<strong>${runway} months</strong> runway at current burn. ${overdueAR>0?`Accelerate the <strong>${fmt(overdueAR)}</strong> overdue AR collection to boost liquidity.`:''} Consider reviewing reserves allocation — you have <strong>${fmt(reserved)}</strong> reserved. Prepare a 3-scenario projection (base/optimistic/stress) before presenting to the CEO.`;
  }
  if (t.includes('renewal')||t.includes('contract')||t.includes('proposal')) {
    const renewSoon=state.clients.filter(c=>Math.ceil((new Date(c.renewal)-TODAY)/864e5)<90);
    const bigClient=renewSoon.sort((a,b)=>b.revenue-a.revenue)[0];
    return `<strong>🤖 Ayla:</strong> ${renewSoon.length} contract${renewSoon.length!==1?'s':''} renewing within 90 days. ${bigClient?`Priority: <strong>${bigClient.name}</strong> (${fmt(bigClient.revenue)}/yr) — prepare renewal terms with a 10-15% upsell proposal based on their SaaS vs services mix.`:''} Ensure financial terms reflect current costs + margin targets (currently at ${margin}%).`;
  }
  if (t.includes('ar')||t.includes('receivable')||t.includes('invoice')||t.includes('collection')) {
    return `<strong>🤖 Ayla:</strong> ${fmt(overdueAR)} in overdue AR requires immediate attention. ${state.ar.filter(x=>x.status==='overdue').map(x=>`<strong>${x.client}</strong> (${fmt(x.amount)})`).join(', ')||'None currently overdue.'}. Suggested actions: (1) Send formal reminder to overdue clients within 24h, (2) Escalate accounts >30 days via account manager, (3) Consider ${overdueAR>50000?'legal notice for high-value accounts.':'a payment plan for smaller balances.'}`;
  }
  if (t.includes('budget')||t.includes('expense')||t.includes('cost')||t.includes('spend')) {
    const topCat=[...state.budget].sort((a,b)=>b.annual-a.annual)[0];
    return `<strong>🤖 Ayla:</strong> Largest budget category is <strong>${topCat?.cat} (${fmt(topCat?.annual||0)}/yr)</strong>. YTD margin is <strong>${margin}%</strong>${margin<20?' — below the 20% target; review variable costs for quick wins':' — healthy range'}. Focus Q3 review on cloud and contractor spend which tend to grow fastest.`;
  }
  if (t.includes('reconcile')||t.includes('bank')||t.includes('statement')) {
    return `<strong>🤖 Ayla:</strong> ${state.banks.length} bank accounts to reconcile totalling <strong>${fmt(totalCash)}</strong>. Check for: (1) unrecorded transactions, (2) AR payments not yet reflected, (3) VAT/tax payments. Priority accounts: ${state.banks.sort((a,b)=>b.total-a.total).slice(0,2).map(b=>b.name).join(' and ')}.`;
  }
  if (t.includes('pipeline')||t.includes('deal')||t.includes('hubspot')) {
    const proposals=state.pipeline.filter(d=>d.stage==='Proposal'||d.stage==='Negotiation');
    return `<strong>🤖 Ayla:</strong> Weighted pipeline forecast is <strong>${fmt(pipeWtd)}</strong>. ${proposals.length} deals in Proposal/Negotiation stage worth <strong>${fmt(proposals.reduce((a,d)=>a+d.value,0))}</strong>. Closing these would bring revenue to ${fmt(ytdRev+proposals.reduce((a,d)=>a+d.value*(d.probability/100),0))} YTD. Push for Q3 closes to hit annual target.`;
  }
  if (t.includes('vat')||t.includes('tax')||t.includes('compliance')) {
    const vatLiab=state.liabilities.find(c=>c.name.toLowerCase().includes('vat'));
    const vatAmt=vatLiab?(vatLiab.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0):0;
    return `<strong>🤖 Ayla:</strong> ${vatAmt>0?`VAT payable stands at <strong>${fmt(vatAmt)}</strong>. Ensure funds are earmarked before the filing deadline.`:''} Current available cash (${fmt(available)}) covers all VAT obligations. Prepare the full VAT reconciliation report and cross-check with QBO transactions.`;
  }
  if (t.includes('report')||t.includes('board')||t.includes('presentation')) {
    return `<strong>🤖 Ayla:</strong> Key metrics for your board package: Cash ${fmt(available)} available · Revenue ${fmt(ytdRev)} YTD · Margin ${margin}% · AR ${fmt(totalAR)} outstanding (${fmt(overdueAR)} overdue) · Pipeline ${fmt(pipeWtd)} weighted. ${margin<15?'⚠ Flag margin as an area of focus and present 3 cost reduction initiatives.':'Narrative: strong revenue growth with controlled costs.'}`;
  }
  // Generic CEO task suggestion
  return `<strong>🤖 Ayla:</strong> For this CEO-requested task, here's the financial context: Cash available <strong>${fmt(available)}</strong> · Revenue YTD <strong>${fmt(ytdRev)}</strong> · Margin <strong>${margin}%</strong> · Outstanding AR <strong>${fmt(totalAR)}</strong>. Ensure your response addresses the CEO's priorities and aligns with Q3 financial targets. ${overdueAR>0?`Note: <strong>${fmt(overdueAR)}</strong> in overdue AR is the most urgent financial risk to mention.`:''}`;
}

function openAddTask() {
  ['task-title','task-ceo-note','task-notify-email'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('task-deadline').value='';
  document.getElementById('task-priority').value='medium';
  document.getElementById('task-type').value='task';
  document.getElementById('ceo-extra').style.display='none';
  const recurCb = document.getElementById('task-recurring');
  if (recurCb) { recurCb.checked=false; document.getElementById('task-recur-opts').style.display='none'; }
  document.getElementById('task-recur-interval').value='weekly';
  document.getElementById('task-modal-title').textContent='Add Task';
  document.getElementById('task-save-btn').textContent='Add Task';
  delete document.getElementById('modal-task').dataset.editId;
  openModal('modal-task');
}

function openEditTask(id) {
  const t=state.tasks.find(x=>x.id===id); if(!t) return;
  document.getElementById('task-modal-title').textContent='Edit Task';
  document.getElementById('task-title').value=t.title||'';
  document.getElementById('task-deadline').value=t.deadline||'';
  const neEl=document.getElementById('task-notify-email'); if(neEl) neEl.value=t.notifyEmail||'';
  setSelectValue(document.getElementById('task-priority'), t.priority||'medium');
  setSelectValue(document.getElementById('task-type'), t.taskType||'task');
  const showCeo=t.taskType==='ceo'||t.taskType==='cpo';
  document.getElementById('ceo-extra').style.display=showCeo?'block':'none';
  if(showCeo){
    document.getElementById('task-remind-days').value=t.remindDays||3;
    document.getElementById('task-ceo-note').value=t.ceoNote||'';
    const lbl=document.getElementById('ceo-note-label'); if(lbl) lbl.textContent=t.taskType==='cpo'?'CPO Instructions':'CEO Instructions';
  }
  const recurCb=document.getElementById('task-recurring');
  if(recurCb){recurCb.checked=!!t.recurring; document.getElementById('task-recur-opts').style.display=t.recurring?'flex':'none';}
  document.getElementById('task-recur-interval').value=t.recurringInterval||'weekly';
  document.getElementById('task-save-btn').textContent='Save Changes';
  document.getElementById('modal-task').dataset.editId=id;
  openModal('modal-task');
}
document.addEventListener('change', e=>{
  if(e.target.id==='task-type') {
    const show = e.target.value==='ceo'||e.target.value==='cpo';
    document.getElementById('ceo-extra').style.display=show?'block':'none';
    const lbl = document.getElementById('ceo-note-label');
    if(lbl) lbl.textContent = e.target.value==='cpo' ? 'CPO Instructions' : 'CEO Instructions';
  }
});

async function saveTask() {
  const title=document.getElementById('task-title').value.trim(); if(!title){toast('Task title required');return;}
  const deadline=document.getElementById('task-deadline').value, priority=document.getElementById('task-priority').value;
  const type=document.getElementById('task-type')?.value||'task';
  const ceoNote=document.getElementById('task-ceo-note')?.value||'';
  const remindDays=parseInt(document.getElementById('task-remind-days')?.value)||3;
  const recurring=document.getElementById('task-recurring')?.checked||false;
  const recurringInterval=document.getElementById('task-recur-interval')?.value||'weekly';
  const notifyEmail=document.getElementById('task-notify-email')?.value.trim()||'';
  const payload={title,deadline,priority,taskType:type,recurring,recurringInterval,notifyEmail};
  if(type==='ceo'){payload.ceoNote=ceoNote;payload.remindDays=remindDays;}
  const editId=document.getElementById('modal-task').dataset.editId;
  try {
    if(editId){
      await apiCall(`/tasks/${editId}`,{method:'PATCH',body:JSON.stringify(payload)});
      const i=state.tasks.findIndex(t=>t.id===Number(editId));
      if(i>-1) state.tasks[i]={...state.tasks[i],...payload};
      closeModal('modal-task'); renderTasksList(); toast('Task updated');
    } else {
      const r=await apiCall('/tasks',{method:'POST',body:JSON.stringify(payload)});
      state.tasks.unshift(r.task);
      closeModal('modal-task'); renderTasksList();
      if(type==='ceo') toast('CEO task added — reminder set for '+remindDays+' days');
      else toast('Task added');
    }
  } catch(e){toast(e.message);}
}

function _nextRecurDeadline(deadline, interval) {
  const d = deadline ? new Date(deadline+'T00:00:00') : new Date();
  if (interval==='daily')     d.setDate(d.getDate()+1);
  else if (interval==='weekly')    d.setDate(d.getDate()+7);
  else if (interval==='monthly')   d.setMonth(d.getMonth()+1);
  else if (interval==='quarterly') d.setMonth(d.getMonth()+3);
  return d.toISOString().split('T')[0];
}

async function toggleTask(id) {
  const t=state.tasks.find(x=>x.id===id); if(!t) return;
  t.done=!t.done;
  renderTasksList();  // optimistic update
  // update counter in header
  const hdr = document.querySelector('#tasks-list')?.closest('.card')?.querySelector('.card-header + div');
  if (hdr) { const open=state.tasks.filter(x=>!x.done).length; const done=state.tasks.filter(x=>x.done).length; hdr.textContent=`${open} open · ${done} completed`; }
  const patchBody = { done: t.done };
  if (t.done) { patchBody.doneAt = new Date().toISOString(); t.doneAt = patchBody.doneAt; }
  try {
    await apiCall(`/tasks/${id}`,{method:'PATCH',body:JSON.stringify(patchBody)});
    if (t.done && t.recurring) {
      const nextDeadline = _nextRecurDeadline(t.deadline, t.recurringInterval||'weekly');
      const payload = { title:t.title, deadline:nextDeadline, priority:t.priority, taskType:t.taskType, recurring:true, recurringInterval:t.recurringInterval, ceoNote:t.ceoNote||'', remindDays:t.remindDays||3 };
      try {
        const r = await apiCall('/tasks',{method:'POST',body:JSON.stringify(payload)});
        state.tasks.unshift(r.task);
        toast('Recurring task renewed → '+nextDeadline);
      } catch(e) { toast('Renew failed: '+e.message); }
    }
  } catch(e) {
    t.done=!t.done;  // revert on error
    renderTasksList();
    toast('Error: '+e.message);
  }
}
function toggleDone(){state.showDone=!state.showDone; render();}
async function deleteTask(id) { await apiCall(`/tasks/${id}`,{method:'DELETE'}); state.tasks=state.tasks.filter(t=>t.id!==id); renderTasksList(); }

// ── Task Completion Notification ─────────────────────────────────────────────
let _taskNotifyId = null;

function openTaskNotify(id) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  _taskNotifyId = id;
  const completedDate = t.doneAt
    ? new Date(t.doneAt).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const deadlineText = t.deadline
    ? new Date(t.deadline + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : '—';
  const defSubject = `✅ Task Completed: ${t.title}`;
  const defMsg = `We are pleased to confirm that the following task has been successfully completed.\n\nPlease feel free to reach out if you have any questions or require further information.`;

  document.getElementById('task-notify-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;min-height:520px">
      <!-- Left: compose -->
      <div style="padding:22px 20px 18px;border-right:1px solid var(--border);display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-2);margin-bottom:5px">To</div>
          <input class="input" id="tn-to" value="${(t.notifyEmail||'').replace(/"/g,'&quot;')}" placeholder="recipient@example.com" oninput="updateTaskNotifyPreview()" style="font-size:12px">
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-2);margin-bottom:5px">Subject</div>
          <input class="input" id="tn-subject" value="${defSubject.replace(/"/g,'&quot;')}" oninput="updateTaskNotifyPreview()" style="font-size:12px">
        </div>
        <div style="flex:1;display:flex;flex-direction:column">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-2);margin-bottom:5px">Message</div>
          <textarea id="tn-message" oninput="updateTaskNotifyPreview()" style="font-size:12px;resize:vertical;flex:1;min-height:140px" class="input">${defMsg}</textarea>
        </div>
        <div style="background:var(--surface-2);border-radius:8px;padding:12px 14px">
          <div style="font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Task Summary</div>
          <div style="font-size:12px;color:var(--text);font-weight:600;margin-bottom:4px">${(t.title||'').replace(/</g,'&lt;')}</div>
          <div style="font-size:11px;color:var(--text-2)">Deadline: ${deadlineText} · ${(t.priority||'medium')} priority</div>
          <div style="font-size:11px;color:var(--success);margin-top:4px;font-weight:600">✓ Completed ${completedDate}</div>
        </div>
        <div id="tn-status" style="font-size:11px;color:var(--text-2);min-height:16px"></div>
        <div style="display:flex;gap:8px;padding-top:4px">
          <button class="btn" onclick="closeModal('modal-task-notify')" style="font-size:12px">Cancel</button>
          <button class="btn btn-primary" onclick="sendTaskNotify()" style="font-size:12px;font-weight:700;background:linear-gradient(135deg,#0D9488,#059669);border:none;color:#fff">Send Notification</button>
        </div>
      </div>
      <!-- Right: live preview -->
      <div style="padding:16px;background:var(--surface-2);overflow-y:auto">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-2);margin-bottom:10px">Live Preview</div>
        <div id="tn-preview" style="background:#F0F4F8;border-radius:10px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif"></div>
      </div>
    </div>`;

  updateTaskNotifyPreview();
  openModal('modal-task-notify');
}

function updateTaskNotifyPreview() {
  const t = state.tasks.find(x => x.id === _taskNotifyId); if (!t) return;
  const message = document.getElementById('tn-message')?.value || '';
  const el = document.getElementById('tn-preview'); if (!el) return;
  el.innerHTML = _buildTaskCompletePreview(t, message);
}

function _buildTaskCompletePreview(t, message) {
  const completedDate = t.doneAt
    ? new Date(t.doneAt).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const deadlineText = t.deadline
    ? new Date(t.deadline + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : '—';
  const PRIO_COLOR = { high:'#DC2626', medium:'#D97706', low:'#6B7280' };
  const prioColor = PRIO_COLOR[t.priority] || '#6B7280';
  const msgHtml = (message || '').split('\n').filter(Boolean).map(l => `<div style="margin-bottom:5px">${l.replace(/</g,'&lt;')}</div>`).join('') ||
    '<div>Task has been successfully completed.</div>';
  return `
    <div style="background:linear-gradient(135deg,#0D9488,#059669);padding:28px 24px 22px;text-align:center">
      <div style="width:52px;height:52px;background:rgba(255,255,255,.15);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:26px;line-height:52px">✅</div>
      <div style="font-size:19px;font-weight:800;color:#fff;margin-bottom:4px">Task Completed</div>
      <div style="font-size:10px;color:rgba(255,255,255,.7)">${completedDate}</div>
    </div>
    <div style="background:#fff;padding:22px 24px">
      <div style="font-size:12px;color:#374151;line-height:1.75;margin-bottom:18px">${msgHtml}</div>
      <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:10px;padding:16px 18px;margin-bottom:14px">
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#16A34A;margin-bottom:8px">Completed Task</div>
        <div style="font-size:14px;font-weight:700;color:#14532D;margin-bottom:10px">${(t.title||'').replace(/</g,'&lt;')}</div>
        <div style="display:flex;gap:16px">
          <div><div style="font-size:8px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Deadline</div><div style="font-size:11px;font-weight:600;color:#1F2937">📅 ${deadlineText}</div></div>
          <div><div style="font-size:8px;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Priority</div><div style="font-size:11px;font-weight:700;color:${prioColor};text-transform:capitalize">● ${t.priority||'medium'}</div></div>
        </div>
      </div>
      <div style="background:#ECFDF5;border-radius:7px;padding:10px 14px;margin-bottom:16px">
        <div style="font-size:11px;color:#166534;font-weight:600">✓ Status: Completed on ${completedDate}</div>
      </div>
      <div style="font-size:10px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:14px;line-height:1.6">Automated notification · Aladdin Finance CFO Platform</div>
    </div>
    <div style="background:#0F1B2D;padding:14px 24px;text-align:center">
      <div style="font-size:12px;font-weight:800;color:#FF681A;margin-bottom:2px">Aladdin Finance</div>
      <div style="font-size:9px;color:rgba(255,255,255,.35)">Task Management · ${new Date().getFullYear()}</div>
    </div>`;
}

async function sendTaskNotify() {
  const t = state.tasks.find(x => x.id === _taskNotifyId); if (!t) return;
  const toEmail   = document.getElementById('tn-to')?.value.trim() || '';
  const subject   = document.getElementById('tn-subject')?.value.trim() || '';
  const message   = document.getElementById('tn-message')?.value.trim() || '';
  const statusEl  = document.getElementById('tn-status');
  if (!toEmail) { if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">Please enter a recipient email.</span>'; return; }
  if (statusEl) statusEl.textContent = 'Sending…';
  try {
    await apiCall(`/tasks/${_taskNotifyId}/notify-complete`, { method:'POST', body: JSON.stringify({ toEmail, customSubject: subject, message }) });
    // save notifyEmail back to task if it changed
    if (toEmail !== t.notifyEmail) {
      await apiCall(`/tasks/${_taskNotifyId}`, { method:'PATCH', body: JSON.stringify({ notifyEmail: toEmail }) });
      t.notifyEmail = toEmail;
    }
    closeModal('modal-task-notify');
    toast('Completion notification sent to ' + toEmail);
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`;
  }
}

// ── Files ─────────────────────────────────────────────────────────────────────
const FILE_CATS = ['all','contract','license','nda','tax','compliance','report','invoice','insurance','identity','other'];
function renderFiles(c) {
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">Legal Documents & Official Files</div></div>
        <div style="display:flex;gap:6px;align-items:center">
          <div id="drive-status-badge" style="font-size:10px;color:var(--text-3);display:flex;align-items:center;gap:4px"></div>
          <button class="btn btn-sm" id="drive-sync-btn" onclick="syncFromDrive()" style="display:none">↻ Drive</button>
          <select id="upload-cat-sel" class="input" style="font-size:10px;padding:2px 6px;height:28px;width:110px">
            ${FILE_CATS.filter(x=>x!=='all').map(cat=>`<option value="${cat}">${cat.charAt(0).toUpperCase()+cat.slice(1)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('file-upload-inp').click()">⬆ Upload</button>
          <input type="file" id="file-upload-inp" style="display:none" onchange="uploadFile(this)">
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1">
          ${FILE_CATS.map(f=>`<button class="btn btn-sm${state.fileFilter===f?' btn-primary':''}" onclick="setFileFilter('${f}')">${f==='all'?'All':f.charAt(0).toUpperCase()+f.slice(1)}</button>`).join('')}
        </div>
        <input class="input" id="file-search" placeholder="Search files…" style="width:180px;font-size:11px" oninput="renderFilesList()">
      </div>
      <div id="files-list"></div>
    </div>
  </div>`;
  renderFilesList();
  // Check Drive status async
  apiCall('/files/drive/status').then(s => {
    const badge = document.getElementById('drive-status-badge');
    const btn   = document.getElementById('drive-sync-btn');
    if (!badge) return;
    if (s.connected) {
      badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:var(--success);display:inline-block"></span> <span style="color:var(--success)">Drive linked</span>`;
      if (btn) btn.style.display = '';
    } else if (s.needsReauth) {
      badge.innerHTML = `<a href="${s.reAuthUrl}" target="_blank" style="color:var(--primary);font-size:10px;font-weight:600;text-decoration:none">🔗 Re-authorize Google to enable Drive →</a>`;
    } else if (s.needsAuth) {
      badge.innerHTML = `<a href="${s.reAuthUrl}" target="_blank" style="color:var(--primary);font-size:10px;font-weight:600;text-decoration:none">🔗 Connect Google to enable Drive →</a>`;
    } else {
      badge.innerHTML = `<span style="color:var(--text-3);font-size:10px">Drive: folder ID not set</span>`;
    }
  }).catch(()=>{});
}

async function syncFromDrive() {
  const btn = document.getElementById('drive-sync-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Syncing…'; }
  try {
    const r = await apiCall('/files/drive/sync', { method: 'POST' });
    const newFiles = await apiCall('/files');
    state.files = newFiles;
    renderFilesList();
    toast(r.message || 'Drive synced');
  } catch(e) {
    toast('Drive sync failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Drive'; }
  }
}

const FILE_EXPIRY_REQUIRED = ['contract','license','nda','tax','compliance','insurance'];
function renderFilesList() {
  const ICO={p:'fi-pdf',x:'fi-xls',d:'fi-doc'}, LBL={p:'PDF',x:'XLS',d:'DOC'};
  const q=(document.getElementById('file-search')?.value||'').toLowerCase();
  let list = state.fileFilter==='all' ? state.files : state.files.filter(f=>f.type===state.fileFilter);
  if (q) list=list.filter(f=>(f.name||'').toLowerCase().includes(q)||(f.type||'').toLowerCase().includes(q));
  const el=document.getElementById('files-list'); if(!el) return;
  const CAT_COLOR={'contract':'var(--primary)','license':'var(--success)','nda':'var(--warning)','tax':'var(--danger)','compliance':'#7C3AED','report':'var(--info)','invoice':'#D97706','insurance':'#0891B2','identity':'#DC2626','other':'var(--text-3)'};
  el.innerHTML=list.length?list.map(f=>{
    const expDays=f.expiryDate?Math.ceil((new Date(f.expiryDate+'T00:00:00')-TODAY)/864e5):null;
    const expBadge=expDays!==null?(expDays<0?`<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--danger-bg);color:var(--danger);font-weight:700">Expired</span>`:expDays<30?`<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--warning-bg);color:var(--warning-text);font-weight:700">Exp. ${expDays}d</span>`:expDays<90?`<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--info-bg);color:var(--info);font-weight:700">${expDays}d left</span>`:''):'';
    const needsExpiry = FILE_EXPIRY_REQUIRED.includes(f.type) && !f.expiryDate;
    const expiryBorderStyle = needsExpiry ? 'border:1px solid var(--warning);border-radius:4px;' : '';
    return `<div class="file-row" style="align-items:flex-start">
      <div class="file-icon ${ICO[f.cat]||'fi-doc'}" style="margin-top:2px">${LBL[f.cat]||'DOC'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">${f.name||'—'} ${expBadge}${needsExpiry?'<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--warning-bg);color:var(--warning-text);margin-left:3px" title="Expiry date required for this category">⚠ No expiry</span>':''}</div>
        <div style="font-size:10px;color:var(--text-2);margin-bottom:6px">${f.size} · ${f.date}${f.expiryDate?' · Exp: '+fmtDate(f.expiryDate):''}${f.drive?` · <span style="color:#34A853;font-weight:600">●</span> Drive`:''}</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <select class="input" style="font-size:10px;padding:2px 6px;height:24px;width:120px;color:${CAT_COLOR[f.type]||'var(--text-2)'};" onchange="updateFileCategory(${f.id},this.value)">
            ${FILE_CATS.filter(x=>x!=='all').map(c=>`<option value="${c}"${f.type===c?' selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}
          </select>
          <input type="date" class="input" style="font-size:10px;padding:2px 6px;height:24px;width:130px;${expiryBorderStyle}" value="${f.expiryDate||''}" title="${needsExpiry?'Expiry date required for '+f.type+' documents':'Expiry date'}" onchange="updateFileExpiry(${f.id},this.value)">
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;margin-top:2px">
        ${f.webViewLink?`<a href="${f.webViewLink}" target="_blank" class="file-action" style="text-decoration:none;color:var(--info)">Open ↗</a>`:''}
        ${(f.storedAs||f.driveId)?`<button class="file-action" onclick="downloadFile(${f.id},'${(f.name||'').replace(/'/g,'\\\'')}')" >Download</button>`:''}
        <button class="file-action" style="color:var(--danger-text)" onclick="deleteFile(${f.id})">Delete</button>
      </div>
    </div>`;}).join('') : emptyState('No files in this category', 'Upload a file using the button above');
}
function setFileFilter(f){state.fileFilter=f;render();}
async function updateFileCategory(id, type) {
  try {
    await apiCall(`/files/${id}`, {method:'PUT', body:JSON.stringify({type})});
    const f=state.files.find(x=>x.id===id); if(f) f.type=type;
    renderFilesList();
  } catch(e){toast('Failed to update category');}
}
async function updateFileExpiry(id, expiryDate) {
  try {
    await apiCall(`/files/${id}`, {method:'PUT', body:JSON.stringify({expiryDate})});
    const f=state.files.find(x=>x.id===id); if(f) f.expiryDate=expiryDate;
    buildNotifications();
    renderFilesList();
  } catch(e){toast('Failed to update expiry date');}
}

async function downloadFile(id, name) {
  try {
    const res = await fetch('/api/files/' + id + '/download', { headers: authHeaders() });
    if (!res.ok) { toast('Download failed', 'error'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch(e) { toast('Download failed: ' + e.message, 'error'); }
}

async function uploadFile(inp) {
  if (!inp.files[0]) return;
  const cat = document.getElementById('upload-cat-sel')?.value || 'report';
  const fd=new FormData(); fd.append('file',inp.files[0]); fd.append('type',cat);
  try {
    const res = await fetch('/api/files/upload', { method:'POST', headers:{'Authorization':'Bearer '+state.token}, body:fd });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Upload failed');
    if (d.file) state.files.unshift(d.file);
    inp.value = '';
    renderFilesList();
    toast(d.file.drive ? `Uploaded to Drive: ${d.file.name}` : `Uploaded: ${d.file.name}`);
  } catch(e) { toast('Upload failed: ' + e.message, 'error'); }
}
async function deleteFile(id) {
  showConfirm('Delete this file?', async ()=>{
    await apiCall(`/files/${id}`,{method:'DELETE'}); state.files=state.files.filter(f=>f.id!==id); renderFilesList();
  });
}

// ── Gmail Inbox ───────────────────────────────────────────────────────────────
async function renderGmail(c) {
  c.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px">
    <div class="card-header"><div class="card-title">Gmail Inbox</div><div style="display:flex;gap:8px;align-items:center" id="gmail-toolbar"></div></div>
    <div id="gmail-body"><div style="text-align:center;padding:40px;color:var(--text-3)">Loading…</div></div>
  </div>`;

  let status = {};
  try { status = await apiCall('/gmail/status'); } catch {}

  const toolbar = document.getElementById('gmail-toolbar');
  const body    = document.getElementById('gmail-body');

  if (!status.connected) {
    const msg = status.needsReauth
      ? `Gmail scope not yet authorized. <a href="/api/events/gcal/auth" style="color:var(--primary);font-weight:600">Re-authorize Google →</a>`
      : `Gmail not connected. Go to <span style="color:var(--primary);cursor:pointer;font-weight:600" onclick="showSection('settings')">Settings → Integrations</span> to connect Google.`;
    body.innerHTML = `<div class="card" style="text-align:center;padding:40px 20px">
      <div style="font-size:40px;margin-bottom:12px">✉️</div>
      <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px">Gmail Not Connected</div>
      <div style="font-size:12px;color:var(--text-2)">${msg}</div>
    </div>`;
    return;
  }

  toolbar.innerHTML = `
    <input class="input" id="gmail-search" placeholder="Search emails…" style="width:200px;font-size:11px" oninput="gmailSearch()">
    <button class="btn btn-sm" onclick="gmailCompose()">✏ Compose</button>
    <button class="btn btn-sm" onclick="renderGmail(document.getElementById('main-content'))">↻</button>
    ${status.email ? `<span style="font-size:10px;color:var(--text-2)">● ${status.email}</span>` : ''}`;

  await gmailLoadInbox(body, '');
}

async function gmailLoadInbox(container, q) {
  container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-3)">Loading emails…</div>`;
  try {
    const data = await apiCall(`/gmail/messages?max=25${q?'&q='+encodeURIComponent(q):''}`);
    const msgs = data.messages || [];
    if (!msgs.length) {
      container.innerHTML = `<div class="card" style="text-align:center;padding:30px;color:var(--text-3)">No emails found</div>`;
      return;
    }
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px" id="gmail-list">
      ${msgs.map(m => `
        <div class="file-row" id="gm-${m.id}" style="cursor:pointer;align-items:flex-start;${m.unread?'border-left:3px solid var(--primary);':''}" onclick="gmailOpenMessage('${m.id}')">
          <div style="width:8px;height:8px;border-radius:50%;background:${m.unread?'var(--primary)':'transparent'};flex-shrink:0;margin-top:5px"></div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
              <div style="font-size:12px;font-weight:${m.unread?'700':'500'};color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%">${escHtml(m.from.replace(/<.*>/,'').trim()||m.from)}</div>
              <div style="font-size:10px;color:var(--text-3);flex-shrink:0">${formatGmailDate(m.date)}</div>
            </div>
            <div style="font-size:12px;font-weight:${m.unread?'600':'400'};color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">${escHtml(m.subject)}</div>
            <div style="font-size:11px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(m.snippet)}</div>
          </div>
        </div>`).join('')}
    </div>`;
  } catch(e) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:30px;color:var(--danger)">Error loading emails: ${e.message}</div>`;
  }
}

async function gmailOpenMessage(id) {
  const row = document.getElementById('gm-'+id);
  if (row) { row.style.borderLeft=''; row.querySelector('div')?.style && (row.querySelector('div').style.background='transparent'); }
  try {
    const msg = await apiCall('/gmail/messages/'+id);
    apiCall('/gmail/messages/'+id+'/read', {method:'POST'}).catch(()=>{});
    const modal = document.createElement('div');
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML=`<div style="background:var(--surface);border-radius:14px;width:100%;max-width:700px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">${escHtml(msg.subject)}</div>
          <div style="font-size:11px;color:var(--text-2)"><strong>From:</strong> ${escHtml(msg.from)}</div>
          <div style="font-size:11px;color:var(--text-2)"><strong>Date:</strong> ${escHtml(msg.date)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm" onclick="gmailReply('${escHtml(msg.from.replace(/.*<(.+)>.*/,'$1')||msg.from)}','${escHtml(msg.subject)}')">↩ Reply</button>
          <button class="btn btn-sm" onclick="this.closest('[style*=fixed]').remove()">✕</button>
        </div>
      </div>
      <div style="padding:20px;overflow-y:auto;flex:1;font-size:13px;color:var(--text);line-height:1.6">
        <iframe srcdoc="${escHtml(msg.body||'<p style=color:#94a3b8>No content</p>')}" style="width:100%;border:none;min-height:300px;background:white;border-radius:8px" sandbox="allow-same-origin"></iframe>
      </div>
    </div>`;
    modal.onclick = e => { if(e.target===modal) modal.remove(); };
    document.body.appendChild(modal);
  } catch(e) { toast('Could not load email: '+e.message,'error'); }
}

function gmailReply(to, subject) {
  document.querySelector('[style*=fixed]')?.remove();
  gmailCompose(to, subject.startsWith('Re:') ? subject : 'Re: '+subject);
}

function gmailCompose(to='', subject='') {
  const modal = document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:flex-end;justify-content:flex-end;padding:20px';
  modal.innerHTML=`<div style="background:var(--surface);border-radius:14px;width:500px;max-height:70vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:13px;font-weight:700;color:var(--text)">New Message</div>
      <button class="btn btn-sm" onclick="this.closest('[style*=fixed]').remove()">✕</button>
    </div>
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:8px;flex:1;overflow:auto">
      <input class="input" id="gm-to" placeholder="To" value="${escHtml(to)}" style="font-size:12px">
      <input class="input" id="gm-subj" placeholder="Subject" value="${escHtml(subject)}" style="font-size:12px">
      <textarea class="input" id="gm-body" placeholder="Write your message…" style="font-size:12px;min-height:160px;resize:vertical;line-height:1.5"></textarea>
    </div>
    <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px">
      <button class="btn btn-primary btn-sm" onclick="gmailSend(this)">Send</button>
      <button class="btn btn-sm" onclick="this.closest('[style*=fixed]').remove()">Discard</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('gm-to')?.focus();
}

async function gmailSend(btn) {
  const to      = document.getElementById('gm-to')?.value.trim();
  const subject = document.getElementById('gm-subj')?.value.trim();
  const body    = document.getElementById('gm-body')?.value.trim();
  if (!to || !subject) { toast('To and Subject are required','error'); return; }
  btn.disabled=true; btn.textContent='Sending…';
  try {
    await apiCall('/gmail/send', {method:'POST', body:JSON.stringify({to,subject,body})});
    btn.closest('[style*=fixed]')?.remove();
    toast('Email sent!');
  } catch(e) { btn.disabled=false; btn.textContent='Send'; toast('Failed: '+e.message,'error'); }
}

function gmailSearch() {
  clearTimeout(gmailSearch._t);
  gmailSearch._t = setTimeout(async () => {
    const q = document.getElementById('gmail-search')?.value.trim();
    const body = document.getElementById('gmail-body');
    if (body) await gmailLoadInbox(body, q);
  }, 500);
}

function formatGmailDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 864e5) return d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    if (diff < 6048e5) return d.toLocaleDateString('en-US',{weekday:'short'});
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  } catch { return dateStr; }
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Commissions ───────────────────────────────────────────────────────────────
function renderCommissions(c) {
  const total=state.commissions.reduce((a,x)=>a+x.amount,0);
  const paid=state.commissions.filter(x=>x.status==='paid').reduce((a,x)=>a+x.amount,0);
  const partial=state.commissions.filter(x=>x.status==='partial').reduce((a,x)=>a+(x.partialPaid||0),0);
  const approved=state.commissions.filter(x=>x.status==='approved').reduce((a,x)=>a+x.amount,0);
  const pending=state.commissions.filter(x=>x.status==='pending').reduce((a,x)=>a+x.amount,0);
  const targets = state.commSettings?.targets || {};
  const rates = state.commSettings?.rates || {};

  const curMonthStr = new Date().toISOString().slice(0,7); // YYYY-MM
  const byRep={};
  state.commissions.forEach(x=>{
    if(!byRep[x.repName]) byRep[x.repName]={total:0,paid:0,partialPaid:0,pending:0,count:0,monthlyEarned:0,totalSales:0};
    byRep[x.repName].total+=x.amount;
    if(x.status==='paid') byRep[x.repName].paid+=x.amount;
    else if(x.status==='partial') byRep[x.repName].partialPaid+=(x.partialPaid||0);
    else if(x.status==='pending'||x.status==='approved') byRep[x.repName].pending+=x.amount;
    byRep[x.repName].count++;
    byRep[x.repName].totalSales+=(x.dealValue||0);
    if((x.date||'').startsWith(curMonthStr)) byRep[x.repName].monthlyEarned+=x.amount;
  });
  // Enrich with pipeline closed-won deals per rep
  const pipeByRep={};
  state.pipeline.forEach(d=>{
    const rep=d.owner||''; if(!rep) return;
    if(!pipeByRep[rep]) pipeByRep[rep]={closed:0,types:{}};
    if(d.stage==='Closed Won') {
      pipeByRep[rep].closed++;
      pipeByRep[rep].types[d.type||'Other']=(pipeByRep[rep].types[d.type||'Other']||0)+1;
    }
  });
  const REP_COLS=['#FF6600','#2563EB','#16A34A','#7C3AED','#D97706'];
  const customReps = state.commSettings?.customReps || [];
  const archivedReps = state.commSettings?.archivedReps || [];
  const repNames = [...new Set([...Object.keys(byRep), ...customReps])];
  const activeRepNames = repNames.filter(r => !archivedReps.includes(r));

  const statusBadge = s => ({
    paid:'<span style="background:var(--info-bg);color:var(--info);font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600">Paid</span>',
    approved:'<span style="background:var(--success-bg);color:var(--success);font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600">Approved</span>',
    pending:'<span style="background:var(--warning-bg);color:var(--warning-text);font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600">Pending</span>',
    partial:'<span style="background:#FFF7ED;color:#C2410C;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600">Partial</span>'
  }[s]||s);

  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab active" onclick="switchView(this,'comm-list')">All Commissions</button>
      <button class="view-tab" onclick="switchView(this,'comm-reps')">By Rep</button>
      <button class="view-tab" onclick="switchView(this,'comm-settings')">Settings & Targets</button>
    </div>

    <div class="view-panel active" id="comm-list">
      <div class="grid-4" style="margin-bottom:12px">
        <div class="metric"><div class="metric-label">Total Commissions</div><div class="metric-value">${fmt(total)}</div></div>
        <div class="metric"><div class="metric-label">Paid Out</div><div class="metric-value" style="color:var(--info)">${fmt(paid+partial)}</div><div class="metric-sub">${partial>0?fmt(partial)+' partial':''}</div></div>
        <div class="metric"><div class="metric-label">Approved — Ready to Pay</div><div class="metric-value" style="color:var(--success)">${fmt(approved)}</div></div>
        <div class="metric"><div class="metric-label">Pending</div><div class="metric-value" style="color:var(--warning)">${fmt(pending)}</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Commission Ledger</div><button class="btn btn-primary btn-sm" onclick="openAddCommission()">+ Add</button></div>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Deal / Invoice</th><th>Rep</th><th>Client</th><th>Deal Value</th><th>Rate</th><th style="text-align:right">Commission</th><th>Status</th><th>Date</th><th></th></tr></thead>
            ${(()=>{ const {slice:cmSlice, ctrl:cmCtrl} = _paginate(state.commissions, 'commissions'); return `<tbody>${cmSlice.map(x=>{
              const isPartial = x.status==='partial';
              const paidPct = isPartial && x.amount ? Math.round(((x.partialPaid||0)/x.amount)*100) : 0;
              return `<tr>
                <td style="font-weight:600">${x.dealName}</td>
                <td>${x.repName}</td>
                <td style="color:var(--text-2)">${x.client}</td>
                <td>${fmt(x.dealValue)}</td>
                <td style="color:var(--text-2)">${x.rate}%</td>
                <td style="text-align:right">
                  <div style="font-weight:700">${fmt(x.amount)}</div>
                  ${isPartial?`<div style="font-size:10px;color:var(--text-2)">${fmt(x.partialPaid||0)} paid · ${fmt(x.amount-(x.partialPaid||0))} due</div>
                  <div style="height:3px;background:var(--surface-2);border-radius:2px;margin-top:3px;overflow:hidden"><div style="height:100%;background:#FF6600;width:${paidPct}%"></div></div>`:''}
                </td>
                <td>${statusBadge(x.status)}</td>
                <td style="color:var(--text-2);font-size:11px">${x.date||'—'}</td>
                <td style="display:flex;gap:4px">
                  <button class="btn btn-sm" style="font-size:10px;padding:2px 7px" onclick="openEditCommission(${x.id})">Edit</button>
                  <button class="del-btn" onclick="deleteCommission(${x.id})">×</button>
                </td>
              </tr>`;}).join('')}</tbody>` + cmCtrl; })()}
          </table>
        </div>
      </div>
    </div>

    <div class="view-panel" id="comm-reps">
      ${archivedReps.length?`<div style="font-size:11px;color:var(--text-2);margin-bottom:10px;padding:7px 12px;background:var(--surface-2);border-radius:8px">${archivedReps.length} rep${archivedReps.length>1?'s are':' is'} archived — manage in <a style="color:var(--primary);cursor:pointer;font-weight:600" onclick="switchView(document.querySelector('[onclick*=comm-settings]'),\'comm-settings\')">Settings &amp; Targets</a></div>`:''}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;margin-bottom:14px">
        ${activeRepNames.map((rep,i)=>{
          const d = byRep[rep] || {total:0,paid:0,partialPaid:0,pending:0,count:0,monthlyEarned:0,totalSales:0};
          const tgt = targets[rep] || {};
          const monthlyTarget = tgt.monthly || 0;
          const yearlyTarget = tgt.yearly || 0;
          const earnedTotal = d.paid + d.partialPaid;
          const yearlyPct = yearlyTarget ? Math.min(Math.round((d.totalSales/yearlyTarget)*100),100) : 0;
          const monthlyPct = monthlyTarget ? Math.min(Math.round((d.monthlyEarned/monthlyTarget)*100),100) : 0;
          const col = REP_COLS[i%REP_COLS.length];
          const pipe = pipeByRep[rep] || {closed:0,types:{}};
          const typeEntries = Object.entries(pipe.types);
          const achColor = yearlyPct>=100?'var(--success)':yearlyPct>=70?col:'var(--text-2)';
          return `
          <div class="card" style="border-top:3px solid ${col}">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <div style="width:38px;height:38px;border-radius:50%;background:${col}22;color:${col};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">${rep.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700">${rep}</div>
                <div style="font-size:10px;color:var(--text-3)">${d.count} commission${d.count>1?'s':''} · <span style="color:${col};font-weight:600">${pipe.closed} closed won</span></div>
              </div>
            </div>
            ${typeEntries.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:9px">${typeEntries.map(([t,n])=>`<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:${col}18;color:${col};font-weight:600">${t}: ${n}</span>`).join('')}</div>`:''}
            <div style="background:${col}0F;border:1px solid ${col}28;border-radius:10px;padding:11px 13px;margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
                <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${col}">Annual Achievement</span>
                ${yearlyTarget?`<span style="font-size:12px;font-weight:800;color:${achColor}">${yearlyPct}%</span>`:`<span style="font-size:9px;color:var(--text-3);font-style:italic">no target set</span>`}
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;${yearlyTarget?'margin-bottom:7px':''}">
                <span style="font-size:20px;font-weight:800;color:${col}">${fmt(d.totalSales)}</span>
                ${yearlyTarget?`<span style="font-size:11px;color:var(--text-2)">of ${fmt(yearlyTarget)}</span>`:''}
              </div>
              ${yearlyTarget?`<div style="height:7px;background:rgba(0,0,0,0.08);border-radius:4px;overflow:hidden"><div style="height:100%;background:${yearlyPct>=100?'var(--success)':col};border-radius:4px;width:${yearlyPct}%;transition:width .5s ease"></div></div>`:''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
              <div style="background:var(--success-bg);border-radius:7px;padding:9px"><div style="font-size:9px;color:var(--success-text);text-transform:uppercase;letter-spacing:.04em">Paid Out</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:var(--success)">${fmt(earnedTotal)}</div></div>
              <div style="background:var(--warning-bg);border-radius:7px;padding:9px"><div style="font-size:9px;color:var(--warning-text);text-transform:uppercase;letter-spacing:.04em">Pending</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:var(--warning)">${fmt(d.pending)}</div></div>
            </div>
            ${d.totalSales>0?`<div style="font-size:11px;color:var(--text-2);background:var(--surface-2);border-radius:6px;padding:5px 9px;margin-bottom:8px">Sales Volume: <strong>${fmt(d.totalSales)}</strong> · Avg Rate: <strong>${(d.total/d.totalSales*100).toFixed(1)}%</strong></div>`:''}
            ${monthlyTarget?`<div>
              <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-2);margin-bottom:3px">
                <span>This Month</span><span style="font-weight:600;color:${monthlyPct>=100?'var(--success)':col}">${fmt(d.monthlyEarned)} / ${fmt(monthlyTarget)}</span>
              </div>
              <div style="height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden"><div style="height:100%;background:${monthlyPct>=100?'var(--success)':col};border-radius:3px;width:${monthlyPct}%;transition:width .4s ease"></div></div>
            </div>`:''}
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Sales Closed vs Target</div><div class="card-desc">Sales volume closed compared to yearly targets — set targets in Settings &amp; Targets tab</div></div>
        <div class="chart-wrap chart-wrap-lg"><canvas id="chart-comm-rep"></canvas></div>
      </div>
    </div>

    <div class="view-panel" id="comm-settings">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
        <div class="card">
          <div class="card-header"><div class="card-title">Rate by Channel</div></div>
          <div style="font-size:12px;color:var(--text-2);margin-bottom:14px">Auto-fills when creating a new entry.</div>
          ${['Enterprise','Government','Tradeshow','Default'].map(type=>`
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:.5px solid var(--border)">
            <span style="font-size:12px;font-weight:600">${type}</span>
            <div style="display:flex;align-items:center;gap:6px">
              <input class="input input-cell" type="number" id="rate-${type.toLowerCase()}" value="${rates[type]!==undefined?rates[type]:(type==='Enterprise'?5:type==='Government'?4:type==='Tradeshow'?3:4)}" min="0" max="100" step=".5" style="width:70px;text-align:right">
              <span style="font-size:12px;color:var(--text-2)">%</span>
            </div>
          </div>`).join('')}
          <div style="margin-top:14px"><button class="btn btn-primary btn-sm" onclick="saveCommRates()">Save Rates</button></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Targets per Rep</div></div>
          <div style="font-size:12px;color:var(--text-2);margin-bottom:14px">Set monthly and yearly <strong>sales</strong> targets for each rep (measured by deal value closed).</div>
          ${activeRepNames.length ? activeRepNames.map(rep=>{
            const repData = byRep[rep] || {};
            const tgt = targets[rep] || {};
            const monthlyEarned = repData.monthlyEarned || 0;
            const totalSales = repData.totalSales || 0;
            const moPct = tgt.monthly ? Math.min(Math.round(monthlyEarned/tgt.monthly*100),100) : 0;
            const yrPct = tgt.yearly  ? Math.min(Math.round(totalSales/tgt.yearly*100),100)     : 0;
            const isCustom = customReps.includes(rep);
            const isArchived = archivedReps.includes(rep);
            const rk = rep.replace(/\s+/g,'_');
            const rs = rep.replace(/'/g,"\\'");
            const repEmails = state.commSettings?.repEmails || {};
            const savedDigests = state.appSettings?.salespersonDigests || [];
            const repEmail = (savedDigests.find(x=>x.owner===rep)||{}).email || repEmails[rep] || '';
            return `
          <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:.5px solid var(--border);${isArchived?'opacity:0.55':''}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span style="font-size:12px;font-weight:600">${rep}</span>
                ${isArchived?`<span style="font-size:9px;padding:1px 6px;border-radius:5px;background:var(--surface-2);color:var(--text-3)">archived</span>`:''}
                ${isCustom&&!isArchived?`<span style="font-size:9px;padding:1px 6px;border-radius:5px;background:var(--primary-bg);color:var(--primary)">manual</span>`:''}
              </div>
              <div style="display:flex;gap:4px">
                <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="renameRep('${rs}')">Rename</button>
                <button class="btn btn-sm" style="font-size:10px;padding:2px 8px;${isArchived?'color:var(--success);border-color:var(--success)':''}" onclick="archiveRep('${rs}',${!isArchived})">${isArchived?'Restore':'Archive'}</button>
                <button class="del-btn" onclick="confirmDeleteRep('${rs}')">×</button>
              </div>
            </div>
            <div style="margin-bottom:8px">
              <label style="font-size:10px;color:var(--text-2)">Email</label>
              <input class="input" type="email" id="tgt-email-${rk}" value="${repEmail}" placeholder="rep@company.com" style="font-size:12px;margin-top:3px" onchange="saveRepEmail('${rs}',this.value)">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:${tgt.monthly||tgt.yearly?'8px':'0'}">
              <div><label style="font-size:10px;color:var(--text-2)">Monthly ($)</label><input class="input" type="number" id="tgt-mo-${rk}" value="${tgt.monthly||''}" placeholder="e.g. 5000" style="font-size:12px;margin-top:3px"></div>
              <div><label style="font-size:10px;color:var(--text-2)">Yearly ($)</label><input class="input" type="number" id="tgt-yr-${rk}" value="${tgt.yearly||''}" placeholder="e.g. 60000" style="font-size:12px;margin-top:3px"></div>
            </div>
            ${tgt.monthly?`<div style="margin-bottom:5px"><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-2);margin-bottom:2px"><span>This month</span><span style="color:${moPct>=100?'var(--success)':'var(--primary)'};font-weight:600">${moPct}%</span></div><div style="height:4px;background:var(--surface-2);border-radius:2px;overflow:hidden"><div style="height:100%;background:${moPct>=100?'var(--success)':'var(--primary)'};width:${moPct}%;border-radius:2px"></div></div></div>`:''}
            ${tgt.yearly?`<div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-2);margin-bottom:2px"><span>Yearly sales</span><span style="color:${yrPct>=100?'var(--success)':'var(--primary)'};font-weight:600">${yrPct}% of ${fmt(tgt.yearly)}</span></div><div style="height:4px;background:var(--surface-2);border-radius:2px;overflow:hidden"><div style="height:100%;background:${yrPct>=100?'var(--success)':'var(--primary)'};width:${yrPct}%;border-radius:2px"></div></div></div>`:''}
          </div>`;}).join('') : '<div style="font-size:12px;color:var(--text-3)">Add commission entries first to set rep targets.</div>'}
          ${activeRepNames.length?`<button class="btn btn-primary btn-sm" onclick="saveCommTargets([${activeRepNames.map(r=>`'${r.replace(/'/g,"\\'")}'`).join(',')}])">Save Targets</button>`:''}
          <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
            <div style="font-size:11px;font-weight:700;color:var(--text-2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">Add Rep Manually</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <input class="input" id="new-rep-name" placeholder="Full name" style="font-size:12px">
              <input class="input" type="email" id="new-rep-email" placeholder="Email address (for digest)" style="font-size:12px">
              <button class="btn btn-sm" onclick="addCustomRep()" style="align-self:flex-start">+ Add Rep</button>
            </div>
          </div>
          ${archivedReps.length ? `<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="font-size:11px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.04em">Archived Reps</div>
              <span style="font-size:10px;background:var(--surface-2);color:var(--text-2);padding:2px 8px;border-radius:10px;font-weight:600">${archivedReps.length}</span>
            </div>
            ${archivedReps.map(rep => {
              const rk = rep.replace(/[^a-z0-9]/gi,'_');
              const repComms = state.commissions.filter(c => c.repName === rep);
              const repTotal = repComms.reduce((s,c) => s + (c.amount||0), 0);
              return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:var(--surface-2);border-radius:8px;margin-bottom:6px;opacity:.75">
                <div>
                  <div style="font-size:12px;font-weight:600;color:var(--text-1)">${rep}</div>
                  <div style="font-size:10px;color:var(--text-3);margin-top:1px">${repComms.length} commission${repComms.length!==1?'s':''} · ${fmt(repTotal)} total</div>
                </div>
                <button class="btn btn-sm" style="font-size:10px;padding:3px 10px;color:var(--success);border-color:var(--success)" onclick="archiveRep('${rep.replace(/'/g,"\\'")}',false)">Restore</button>
              </div>`;
            }).join('')}
          </div>` : ''}
        </div>
      </div>
    </div>
  </div>`;

  setTimeout(()=>{
    const repLabels = Object.keys(byRep);
    const earnedData = repLabels.map(r => byRep[r].totalSales);
    const targetData = repLabels.map(r => targets[r]?.yearly || 0);
    const hasTargets = targetData.some(v => v > 0);
    const datasets = [
      { label: 'Sales Closed', data: earnedData, backgroundColor: REP_COLS.slice(0, repLabels.length), borderRadius: 6 }
    ];
    if (hasTargets) datasets.push({ label: 'Target', data: targetData, backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 6, borderDash: [] });
    mkChart('chart-comm-rep', 'bar', { labels: repLabels, datasets });
  }, 50);
}

function openAddCommission() {
  document.getElementById('comm-modal-title').textContent='Add Commission';
  ['comm-deal','comm-rep','comm-client','comm-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('comm-value').value=''; document.getElementById('comm-rate').value='5';
  document.getElementById('comm-amount').value=''; document.getElementById('comm-status').value='pending';
  document.getElementById('comm-partial-paid').value='';
  document.getElementById('partial-paid-row').style.display='none';
  document.getElementById('comm-date').value=TODAY.toISOString().split('T')[0];
  delete document.getElementById('modal-commission').dataset.editId;
  _populateClientDL(); _populateDealDL();
  openModal('modal-commission');
}

function togglePartialPaid() {
  const isPartial = document.getElementById('comm-status').value === 'partial';
  document.getElementById('partial-paid-row').style.display = isPartial ? 'block' : 'none';
  if (isPartial) calcCommRemaining();
}

function calcCommAmt() {
  const v=Number(document.getElementById('comm-value').value)||0;
  const r=Number(document.getElementById('comm-rate').value)||0;
  document.getElementById('comm-amount').value=Math.round(v*r/100);
  calcCommRemaining();
}

function calcCommRemaining() {
  const total = Number(document.getElementById('comm-amount').value)||0;
  const paid = Number(document.getElementById('comm-partial-paid').value)||0;
  const lbl = document.getElementById('comm-remaining-label');
  if (lbl && total) lbl.textContent = `Remaining: ${fmt(total-paid)} of ${fmt(total)} total`;
}

async function saveCommission() {
  const dealName=document.getElementById('comm-deal').value.trim(); if(!dealName){toast('Deal name required');return;}
  const status = document.getElementById('comm-status').value;
  const data={dealName,repName:document.getElementById('comm-rep').value.trim(),client:document.getElementById('comm-client').value.trim(),dealValue:Number(document.getElementById('comm-value').value)||0,rate:Number(document.getElementById('comm-rate').value)||5,amount:Number(document.getElementById('comm-amount').value)||0,status,date:document.getElementById('comm-date').value,notes:document.getElementById('comm-notes').value};
  if (status==='partial') data.partialPaid = Number(document.getElementById('comm-partial-paid').value)||0;
  const eid=document.getElementById('modal-commission').dataset.editId;
  try {
    if(eid){const r=await apiCall(`/commissions/${eid}`,{method:'PUT',body:JSON.stringify(data)});const i=state.commissions.findIndex(x=>x.id===Number(eid));if(i>-1)state.commissions[i]=r.item;}
    else{const r=await apiCall('/commissions',{method:'POST',body:JSON.stringify(data)});state.commissions.push(r.item);}
    closeModal('modal-commission'); render(); toast('Commission saved');
  } catch(e){toast(e.message);}
}

async function updateCommStatus(id, status) {
  await apiCall(`/commissions/${id}`,{method:'PUT',body:JSON.stringify({status})});
  const x=state.commissions.find(c=>c.id===id); if(x) x.status=status;
  render();
}

async function deleteCommission(id) {
  showConfirm('Delete this commission entry?', async () => {
    await apiCall(`/commissions/${id}`,{method:'DELETE'}); state.commissions=state.commissions.filter(x=>x.id!==id); render();
  });
}

function openEditCommission(id) {
  const x = state.commissions.find(c=>c.id===id); if(!x) return;
  document.getElementById('comm-modal-title').textContent='Edit Commission';
  document.getElementById('comm-deal').value=x.dealName; document.getElementById('comm-rep').value=x.repName;
  document.getElementById('comm-client').value=x.client; document.getElementById('comm-value').value=x.dealValue;
  document.getElementById('comm-rate').value=x.rate; document.getElementById('comm-amount').value=x.amount;
  setSelectValue(document.getElementById('comm-status'), x.status); document.getElementById('comm-date').value=x.date||'';
  document.getElementById('comm-notes').value=x.notes||'';
  document.getElementById('comm-partial-paid').value=x.partialPaid||'';
  document.getElementById('partial-paid-row').style.display=x.status==='partial'?'block':'none';
  document.getElementById('modal-commission').dataset.editId=id;
  _populateClientDL(); _populateDealDL();
  openModal('modal-commission');
}

async function saveCommRates() {
  const cur = state.commSettings || {};
  const rates={Enterprise:Number(document.getElementById('rate-enterprise')?.value)||5,Government:Number(document.getElementById('rate-government')?.value)||4,Tradeshow:Number(document.getElementById('rate-tradeshow')?.value)||3,Default:Number(document.getElementById('rate-default')?.value)||4};
  await apiCall('/commissions/settings',{method:'PUT',body:JSON.stringify({...cur,rates})});
  if(state.commSettings) state.commSettings.rates=rates;
  toast('Commission rates saved');
}

async function saveCommTargets(repNames) {
  const cur = state.commSettings || {};
  const targets={...cur.targets};
  repNames.forEach(rep=>{
    const key=rep.replace(/\s+/g,'_');
    const mo=Number(document.getElementById('tgt-mo-'+key)?.value)||0;
    const yr=Number(document.getElementById('tgt-yr-'+key)?.value)||0;
    targets[rep]={monthly:mo,yearly:yr};
  });
  await apiCall('/commissions/settings',{method:'PUT',body:JSON.stringify({...cur,targets})});
  if(state.commSettings) state.commSettings.targets=targets;
  toast('Targets saved');
  render();
}

async function addCustomRep() {
  const inp  = document.getElementById('new-rep-name');
  const einp = document.getElementById('new-rep-email');
  const name = inp?.value.trim();
  const email= einp?.value.trim();
  if(!name){toast('Enter rep name');return;}
  const cur=state.commSettings||{};
  const customReps=[...(cur.customReps||[])];
  if(customReps.includes(name)){toast(name+' already exists');return;}
  customReps.push(name);
  const repEmails = {...(cur.repEmails||{})};
  if(email) repEmails[name] = email;
  const updated={...cur,customReps,repEmails};
  try {
    await apiCall('/commissions/settings',{method:'PUT',body:JSON.stringify(updated)});
    state.commSettings=updated;
    // Also pre-save email into salespersonDigests
    if(email){
      const digests=[...(state.appSettings?.salespersonDigests||[]).filter(x=>x.owner!==name),{owner:name,email,frequency:'weekly',startDate:''}];
      await apiCall('/app-settings',{method:'PUT',body:JSON.stringify({salespersonDigests:digests})});
      state.appSettings={...state.appSettings,salespersonDigests:digests};
    }
    if(inp)  inp.value='';
    if(einp) einp.value='';
    toast(name+' added');
    render();
  } catch(e){toast('Error: '+e.message);}
}

async function saveRepEmail(name, email) {
  const cur = state.commSettings || {};
  const repEmails = { ...(cur.repEmails||{}), [name]: email };
  try {
    await apiCall('/commissions/settings', { method:'PUT', body:JSON.stringify({...cur,repEmails}) });
    state.commSettings = { ...cur, repEmails };
    // Sync into salespersonDigests too
    const digests = [...(state.appSettings?.salespersonDigests||[])];
    const idx = digests.findIndex(x=>x.owner===name);
    if(idx>=0) digests[idx]={...digests[idx],email};
    else digests.push({owner:name,email,frequency:'weekly',startDate:''});
    await apiCall('/app-settings',{method:'PUT',body:JSON.stringify({salespersonDigests:digests})});
    state.appSettings={...state.appSettings,salespersonDigests:digests};
  } catch(e) { toast('Error saving email: '+e.message); }
}

async function deleteCustomRep(name) {
  const cur = state.commSettings || {};
  const customReps = (cur.customReps || []).filter(r => r !== name);
  const updated = { ...cur, customReps };
  try {
    await apiCall('/commissions/settings', { method:'PUT', body:JSON.stringify(updated) });
    state.commSettings = updated;
    toast(name + ' removed');
    render();
  } catch(e) { toast('Error: ' + e.message); }
}

function renameRep(oldName) {
  showPrompt('Rename rep', oldName, async (newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed || trimmed === oldName) return;
    try {
      await apiCall('/commissions/rep-rename', { method:'POST', body:JSON.stringify({ oldName, newName: trimmed }) });
      state.commissions = state.commissions.map(c => c.repName === oldName ? { ...c, repName: trimmed } : c);
      const cur = state.commSettings || {};
      const targets = { ...(cur.targets || {}) };
      if (targets[oldName]) { targets[trimmed] = targets[oldName]; delete targets[oldName]; }
      const customReps = (cur.customReps || []).map(r => r === oldName ? trimmed : r);
      const archivedReps = (cur.archivedReps || []).map(r => r === oldName ? trimmed : r);
      state.commSettings = { ...cur, targets, customReps, archivedReps };
      toast('"' + oldName + '" renamed to "' + trimmed + '"');
      render();
    } catch(e) { toast('Error: ' + e.message); }
  }, { okLabel: 'Rename' });
}

async function archiveRep(repName, archive) {
  const cur = state.commSettings || {};
  const archivedReps = [...(cur.archivedReps || [])];
  if (archive) { if (!archivedReps.includes(repName)) archivedReps.push(repName); }
  else { const i = archivedReps.indexOf(repName); if (i >= 0) archivedReps.splice(i, 1); }
  const updated = { ...cur, archivedReps };
  try {
    await apiCall('/commissions/settings', { method:'PUT', body:JSON.stringify(updated) });
    state.commSettings = updated;
    toast(repName + (archive ? ' archived' : ' restored to active'));
    render();
  } catch(e) { toast('Archive error: ' + e.message); }
}

function confirmDeleteRep(name) {
  const hasComms = state.commissions.some(c => c.repName === name);
  const count = state.commissions.filter(c => c.repName === name).length;
  const msg = hasComms
    ? '"' + name + '" has ' + count + ' commission record' + (count !== 1 ? 's' : '') + '. Remove from targets & settings only? Commission history will be preserved.'
    : 'Remove "' + name + '" from the rep list?';
  showConfirm(msg, async () => {
  const cur = state.commSettings || {};
  const customReps = (cur.customReps || []).filter(r => r !== name);
  const archivedReps = (cur.archivedReps || []).filter(r => r !== name);
  const targets = { ...(cur.targets || {}) };
  delete targets[name];
  const updated = { ...cur, customReps, archivedReps, targets };
  try {
    await apiCall('/commissions/settings', { method:'PUT', body:JSON.stringify(updated) });
    state.commSettings = updated;
    toast(name + ' removed from rep list');
    render();
  } catch(e) { toast('Error: ' + e.message); }
  }, { okLabel: 'Remove' });
}

// ── Projects ──────────────────────────────────────────────────────────────────
const PROJ_STATUS_COL={active:'var(--success)',preparing:'var(--info)','under process':'var(--primary)','on hold':'var(--warning)',paused:'var(--warning)',completed:'var(--success)',cancelled:'var(--danger)',proposal:'var(--purple)'};
const PROJ_STATUS_BG={active:'var(--success-bg)',preparing:'var(--info-bg)','under process':'var(--primary-bg)','on hold':'var(--warning-bg)',paused:'var(--warning-bg)',completed:'var(--success-bg)',cancelled:'var(--danger-bg)',proposal:'var(--purple-bg)'};

const PROJ_HISTORY_STATUSES = new Set(['completed','cancelled']);

function renderProjects(c) {
  const allProjects = state.projects||[];
  const active  = allProjects.filter(p=>!PROJ_HISTORY_STATUSES.has(p.status));
  const history = allProjects.filter(p=>PROJ_HISTORY_STATUSES.has(p.status));
  const totalBudget=allProjects.reduce((a,p)=>a+p.budget,0);
  const totalSpend=allProjects.reduce((a,p)=>a+p.actualSpend,0);
  const totalRev=allProjects.reduce((a,p)=>a+p.linkedRevenue,0);

  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="grid-4" style="margin-bottom:2px">
      <div class="metric"><div class="metric-label">Total Projects</div><div class="metric-value">${allProjects.length}</div><div class="metric-sub">${active.length} active</div></div>
      <div class="metric"><div class="metric-label">Total Budget</div><div class="metric-value">${fmt(totalBudget)}</div></div>
      <div class="metric"><div class="metric-label">Actual Spend</div><div class="metric-value" style="color:var(--primary)">${fmt(totalSpend)}</div><div class="metric-sub">${totalBudget?Math.round(totalSpend/totalBudget*100):0}% of budget</div></div>
      <div class="metric"><div class="metric-label">Linked Revenue</div><div class="metric-value" style="color:var(--success)">${fmt(totalRev)}</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <div class="view-tabs" style="width:fit-content">
        <button class="view-tab${state.projTab==='active'?' active':''}" onclick="state.projTab='active';renderProjects(document.getElementById('main-content'))">Active <span style="background:var(--surface-2);border-radius:10px;padding:1px 7px;font-size:10px">${active.length}</span></button>
        <button class="view-tab${state.projTab==='history'?' active':''}" onclick="state.projTab='history';renderProjects(document.getElementById('main-content'))">History <span style="background:var(--surface-2);border-radius:10px;padding:1px 7px;font-size:10px">${history.length}</span></button>
      </div>
      ${state.projTab==='history'?`<input class="input" style="width:220px;font-size:12px" placeholder="Search history…" value="${state._projSearch||''}" oninput="state._projSearch=this.value;renderProjects(document.getElementById('main-content'))">`:``}
      <button class="btn btn-sm" style="color:var(--primary);border-color:var(--primary-bg);margin-left:auto" onclick="openAI('projects')">✦ Ask Ayla</button>
      ${state.projTab==='active'?`<button class="btn btn-primary btn-sm" onclick="openAddProject()">+ New Project</button>`:''}
    </div>
    <div class="card">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${(()=>{
          let projects = state.projTab==='active' ? active : history;
          if (state.projTab==='history' && state._projSearch) {
            const q = state._projSearch.toLowerCase();
            projects = projects.filter(p=>[p.name,p.client,p.manager,p.status,p.endDate].join(' ').toLowerCase().includes(q));
          }
          return projects.map((p,pi)=>{
          const pct=p.budget?Math.min(Math.round((p.actualSpend/p.budget)*100),100):0;
          const over=p.actualSpend>p.budget&&p.budget>0;
          const endDays=p.endDate?Math.ceil((new Date(p.endDate+'T00:00:00')-TODAY)/864e5):null;
          return `<div class="card" style="border-left:4px solid ${PROJ_STATUS_COL[p.status]||'var(--border)'}">
            <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
              <div style="flex:2;min-width:200px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
                  <span style="font-size:13px;font-weight:700">${p.name}</span>
                  <span class="tag" style="background:${PROJ_STATUS_BG[p.status]||'var(--surface-2)'};color:${PROJ_STATUS_COL[p.status]||'var(--text-2)'};text-transform:capitalize">${p.status}</span>
                  ${p.stage?`<span class="tag tag-neutral" style="font-size:9px">${p.stage}</span>`:''}
                  ${p.type?`<span class="tag tag-neutral" style="font-size:9px">${p.type}</span>`:''}
                  ${p.completionPct>0?`<span style="font-size:9px;font-weight:700;color:var(--primary)">${p.completionPct}% done</span>`:''}
                </div>
                <div style="font-size:11px;color:var(--text-2);margin-bottom:8px">${p.client}${p.manager?' · PM: '+p.manager:''} · ${p.startDate||'—'} → ${p.endDate||'ongoing'}${endDays!==null&&endDays>=0&&p.status==='active'?' <span class="countdown cd-'+(endDays<14?'urgent':endDays<30?'soon':'ok')+'">'+endDays+'d left</span>':''}</div>
                ${p.description?`<div style="font-size:11px;color:var(--text-2);margin-bottom:8px">${p.description}</div>`:''}
                ${p.milestones?.length?`<div style="display:flex;flex-wrap:wrap;gap:6px">${p.milestones.map(ms=>`<span class="tag ${ms.done?'tag-success':'tag-neutral'}" style="font-size:10px">${ms.done?'✓ ':''} ${ms.title}</span>`).join('')}</div>`:``}
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;min-width:340px">
                <div style="background:var(--surface-2);border-radius:8px;padding:10px"><div style="font-size:9px;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em">Budget</div><div style="font-size:15px;font-weight:700;margin-top:2px">${fmt(p.budget)}</div></div>
                <div style="background:${over?'var(--danger-bg)':'var(--surface-2)'};border-radius:8px;padding:10px"><div style="font-size:9px;color:${over?'var(--danger-text)':'var(--text-3)'};text-transform:uppercase;letter-spacing:.04em">Spend</div><div style="font-size:15px;font-weight:700;margin-top:2px;color:${over?'var(--danger)':'var(--text)'}">${fmt(p.actualSpend)}</div></div>
                <div style="background:var(--success-bg);border-radius:8px;padding:10px"><div style="font-size:9px;color:var(--success-text);text-transform:uppercase;letter-spacing:.04em">Revenue</div><div style="font-size:15px;font-weight:700;margin-top:2px;color:var(--success)">${fmt(p.linkedRevenue)}</div></div>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
                <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="editProject(${p.id})">Edit</button>
                <button class="btn btn-sm" style="font-size:10px;padding:3px 8px;background:var(--primary-bg);color:var(--primary);border-color:var(--primary)" onclick="openProjExpenses(${p.id})">💰 Expenses${p.expenses?.length?` (${p.expenses.length})`:''}</button>
                <button class="btn btn-sm" style="font-size:10px;padding:3px 8px;background:#EFF6FF;color:#2563EB;border-color:rgba(37,99,235,.3)" onclick="openProjBudget(${p.id})">📊 Budget${p.budgetItems?.length?` (${p.budgetItems.length})`:''}</button>
                <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="previewProjReport(${p.id})" title="Preview report">👁</button>
                <button class="btn btn-sm" style="font-size:10px;padding:3px 8px;background:var(--success-bg);color:var(--success);border-color:rgba(22,163,74,.2)" onclick="sendProjReport(${p.id})" title="Send report email">📧 Send</button>
                <button class="del-btn" onclick="deleteProject(${p.id})">×</button>
              </div>
            </div>
            <div style="margin-top:10px;display:grid;grid-template-columns:1fr${p.completionPct>=0&&p.completionPct!==undefined?' 1fr':''};gap:12px">
              <div>
                ${(()=>{
                  const displayPct = over ? Math.min(pct, 100) : pct;
                  const barColor = over?'var(--danger)':pct>80?'var(--warning)':'var(--success)';
                  return `<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3);margin-bottom:3px">
                    <span>Budget utilization</span>
                    <span style="${over?'color:var(--danger);font-weight:700':pct>80?'color:var(--warning-text);font-weight:600':''}">${pct}%${over?` — <strong>${pct-100}% OVER</strong>`:''}</span>
                  </div>
                  <div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden;position:relative">
                    <div style="height:100%;background:${barColor};border-radius:3px;width:${displayPct}%;transition:width .4s ease"></div>
                    ${over?`<div style="position:absolute;right:0;top:0;height:100%;width:3px;background:var(--danger);border-radius:1px;animation:pulse 1s infinite"></div>`:''}
                  </div>`;
                })()}
              </div>
              ${(p.completionPct!==undefined&&p.completionPct!==null)?`<div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3);margin-bottom:3px"><span>Completion</span><span style="color:var(--primary);font-weight:600">${p.completionPct}%</span></div>
                <div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden"><div style="height:100%;background:var(--primary);border-radius:3px;width:${p.completionPct}%;transition:width .4s ease"></div></div>
              </div>`:''}
            </div>
          </div>`;
        }).join('')||'<div style="font-size:12px;color:var(--text-3);padding:20px;text-align:center">No projects yet — click + New Project to start</div>'})()}
      </div>
    </div>
  </div>`;
}

function _populateProjSelects(currentName, currentClient) {
  const nameEl = document.getElementById('proj-name');
  if (nameEl) {
    const deals = (state.pipeline||[]).filter(d=>d.stage!=='Closed Lost');
    nameEl.innerHTML = '<option value="">Select pipeline deal…</option>' +
      deals.map(d=>`<option value="${(d.name||'').replace(/"/g,'&quot;')}">${d.name||''}${d.client?' — '+d.client:''}</option>`).join('');
    if (currentName) setSelectValue(nameEl, currentName);
  }
  const clientEl = document.getElementById('proj-client');
  if (clientEl) {
    clientEl.innerHTML = '<option value="">Select client…</option>' +
      (state.clients||[]).map(c=>`<option value="${(c.name||'').replace(/"/g,'&quot;')}">${c.name||''}</option>`).join('');
    if (currentClient) setSelectValue(clientEl, currentClient);
  }
}
function onProjNameChange(sel) {
  const deal = (state.pipeline||[]).find(d=>d.name===sel.value);
  if (!deal) return;
  const clientEl = document.getElementById('proj-client');
  if (clientEl && deal.client) setSelectValue(clientEl, deal.client);
}
function openAddProject() {
  document.getElementById('proj-modal-title').textContent='Add Project';
  ['proj-manager','proj-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('proj-budget').value=''; document.getElementById('proj-revenue').value='';
  document.getElementById('proj-start').value=TODAY.toISOString().split('T')[0];
  document.getElementById('proj-end').value='';
  document.getElementById('proj-status').value='preparing';
  const sl=document.getElementById('proj-completion'); if(sl){sl.value=0; document.getElementById('proj-completion-val').textContent='0%';}
  delete document.getElementById('modal-project').dataset.editId;
  _populateProjSelects('','');
  openModal('modal-project');
}

function editProject(id) {
  const p=state.projects.find(x=>x.id===id); if(!p) return;
  document.getElementById('proj-modal-title').textContent='Edit — '+p.name;
  _populateProjSelects(p.name, p.client);
  setSelectValue(document.getElementById('proj-status'), p.status);
  document.getElementById('proj-start').value=p.startDate;
  document.getElementById('proj-end').value=p.endDate||'';
  document.getElementById('proj-budget').value=p.budget;
  document.getElementById('proj-revenue').value=p.linkedRevenue;
  document.getElementById('proj-manager').value=p.manager||'';
  document.getElementById('proj-desc').value=p.description||'';
  const stageEl=document.getElementById('proj-stage'); if(stageEl) setSelectValue(stageEl, p.stage||'');
  const sl=document.getElementById('proj-completion');
  const pct=p.completionPct??0;
  if(sl){sl.value=pct; document.getElementById('proj-completion-val').textContent=pct+'%';}
  document.getElementById('modal-project').dataset.editId=id;
  openModal('modal-project');
}

async function saveProject() {
  const name=document.getElementById('proj-name').value.trim(); if(!name){toast('Project name required');return;}
  const data={
    name, client:document.getElementById('proj-client').value.trim(),
    type:document.getElementById('proj-type')?.value||'',
    status:document.getElementById('proj-status').value,
    stage:(document.getElementById('proj-stage')?.value||'').trim(),
    startDate:document.getElementById('proj-start').value,
    endDate:document.getElementById('proj-end').value,
    budget:Number(document.getElementById('proj-budget').value)||0,
    linkedRevenue:Number(document.getElementById('proj-revenue').value)||0,
    manager:document.getElementById('proj-manager').value.trim(),
    description:document.getElementById('proj-desc').value,
    completionPct:Number(document.getElementById('proj-completion')?.value)||0
  };
  const eid=document.getElementById('modal-project').dataset.editId;
  try {
    if(eid){
      await apiCall(`/projects/${eid}`,{method:'PUT',body:JSON.stringify(data)});
      const i=state.projects.findIndex(x=>x.id===Number(eid));
      if(i>-1) state.projects[i]={...state.projects[i],...data};
    } else {
      const r=await apiCall('/projects',{method:'POST',body:JSON.stringify(data)});
      state.projects.push(r.item);
    }
    closeModal('modal-project'); render(); toast('Project saved');
  } catch(e){toast(e.message);}
}

async function deleteProject(id) {
  const p = state.projects.find(x=>x.id===id);
  showConfirm(`Delete project "${p?.name||'this project'}"?`, async () => {
    await apiCall(`/projects/${id}`,{method:'DELETE'}); state.projects=state.projects.filter(p=>p.id!==id); render();
  });
}


// ── Project Budget Breakdown ──────────────────────────────────────────────────
let _projBudIdx = null;

function openProjBudget(id) {
  _projBudIdx = id;
  const p = state.projects.find(x=>x.id===id); if(!p) return;
  document.getElementById('proj-bud-title').textContent = `Budget Breakdown — ${p.name}`;
  ['bud-cat','bud-desc','bud-amt-local','bud-amt-usd','bud-fin-cat'].forEach(el=>{const e=document.getElementById(el);if(e)e.value='';});
  const rateEl=document.getElementById('bud-rate'); if(rateEl) rateEl.value='1';
  const curEl=document.getElementById('bud-currency'); if(curEl) curEl.value='USD';
  const dl=document.getElementById('bud-fin-cats');
  if(dl) dl.innerHTML=(state.budget||[]).map(b=>`<option value="${(b.cat||'').replace(/"/g,'&quot;')}">`).join('');
  _renderProjBudget(p);
  openModal('modal-proj-budget');
}

function _renderProjBudget(p) {
  const items = p.budgetItems || [];
  const total = items.reduce((s,b)=>s+(b.amountUsd||0),0);
  const rows = items.length ? `
    <table class="table" style="font-size:12px">
      <thead><tr><th>Category</th><th>Description</th><th>Maps to Financials</th><th>Currency</th><th style="text-align:right">Local Amt</th><th style="text-align:right">Rate</th><th style="text-align:right">USD</th><th></th></tr></thead>
      <tbody>
        ${items.map((b,i)=>`<tr>
          <td style="font-weight:600">${b.category||'—'}</td>
          <td style="color:var(--text-2)">${b.description||'—'}</td>
          <td>${b.financialCat?`<span style="font-size:10px;background:#EFF6FF;color:#2563EB;border:1px solid rgba(37,99,235,.2);border-radius:4px;padding:2px 7px;font-weight:600">${b.financialCat}</span>`:'<span style="color:var(--text-3);font-size:11px">—</span>'}</td>
          <td><span style="font-size:10px;font-weight:700;background:var(--surface-2);padding:2px 7px;border-radius:4px">${b.currency||'USD'}</span></td>
          <td style="text-align:right">${b.currency!=='USD'?fmt(b.amountLocal||0):'—'}</td>
          <td style="text-align:right;color:var(--text-3);font-size:11px">${b.currency!=='USD'?(b.rate||1):'1'}</td>
          <td style="text-align:right;font-weight:700">${fmt(b.amountUsd||0)}</td>
          <td><button class="del-btn" onclick="removeBudgetItem(${i})">×</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="display:flex;justify-content:flex-end;padding:8px 20px 4px;border-top:1px solid var(--border)">
      <div style="text-align:right">
        <div style="font-size:10px;color:var(--text-2);text-transform:uppercase;letter-spacing:.04em">Total Budget (USD)</div>
        <div style="font-size:20px;font-weight:800;color:var(--primary)">${fmt(total)}</div>
        ${p.budget&&p.budget!==total?`<div style="font-size:10px;color:var(--warning-text)">⚠ Differs from saved budget ${fmt(p.budget)} — click Save &amp; Update</div>`:''}
      </div>
    </div>` : '<div style="padding:20px;font-size:12px;color:var(--text-3);text-align:center">No budget items yet — add items below</div>';
  document.getElementById('proj-bud-content').innerHTML = `<div style="padding:0 0 4px">${rows}</div>`;
}

function calcBudUsd() {
  const local = Number(document.getElementById('bud-amt-local')?.value)||0;
  const rate  = Number(document.getElementById('bud-rate')?.value)||1;
  const usd   = Math.round(local / rate * 100) / 100;
  const usdEl = document.getElementById('bud-amt-usd');
  if(usdEl) usdEl.value = usd || '';
}

async function fetchExchangeRate() {
  const currency = document.getElementById('bud-currency')?.value;
  if (!currency || currency === 'USD') {
    const rateEl = document.getElementById('bud-rate'); if(rateEl) rateEl.value='1';
    calcBudUsd(); return;
  }
  try {
    const r = await apiCall(`/app-settings/exchange-rate?from=${currency}&to=USD`);
    const rateEl = document.getElementById('bud-rate');
    if(rateEl && r.rate) { rateEl.value = r.rate; calcBudUsd(); toast(`1 ${currency} = ${r.rate} USD`); }
  } catch(e) { toast('Rate fetch failed — enter manually'); }
}

function addBudgetItem() {
  const cat        = (document.getElementById('bud-cat')?.value||'').trim();
  const desc       = (document.getElementById('bud-desc')?.value||'').trim();
  const currency   = document.getElementById('bud-currency')?.value||'USD';
  const local      = Number(document.getElementById('bud-amt-local')?.value)||0;
  const rate       = Number(document.getElementById('bud-rate')?.value)||1;
  const usd        = Number(document.getElementById('bud-amt-usd')?.value)||Math.round(local/rate*100)/100;
  const financialCat = (document.getElementById('bud-fin-cat')?.value||'').trim();
  if(!cat||!usd){toast('Category and amount required');return;}
  const i = state.projects.findIndex(x=>x.id===_projBudIdx); if(i===-1) return;
  if(!state.projects[i].budgetItems) state.projects[i].budgetItems=[];
  state.projects[i].budgetItems.push({id:Date.now(),category:cat,description:desc,currency,amountLocal:local,rate,amountUsd:usd,financialCat});
  ['bud-cat','bud-desc','bud-amt-local','bud-amt-usd','bud-fin-cat'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  _renderProjBudget(state.projects[i]);
}

function removeBudgetItem(idx) {
  const i = state.projects.findIndex(x=>x.id===_projBudIdx); if(i===-1) return;
  state.projects[i].budgetItems = (state.projects[i].budgetItems||[]).filter((_,j)=>j!==idx);
  _renderProjBudget(state.projects[i]);
}

async function saveBudgetBreakdown() {
  const i = state.projects.findIndex(x=>x.id===_projBudIdx); if(i===-1) return;
  const items = state.projects[i].budgetItems||[];
  const totalUsd = items.reduce((s,b)=>s+(b.amountUsd||0),0);
  state.projects[i].budget = totalUsd;
  try {
    await apiCall(`/projects/${_projBudIdx}`,{method:'PUT',body:JSON.stringify({budgetItems:items,budget:totalUsd})});
    closeModal('modal-proj-budget');
    render();
    toast(`Budget updated — ${fmt(totalUsd)} USD from ${items.length} items`);
  } catch(e){toast(e.message);}
}

// ── Project Expenses ──────────────────────────────────────────────────────────
let _projExpIdx = null;
function openProjExpenses(id) {
  _projExpIdx = id;
  cancelEditExpense();
  const p = state.projects.find(x=>x.id===id); if(!p) return;
  document.getElementById('proj-exp-title').textContent = `Expenses — ${p.name}`;
  _renderProjExpenses(p);
  openModal('modal-proj-expenses');
}

function _renderProjExpenses(p) {
  const exps = p.expenses || [];
  const approved = exps.filter(e => e.status !== 'rejected');
  const pending  = exps.filter(e => e.status === 'pending');
  const total  = approved.reduce((a,e)=>a+e.amount,0);
  const profit = p.linkedRevenue - total;
  const pettyUrl = p.pettyToken ? `${location.origin}/petty-cash/${p.pettyToken}` : null;

  const statusBadge = s => {
    if (!s || s === 'approved') return '';
    if (s === 'pending')  return `<span style="font-size:10px;padding:1px 7px;border-radius:8px;background:var(--warning-bg);color:var(--warning);font-weight:700;margin-left:6px">Pending</span>`;
    if (s === 'rejected') return `<span style="font-size:10px;padding:1px 7px;border-radius:8px;background:var(--danger-bg);color:var(--danger);font-weight:700;margin-left:6px">Rejected</span>`;
    return '';
  };

  document.getElementById('proj-exp-content').innerHTML = `
    <div style="padding:14px 20px">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
        <div class="metric"><div class="metric-label">Total Spent</div><div class="metric-value" style="color:var(--primary)">${fmt(total)}</div><div class="metric-sub">${approved.length} approved${pending.length?` · <span style="color:var(--warning)">${pending.length} pending</span>`:''}</div></div>
        <div class="metric"><div class="metric-label">Budget</div><div class="metric-value">${fmt(p.budget)}</div><div class="metric-sub">${p.budget?Math.round(total/p.budget*100):0}% used</div></div>
        <div class="metric" style="${profit>=0?'background:var(--success-bg)':'background:var(--danger-bg)'}"><div class="metric-label">Profit</div><div class="metric-value" style="color:${profit>=0?'var(--success)':'var(--danger)'}">${fmt(profit)}</div><div class="metric-sub">Rev ${fmt(p.linkedRevenue)}</div></div>
      </div>

      <!-- Public Expense Link Card -->
      <div style="margin-bottom:10px;border-radius:12px;border:1.5px solid rgba(255,102,0,.25);background:linear-gradient(135deg,rgba(255,102,0,.04) 0%,var(--surface) 100%);padding:14px 16px">
        <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div style="width:38px;height:38px;border-radius:10px;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🔗</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:2px">Public Expense Submission Link</div>
            <div style="font-size:11px;color:var(--text-2);margin-bottom:8px">Share with team members to submit expenses without an account.</div>
            ${pettyUrl ? `
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <code style="font-size:11px;background:var(--surface-2);border:1px solid var(--border);border-radius:7px;padding:6px 12px;color:var(--primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${pettyUrl}</code>
                <button class="btn btn-sm btn-primary" onclick="copyPettyLink('${pettyUrl}')">📋 Copy</button>
                <button class="btn btn-sm" onclick="window.open('${pettyUrl}','_blank')">↗ Open</button>
                <button class="btn btn-sm" style="color:var(--danger-text)" onclick="regeneratePettyToken(${p.id})" title="Regenerate link">🔄</button>
              </div>
            ` : `<button class="btn btn-sm btn-primary" onclick="generatePettyToken(${p.id})">Generate Link</button>`}
          </div>
        </div>
      </div>
      <!-- Google Drive Link -->
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <span style="font-size:18px;flex-shrink:0">📁</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:10px;font-weight:700;color:var(--text-2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Attachments Drive Folder</div>
          <input class="input" id="exp-drive-url" placeholder="Paste Google Drive folder link…" value="${(p.expenseDriveUrl||'').replace(/"/g,'&quot;')}" style="font-size:11px;padding:5px 9px;height:auto">
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
          <button class="btn btn-sm" onclick="saveExpenseDriveUrl(${p.id})" style="font-size:10px">Save</button>
          ${p.expenseDriveUrl ? `<a href="${p.expenseDriveUrl.replace(/"/g,'&quot;')}" target="_blank" rel="noopener" class="btn btn-sm" style="font-size:10px;color:#34A853;border-color:rgba(52,168,83,.4)">↗ Open</a>` : ''}
        </div>
      </div>

      ${exps.length ? `<table class="table">
        <thead><tr><th>Description</th><th>Spent By</th><th>Method</th><th style="text-align:right">Amount</th><th>Date</th><th>Status</th><th></th></tr></thead>
        <tbody>${exps.map((e,ei)=>{
          const methodLabel = {petty_cash:'Petty Cash',credit_card:'Credit Card',personal_funds:'Personal'}[e.paymentMethod||'petty_cash']||e.paymentMethod||'—';
          const methodCol   = {petty_cash:'var(--primary)',credit_card:'var(--info)',personal_funds:'var(--success)'}[e.paymentMethod||'petty_cash']||'var(--text-2)';
          return `<tr style="${e.status==='rejected'?'opacity:.55':''}">
          <td style="font-weight:600">${e.from||'—'}${e.note?`<div style="font-size:10px;color:var(--text-3);margin-top:1px">${e.note}</div>`:''}${e.attachment?`<div style="margin-top:3px"><a href="${e.attachment}" target="_blank" style="font-size:10px;color:var(--primary);text-decoration:none">📎 ${e.attachmentName||'Receipt'}</a></div>`:''}</td>
          <td style="color:var(--text-2)">${e.who||'—'}</td>
          <td><span style="font-size:10px;font-weight:600;color:${methodCol}">${methodLabel}</span></td>
          <td style="text-align:right;font-weight:700">${fmt(e.amount)}</td>
          <td style="color:var(--text-3);font-size:11px">${e.date||'—'}</td>
          <td>${statusBadge(e.status||'approved')}</td>
          <td>
            <div style="display:flex;gap:4px;justify-content:flex-end">
              ${(!e.status||e.status==='pending') ? `
                <button class="btn btn-sm" style="font-size:10px;color:var(--success);border-color:rgba(22,163,74,.3)" onclick="approveProjExpense(${p.id},${e.id})">✓</button>
                <button class="btn btn-sm" style="font-size:10px;color:var(--danger);border-color:rgba(220,38,38,.3)" onclick="rejectProjExpense(${p.id},${e.id})">✕</button>
              ` : ''}
              <button class="btn btn-sm" style="font-size:10px" onclick="editProjExpense(${e.id})">✏</button>
              <button class="del-btn" onclick="removeProjExpense(${ei})">×</button>
            </div>
          </td>
        </tr>`;}).join('')}</tbody>
      </table>` : '<div style="font-size:12px;color:var(--text-3);padding:10px 0">No expenses recorded yet.</div>'}
    </div>`;
}

let _editingExpId = null;

async function addProjExpense() {
  const from   = document.getElementById('exp-from')?.value.trim();
  const who    = document.getElementById('exp-who')?.value.trim();
  const method = document.getElementById('exp-method')?.value || 'petty_cash';
  const amt    = Number(document.getElementById('exp-amount')?.value)||0;
  if(!from||!amt){toast('Description and amount required');return;}
  const i = state.projects.findIndex(x=>x.id===_projExpIdx); if(i===-1) return;

  // Edit mode
  if (_editingExpId) {
    const ei = (state.projects[i].expenses||[]).findIndex(e=>e.id===_editingExpId);
    if (ei > -1) {
      state.projects[i].expenses[ei] = { ...state.projects[i].expenses[ei], from, who, amount:amt, paymentMethod:method };
      state.projects[i].actualSpend = state.projects[i].expenses.filter(e=>e.status!=='rejected').reduce((a,e)=>a+e.amount,0);
      try {
        await apiCall(`/projects/${_projExpIdx}/expenses/${_editingExpId}`,{method:'PUT',body:JSON.stringify({from,who,amount:amt,paymentMethod:method})});
        cancelEditExpense(); _renderProjExpenses(state.projects[i]); toast('Expense updated');
      } catch(e){toast(e.message);}
    }
    return;
  }

  if(!state.projects[i].expenses) state.projects[i].expenses=[];
  state.projects[i].expenses.push({id:Date.now(),from,who,paymentMethod:method,amount:amt,date:TODAY.toISOString().split('T')[0],status:'approved'});
  state.projects[i].actualSpend = state.projects[i].expenses.filter(e=>e.status!=='rejected').reduce((a,e)=>a+e.amount,0);
  ['exp-from','exp-who','exp-amount'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  try {
    await apiCall(`/projects/${_projExpIdx}`,{method:'PUT',body:JSON.stringify({expenses:state.projects[i].expenses,actualSpend:state.projects[i].actualSpend})});
    _renderProjExpenses(state.projects[i]); toast('Expense added');
  } catch(e){toast(e.message);}
}

function editProjExpense(expId) {
  const i = state.projects.findIndex(x=>x.id===_projExpIdx); if(i===-1) return;
  const exp = (state.projects[i].expenses||[]).find(e=>e.id===expId); if(!exp) return;
  _editingExpId = expId;
  const fromEl = document.getElementById('exp-from');
  const whoEl  = document.getElementById('exp-who');
  const methEl = document.getElementById('exp-method');
  const amtEl  = document.getElementById('exp-amount');
  const labelEl= document.getElementById('exp-form-label');
  const btnEl  = document.getElementById('exp-submit-btn');
  const cancelEl= document.getElementById('exp-cancel-edit');
  if(fromEl) fromEl.value = exp.from||'';
  if(whoEl)  whoEl.value  = exp.who||'';
  if(methEl) methEl.value = exp.paymentMethod||'petty_cash';
  if(amtEl)  amtEl.value  = exp.amount||'';
  if(labelEl)  labelEl.textContent  = 'Edit Expense';
  if(btnEl)    btnEl.textContent    = 'Save Changes';
  if(cancelEl) cancelEl.style.display = 'inline-flex';
  fromEl?.focus();
}

function cancelEditExpense() {
  _editingExpId = null;
  ['exp-from','exp-who','exp-amount'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const methEl = document.getElementById('exp-method'); if(methEl) methEl.value='petty_cash';
  const labelEl = document.getElementById('exp-form-label'); if(labelEl) labelEl.textContent='Add Expense';
  const btnEl   = document.getElementById('exp-submit-btn'); if(btnEl)   btnEl.textContent='+ Add';
  const cancelEl= document.getElementById('exp-cancel-edit'); if(cancelEl) cancelEl.style.display='none';
}

async function saveExpenseDriveUrl(projId) {
  const url = (document.getElementById('exp-drive-url')?.value||'').trim();
  const i = state.projects.findIndex(x=>x.id===projId); if(i===-1) return;
  try {
    await apiCall(`/projects/${projId}`,{method:'PUT',body:JSON.stringify({expenseDriveUrl:url})});
    state.projects[i].expenseDriveUrl = url;
    _renderProjExpenses(state.projects[i]);
    toast(url ? 'Drive link saved' : 'Drive link removed');
  } catch(e){toast(e.message);}
}

async function removeProjExpense(ei) {
  const i = state.projects.findIndex(x=>x.id===_projExpIdx); if(i===-1) return;
  state.projects[i].expenses = (state.projects[i].expenses||[]).filter((_,idx)=>idx!==ei);
  state.projects[i].actualSpend = state.projects[i].expenses.reduce((a,e)=>a+e.amount,0);
  try {
    await apiCall(`/projects/${_projExpIdx}`,{method:'PUT',body:JSON.stringify({expenses:state.projects[i].expenses,actualSpend:state.projects[i].actualSpend})});
    _renderProjExpenses(state.projects[i]); toast('Expense removed');
  } catch(e){toast(e.message);}
}

async function generatePettyToken(id) {
  try {
    const r = await apiCall(`/projects/${id}/petty-token`);
    const i = state.projects.findIndex(x => x.id === id);
    if (i > -1) { state.projects[i].pettyToken = r.token; _renderProjExpenses(state.projects[i]); }
    toast('Public link generated');
  } catch(e) { toast('Error: ' + e.message); }
}

async function regeneratePettyToken(id) {
  if (!confirm('Regenerate? The old link will stop working.')) return;
  try {
    const r = await apiCall(`/projects/${id}/regenerate-petty-token`, { method: 'POST' });
    const i = state.projects.findIndex(x => x.id === id);
    if (i > -1) { state.projects[i].pettyToken = r.token; _renderProjExpenses(state.projects[i]); }
    toast('New link generated');
  } catch(e) { toast('Error: ' + e.message); }
}

function copyPettyLink(url) {
  navigator.clipboard.writeText(url).then(() => toast('Link copied!')).catch(() => toast('Copy failed'));
}

async function approveProjExpense(projId, expId) {
  try {
    await apiCall(`/projects/${projId}/expenses/${expId}/approve`, { method: 'PUT' });
    const i = state.projects.findIndex(x => x.id === projId);
    if (i > -1) {
      const exp = (state.projects[i].expenses || []).find(e => e.id === expId);
      if (exp) { exp.status = 'approved'; state.projects[i].actualSpend = state.projects[i].expenses.filter(e=>e.status!=='rejected').reduce((a,e)=>a+e.amount,0); }
      _renderProjExpenses(state.projects[i]);
    }
    toast('Expense approved');
  } catch(e) { toast('Error: ' + e.message); }
}

async function rejectProjExpense(projId, expId) {
  try {
    await apiCall(`/projects/${projId}/expenses/${expId}/reject`, { method: 'PUT' });
    const i = state.projects.findIndex(x => x.id === projId);
    if (i > -1) {
      const exp = (state.projects[i].expenses || []).find(e => e.id === expId);
      if (exp) { exp.status = 'rejected'; state.projects[i].actualSpend = state.projects[i].expenses.filter(e=>e.status!=='rejected').reduce((a,e)=>a+e.amount,0); }
      _renderProjExpenses(state.projects[i]);
    }
    toast('Expense rejected');
  } catch(e) { toast('Error: ' + e.message); }
}

function previewProjReport(id) {
  const pid = id || _projExpIdx; if(!pid) return;
  window.open(`/api/reports/project-report-preview/${pid}`, '_blank');
}
async function sendProjReport(id) {
  const pid = id || _projExpIdx; if(!pid) return;
  const p = state.projects.find(x=>x.id===pid);
  if(!p) return;
  const statusEl = document.getElementById('proj-report-status');
  if(statusEl) statusEl.textContent = 'Sending…';
  try {
    const r = await apiCall(`/reports/send-project-report/${pid}`, {method:'POST'});
    if(statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ ${r.message}</span>`;
    toast(r.message || 'Report sent');
  } catch(e) {
    if(statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: '+e.message);
  }
}

// ── Reports & Emails ──────────────────────────────────────────────────────────
function renderReports(c) {
  // Auto-fetch P&L / balance-sheet if not yet loaded (user may not have visited Statements tab)
  if (!state.statements) {
    Promise.all([apiCall('/statements/pnl'), apiCall('/statements/balance-sheet')])
      .then(([pnl, bs]) => { state.statements = {pnl, balanceSheet: bs}; render(); })
      .catch(() => {});
  }
  const cfg = state.appSettings || {};
  const ceoEmail = cfg.ceoEmail || '';
  const cpoEmail = cfg.cpoEmail || '';
  const extra = (cfg.reportRecipients || []).join(', ');
  const vd = state._validation;

  const statusIcon  = s => ({ pass:'✓', warning:'⚠', fail:'✗', info:'ℹ' }[s] || '?');
  const statusColor = s => ({ pass:'var(--success)', warning:'var(--warning)', fail:'var(--danger)', info:'var(--info)' }[s] || 'var(--text-2)');
  const statusBg    = s => ({ pass:'var(--success-bg)', warning:'var(--warning-bg)', fail:'var(--danger-bg)', info:'var(--info-bg)' }[s] || 'var(--surface-2)');
  const catColor    = cat => ({
    Revenue:'#2563EB', SaaS:'#7C3AED', AR:'#D97706', Pipeline:'#FF6600',
    Budget:'#16A34A', 'Cash Flow':'#0891B2', Liabilities:'#DC2626',
    Commissions:'#059669', Projects:'#8B5CF6', Dashboard:'#6B7280',
  }[cat] || '#6B7280');

  const validationCard = vd ? `
    <div class="card" id="health-check-section" style="border:1.5px solid ${vd.summary.fail>0?'rgba(220,38,38,.25)':vd.summary.warning>0?'rgba(217,119,6,.25)':'rgba(22,163,74,.25)'}">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div>
          <div class="card-title">Data Health Check</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:2px">Last run: ${new Date(vd.runAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${vd.summary.pass    ? `<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:var(--success-bg);color:var(--success);font-weight:700">✓ ${vd.summary.pass} Pass</span>` : ''}
            ${vd.summary.warning ? `<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:var(--warning-bg);color:var(--warning);font-weight:700">⚠ ${vd.summary.warning} Warning</span>` : ''}
            ${vd.summary.fail    ? `<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:var(--danger-bg);color:var(--danger);font-weight:700">✗ ${vd.summary.fail} Issue</span>` : ''}
            ${vd.summary.info    ? `<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:var(--info-bg);color:var(--info);font-weight:700">ℹ ${vd.summary.info} Info</span>` : ''}
          </div>
          <button class="btn btn-sm ${state._healthIssuesOnly?'btn-primary':''}" onclick="state._healthIssuesOnly=!state._healthIssuesOnly;render()">${state._healthIssuesOnly?'✗ Issues Only':'⚠ View Issues'}</button>
          <button class="btn btn-sm" onclick="backfillLinks()" title="Retroactively link all existing AR, Pipeline, and Commission records to their client and deal IDs">🔗 Backfill Links</button>
          <button class="btn btn-sm" onclick="runDataValidation()" id="val-run-btn">↻ Re-run</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${(state._healthIssuesOnly ? vd.checks.filter(ch=>ch.status==='fail'||ch.status==='warning') : vd.checks).map(ch => `
          <div style="border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--surface)">
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer"
                 onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
              <div style="width:28px;height:28px;border-radius:8px;background:${statusBg(ch.status)};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:${statusColor(ch.status)};flex-shrink:0">${statusIcon(ch.status)}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
                  <span style="font-size:11px;padding:1px 7px;border-radius:9px;background:${catColor(ch.category)}22;color:${catColor(ch.category)};font-weight:700">${ch.category}</span>
                  ${ch.severity && ch.status!=='pass' && ch.status!=='info' ? `<span style="font-size:10px;padding:1px 6px;border-radius:9px;font-weight:700;background:${ch.severity==='critical'?'rgba(220,38,38,.12)':ch.severity==='high'?'rgba(234,88,12,.12)':'rgba(217,119,6,.12)'};color:${ch.severity==='critical'?'#dc2626':ch.severity==='high'?'#ea580c':'#d97706'}">${ch.severity==='critical'?'🔴 Critical':ch.severity==='high'?'🟠 High':'🟡 Medium'}</span>` : ''}
                  <span style="font-size:12px;font-weight:600;color:var(--text)">${ch.title}</span>
                </div>
                <div style="font-size:11px;color:var(--text-2);margin-top:3px;line-height:1.5">${ch.message}</div>
              </div>
              ${ch.source !== undefined ? `
              <div style="display:flex;gap:12px;text-align:right;flex-shrink:0;font-size:11px">
                <div><div style="color:var(--text-3);font-size:10px">Actual</div><div style="font-weight:700;color:var(--text)">${ch.source}</div></div>
                <div><div style="color:var(--text-3);font-size:10px">Expected</div><div style="font-weight:700;color:var(--text)">${ch.expected}</div></div>
                <div><div style="color:var(--text-3);font-size:10px">Delta</div><div style="font-weight:700;color:${statusColor(ch.status)}">${ch.delta}</div></div>
              </div>` : ''}
              <span style="font-size:10px;color:var(--text-3);flex-shrink:0">▼</span>
            </div>
            <div style="display:none;padding:10px 14px 12px;border-top:1px solid var(--border);background:var(--surface-2)">
              ${ch.aylaFix ? `
                <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:10px;padding:9px 11px;border-radius:8px;background:${ch.severity==='critical'?'rgba(220,38,38,.07)':ch.severity==='high'?'rgba(234,88,12,.07)':ch.severity==='medium'?'rgba(217,119,6,.07)':'rgba(59,130,246,.07)'};border:1px solid ${ch.severity==='critical'?'rgba(220,38,38,.18)':ch.severity==='high'?'rgba(234,88,12,.18)':ch.severity==='medium'?'rgba(217,119,6,.18)':'rgba(59,130,246,.18)'}">
                  <div style="flex-shrink:0;font-size:14px;margin-top:1px">✦</div>
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                      <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${ch.severity==='critical'?'#dc2626':ch.severity==='high'?'#ea580c':ch.severity==='medium'?'#d97706':'#3b82f6'}">${ch.severity==='critical'?'Critical':ch.severity==='high'?'High Priority':ch.severity==='medium'?'Medium':'Info'}</span>
                      <span style="font-size:10px;color:var(--text-3)">· Ayla Suggestion</span>
                    </div>
                    <div style="font-size:11px;color:var(--text);line-height:1.55">${ch.aylaFix}</div>
                  </div>
                </div>` : ''}
              ${(ch.items||[]).length ? `
                <div style="font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px">Affected Records</div>
                ${ch.items.map(it=>`
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid var(--border)">
                    <span style="font-size:12px;color:var(--text)">${it.label}</span>
                    <span style="font-size:11px;color:var(--text-2)">${it.detail}</span>
                  </div>`).join('')}
              ` : `<div style="font-size:11px;color:var(--text-2)">No detail items — check the summary message above.</div>`}
            </div>
          </div>`).join('')}
      </div>
      ${(()=>{
        const hist = (state._validationHistory||[]).slice(0,30);
        if (hist.length < 2) return '';
        const maxFail = Math.max(...hist.map(h=>h.fail||0), 1);
        const bars = [...hist].reverse().map(h => {
          const pct = Math.max(4, Math.round(((h.fail||0)/maxFail)*100));
          const clr = h.fail>0?'var(--danger)':h.warn>0?'var(--warning)':'var(--success)';
          const dt = new Date(h.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'});
          return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px" title="${dt}: ${h.fail} fail, ${h.warn} warn, ${h.pass} pass">
            <div style="width:100%;min-height:3px;border-radius:2px 2px 0 0;background:${clr};height:${pct}%" class="health-hist-bar"></div>
            ${h.fail>0?`<span style="font-size:8px;color:var(--danger);font-weight:700">${h.fail}</span>`:''}
          </div>`;
        }).join('');
        return `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <div style="font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Health Score History (last ${hist.length} runs)</div>
          <div style="display:flex;align-items:flex-end;gap:3px;height:40px">${bars}</div>
          <div style="display:flex;justify-content:space-between;margin-top:4px">
            <span style="font-size:9px;color:var(--text-3)">${new Date([...hist].reverse()[0].ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
            <span style="font-size:9px;color:var(--text-3)">Latest</span>
          </div>
        </div>`;
      })()}
    </div>` : `
    <div class="card" style="border:1.5px dashed var(--border)">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:44px;height:44px;border-radius:12px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🔍</div>
        <div style="flex:1">
          <div class="card-title">Data Health Check</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:2px">Cross-validates AR, Revenue, Pipeline, Budget, Cash Flow, Liabilities, Commissions and Projects for consistency. Flags mismatches before reporting.</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="backfillLinks()" title="Retroactively link all existing records to their client and deal IDs">🔗 Backfill Links</button>
          <button class="btn btn-primary" onclick="runDataValidation()" id="val-run-btn">Run Health Check</button>
        </div>
      </div>
    </div>`;

  // Build triggers summary
  const triggers = [
    { label: 'Financial Report', icon: '📊', schedule: cfg.reportSchedule||'manual', nextSend: cfg.reportNextSend||'', send: "sendFinancialReport()", color: 'var(--primary)' },
    { label: 'CEO Task Reminders', icon: '📋', schedule: cfg.ceoReminderSchedule||'manual', nextSend: cfg.ceoReminderNextSend||'', send: "sendCeoRemindersNow('ceo')", color: 'var(--purple)' },
    { label: 'CPO Task Reminders', icon: '📋', schedule: cfg.cpoReminderSchedule||'manual', nextSend: cfg.cpoReminderNextSend||'', send: "sendCeoRemindersNow('cpo')", color: 'var(--info)' },
    { label: 'Salesperson Digests', icon: '📈', schedule: cfg.digestBulkFrequency||'manual', nextSend: cfg.digestBulkNextSend||'', send: "sendAllDigests()", color: 'var(--success)' },
    { label: 'Pipeline Digest', icon: '📊', schedule: cfg.pipelineDigestSchedule||'manual', nextSend: cfg.pipelineDigestNextSend||'', send: "sendPipelineDigest()", color: 'var(--primary)' },

    { label: 'Daily CFO Briefing', icon: '📬', schedule: cfg.dailyBriefingSchedule||'manual', nextSend: cfg.dailyBriefingNextSend||'', send: "sendDailyBriefing()", color: 'var(--info)' },
  ];

  // Investor report metrics
  const ytdMo = MO.filter(m => {
    const mIdx = MO.indexOf(m);
    return mIdx <= new Date().getMonth();
  });
  const pnlRows = state.statements?.pnl?.rows || [];
  const rowTotal = r => ytdMo.reduce((a, m) => a + (r?.months?.[m] || 0), 0);
  const revRow = pnlRows.find(r => r.id === 'revenue');
  const cogsRow = pnlRows.find(r => r.id === 'cogs');
  const opexRows = pnlRows.filter(r => r.type === 'opex');
  const ytdRev = rowTotal(revRow);
  const ytdCogs = rowTotal(cogsRow);
  const ytdOpex = opexRows.reduce((a, r) => a + rowTotal(r), 0);
  const ytdGross = ytdRev - ytdCogs;
  const ytdEbitda = ytdGross - ytdOpex;
  const grossPct = ytdRev ? Math.round((ytdGross / ytdRev) * 100) : 0;
  const ebitdaPct = ytdRev ? Math.round((ytdEbitda / ytdRev) * 100) : 0;
  const totalCash = state.banks.reduce((a, b) => a + b.total, 0);
  const reserved = state.reserves.reduce((a, r) => a + r.amount, 0);
  const available = totalCash - reserved;
  const lastMoBurn = opexRows.reduce((a, r) => a + (r.months?.[MO[new Date().getMonth() - 1]] || 0), 0);
  const runway = lastMoBurn ? Math.round(available / lastMoBurn) : 0;
  const wtdPipeline = state.pipeline.reduce((a, d) => a + d.value * (d.probability / 100), 0);
  const overdueAR = state.ar.filter(x => x.status === 'overdue').reduce((s, x) => s + x.amount, 0);
  const totalAR = state.ar.filter(x => x.status !== 'paid').reduce((s, x) => s + x.amount, 0);

  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">

    <!-- Investor Report -->
    <div class="card" style="border:1.5px solid rgba(255,102,0,.2);background:linear-gradient(135deg,rgba(255,102,0,.03),var(--surface))">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="card-title" style="font-size:15px">Investor Report</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:2px">Key metrics for investor updates · ${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" style="color:var(--primary);border-color:var(--primary);background:var(--primary-bg)" onclick="openAI('reports')">✦ AI Brief</button>
          <button class="btn btn-primary btn-sm" onclick="downloadInvestorPDF()">⬇ Download PDF</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
        <div style="background:var(--surface-2);border-radius:10px;padding:12px;border-top:3px solid var(--primary)">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px">Revenue YTD</div>
          <div style="font-size:18px;font-weight:800;color:var(--primary);font-family:'Montserrat',sans-serif">${fmt(ytdRev)}</div>
        </div>
        <div style="background:var(--surface-2);border-radius:10px;padding:12px;border-top:3px solid ${ytdGross>=0?'var(--success)':'var(--danger)'}">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px">Gross Profit <span style="color:${grossPct>=0?'var(--success)':'var(--danger)'}">${grossPct}%</span></div>
          <div style="font-size:18px;font-weight:800;color:${ytdGross>=0?'var(--success)':'var(--danger)'};font-family:'Montserrat',sans-serif">${fmt(ytdGross)}</div>
        </div>
        <div style="background:var(--surface-2);border-radius:10px;padding:12px;border-top:3px solid ${ytdEbitda>=0?'var(--info)':'var(--danger)'}">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px">EBITDA <span style="color:${ebitdaPct>=0?'var(--info)':'var(--danger)'}">${ebitdaPct}%</span></div>
          <div style="font-size:18px;font-weight:800;color:${ytdEbitda>=0?'var(--info)':'var(--danger)'};font-family:'Montserrat',sans-serif">${fmt(ytdEbitda)}</div>
        </div>
        <div style="background:var(--surface-2);border-radius:10px;padding:12px;border-top:3px solid var(--success)">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px">Cash Available</div>
          <div style="font-size:18px;font-weight:800;color:var(--success);font-family:'Montserrat',sans-serif">${fmt(available)}</div>
        </div>
        <div style="background:var(--surface-2);border-radius:10px;padding:12px;border-top:3px solid ${runway<6?'var(--danger)':runway<12?'var(--warning)':'var(--success)'}">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px">Runway</div>
          <div style="font-size:18px;font-weight:800;color:${runway<6?'var(--danger)':runway<12?'var(--warning)':'var(--success)'};font-family:'Montserrat',sans-serif">${runway ? runway+'mo' : '—'}</div>
        </div>
        <div style="background:var(--surface-2);border-radius:10px;padding:12px;border-top:3px solid var(--purple,#7C3AED)">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px">Pipeline (Wtd)</div>
          <div style="font-size:18px;font-weight:800;color:#7C3AED;font-family:'Montserrat',sans-serif">${fmt(wtdPipeline)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:8px">Revenue Trend (Monthly)</div>
          <div class="chart-wrap chart-wrap-sm"><canvas id="investor-rev-chart"></canvas></div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:8px">Key Highlights</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--surface-2);border-radius:7px;font-size:12px">
              <span style="color:var(--text-2)">Clients</span>
              <strong style="color:var(--text)">${state.clients.filter(c=>!c.archived).length} active</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--surface-2);border-radius:7px;font-size:12px">
              <span style="color:var(--text-2)">Outstanding AR</span>
              <strong style="color:${overdueAR>0?'var(--danger)':'var(--text)'}">${fmt(totalAR)}${overdueAR>0?` <span style="font-size:10px;color:var(--danger)">(${fmt(overdueAR)} overdue)</span>`:''}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--surface-2);border-radius:7px;font-size:12px">
              <span style="color:var(--text-2)">Active Projects</span>
              <strong style="color:var(--text)">${state.projects.filter(p=>p.status==='active').length}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--surface-2);border-radius:7px;font-size:12px">
              <span style="color:var(--text-2)">Open Tasks</span>
              <strong style="color:var(--text)">${state.tasks.filter(t=>!t.done).length}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--surface-2);border-radius:7px;font-size:12px">
              <span style="color:var(--text-2)">Pipeline Deals</span>
              <strong style="color:var(--text)">${state.pipeline.filter(d=>d.stage!=='Closed Won'&&d.stage!=='Closed Lost').length} open</strong>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Email Triggers Overview -->
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">Email Triggers</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">All active automated emails — configure schedules in the cards below</div></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        ${triggers.map(t => {
          const active = t.schedule && t.schedule !== 'manual';
          return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:${active?'var(--surface-2)':'var(--bg)'};border-radius:9px;border:1px solid ${active?'rgba(22,163,74,.2)':'var(--border)'}">
            <div style="width:32px;height:32px;border-radius:8px;background:${active?'var(--success-bg)':'var(--surface-2)'};display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">${t.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700;color:var(--text)">${t.label}</div>
              <div style="font-size:11px;color:var(--text-2);margin-top:1px">
                ${active
                  ? `<span style="color:var(--success);font-weight:600">● ${t.schedule.charAt(0).toUpperCase()+t.schedule.slice(1)}</span>${t.nextSend ? ` · Next: <strong>${t.nextSend}</strong>` : ''}`
                  : `<span style="color:var(--text-3)">Manual only</span>`
                }
              </div>
            </div>
            <button class="btn btn-sm" onclick="${t.send}" style="font-size:11px">Send Now</button>
          </div>`;
        }).join('')}
      </div>
    </div>

    ${validationCard}

    <!-- Email Send Log -->
    ${(()=>{
      const log = state._emailLog || [];
      const fmtTs = ts => { try { const d=new Date(ts); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}); } catch(_){ return ts; } };
      return `<div class="card">
        <div class="card-header">
          <div><div class="card-title">Email Send Log</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">Last ${Math.min(log.length,10)} of ${log.length} send event${log.length!==1?'s':''}</div></div>
          <button class="btn btn-sm" onclick="loadEmailLog()" title="Refresh log">↻ Refresh</button>
        </div>
        ${log.length===0 ? `<div style="font-size:12px;color:var(--text-3);padding:14px 0;text-align:center">No emails sent yet — use the Send Now buttons above</div>` : `
        <div style="display:flex;flex-direction:column;gap:0">
          ${log.slice(0,10).map((e,i)=>`
            <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:${i<Math.min(log.length,10)-1?'0.5px solid var(--border)':'none'}">
              <div style="width:7px;height:7px;border-radius:50%;flex-shrink:0;background:${e.status==='sent'?'var(--success)':'var(--danger)'}"></div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="font-size:12px;font-weight:600;color:var(--text)">${e.type}</span>
                  <span style="font-size:11px;padding:1px 6px;border-radius:6px;font-weight:600;background:${e.status==='sent'?'var(--success-bg)':'var(--danger-bg)'};color:${e.status==='sent'?'var(--success)':'var(--danger)'}">${e.status}</span>
                </div>
                <div style="font-size:11px;color:var(--text-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${e.to}">To: ${e.to}</div>
              </div>
              <div style="font-size:10px;color:var(--text-3);flex-shrink:0;text-align:right">${fmtTs(e.ts)}</div>
            </div>`).join('')}
        </div>`}
      </div>`;
    })()}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">

      <!-- Financial Summary Report -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Financial Summary Report</div>
            <div style="font-size:11px;color:var(--text-2);margin-top:2px">Beautiful HTML email with cash, AR, liabilities, ratios & Ayla's insights</div>
          </div>
        </div>
        <div style="margin:12px 0;background:var(--bg);border-radius:8px;padding:12px 14px">
          <div style="font-size:11px;color:var(--text-2);margin-bottom:8px;font-weight:600">Email includes:</div>
          ${['Total cash by bank with progress bars','AR outstanding with overdue highlights','Liabilities breakdown by category','Financial health ratios (Current, Quick, DSO)','Pipeline weighted forecast','Ayla\'s proactive insights'].map(i=>`<div style="font-size:11px;color:var(--text-2);padding:2px 0">✓ ${i}</div>`).join('')}
        </div>
        <div style="background:var(--surface-2);border-radius:8px;padding:10px 14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <label style="font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Recipients</label>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="saveReportTypeRecipients('financialReport')">Save</button>
          </div>
          <input type="text" id="recip-financialReport" class="input" style="font-size:11px" placeholder="e.g. ceo@company.com, cfo@company.com (leave blank to use global list)" value="${(cfg.financialReportRecipients||[]).join(', ')}">
          <div id="recip-status-financialReport" style="font-size:10px;color:var(--success);margin-top:4px;min-height:14px"></div>
        </div>
        <div style="background:var(--surface-2);border-radius:8px;padding:12px 14px;margin-bottom:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:10px">Recurring Schedule</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;align-items:end">
            <div>
              <label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px">Frequency</label>
              <select id="rep-schedule" style="width:100%;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface)">
                <option value="manual"${(state.appSettings.reportSchedule||'manual')==='manual'?' selected':''}>Manual only</option>
                <option value="daily"${state.appSettings.reportSchedule==='daily'?' selected':''}>Daily</option>
                <option value="weekly"${state.appSettings.reportSchedule==='weekly'?' selected':''}>Weekly</option>
                <option value="monthly"${state.appSettings.reportSchedule==='monthly'?' selected':''}>Monthly</option>
              </select>
            </div>
            <div>
              <label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px">Stop After Date</label>
              <input type="date" id="rep-stop" value="${state.appSettings.reportStopDate||''}" style="width:100%;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface)">
            </div>
            <div>
              <button class="btn btn-primary btn-sm" style="width:100%" onclick="saveReportSchedule()">Save Schedule</button>
              ${state.appSettings.reportSchedule&&state.appSettings.reportSchedule!=='manual'?`<div style="font-size:10px;color:var(--success);margin-top:4px">● Active — ${state.appSettings.reportSchedule}${state.appSettings.reportStopDate?' · stops '+state.appSettings.reportStopDate:''}</div>`:''}
            </div>
          </div>
          ${state.appSettings.reportNextSend?`<div style="font-size:10px;color:var(--text-2);margin-top:8px">Next send: <strong>${state.appSettings.reportNextSend}</strong></div>`:''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="sendFinancialReport()">📧 Send Report Now</button>
          <button class="btn btn-sm" onclick="downloadFinancialPDF()">⬇ PDF</button>
          <button class="btn btn-sm" onclick="downloadPPTX()">⬇ PPTX</button>
          <button class="btn btn-sm" onclick="previewEmail('/reports/preview')">👁 Preview Email</button>
          ${state.appSettings.reportSchedule&&state.appSettings.reportSchedule!=='manual'?`<button class="btn btn-sm" style="color:var(--danger-text);border-color:var(--danger)" onclick="stopReportSchedule()">Stop Schedule</button>`:''}
        </div>
        <div id="report-status" style="margin-top:8px;font-size:11px;color:var(--text-2)"></div>
      </div>

      <!-- Task Reminders -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Task Reminders</div>
            <div style="font-size:11px;color:var(--text-2);margin-top:2px">Send beautifully designed HTML email reminders with motivational message</div>
          </div>
        </div>
        ${(()=>{
          const taskRows = (type, label, color) => {
            const tasks = state.tasks.filter(t=>t.taskType===type&&!t.done);
            if (!tasks.length) return `<div style="font-size:11px;color:var(--success);padding:4px 0">✓ No pending ${label} tasks</div>`;
            return `<div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">${tasks.length} pending ${label} task${tasks.length!==1?'s':''}</div>`+
              tasks.map(t=>{
                const overdue=t.deadline&&new Date(t.deadline+'T00:00:00')<TODAY;
                return `<div style="font-size:11px;color:var(--text);padding:4px 0;border-bottom:0.5px solid var(--border);display:flex;align-items:center;gap:6px">
                  ${overdue?`<span style="color:var(--danger);font-size:10px;font-weight:700">⚠ OVERDUE</span>`:`<span style="color:${color};font-size:10px">●</span>`}
                  <span style="flex:1">${t.title.slice(0,48)}${t.title.length>48?'…':''}</span>
                  ${t.deadline?`<span style="font-size:10px;color:var(--text-3)">${fmtDate(t.deadline)}</span>`:''}
                </div>`;
              }).join('');
          };
          return `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0">
            <div style="background:var(--bg);border-radius:8px;padding:12px 14px">
              <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:6px">
                <span style="width:8px;height:8px;border-radius:50%;background:var(--purple);display:inline-block"></span>CEO Tasks
              </div>
              ${taskRows('ceo','CEO','var(--purple)')}
              <div style="margin-top:8px;display:flex;gap:4px">
                <input type="text" id="recip-ceoReminder" class="input" style="font-size:10px;flex:1" placeholder="e.g. ceo@company.com, finance@company.com" value="${(cfg.ceoReminderRecipients||[]).join(', ')}">
                <button class="btn btn-sm" style="font-size:10px;flex-shrink:0" onclick="saveReportTypeRecipients('ceoReminder')">Save</button>
              </div>
              <div id="recip-status-ceoReminder" style="font-size:10px;color:var(--success);min-height:12px;margin-top:2px"></div>
              <button class="btn btn-primary btn-sm" style="margin-top:6px;width:100%" onclick="sendCeoRemindersNow('ceo')">📨 Send CEO Reminders</button>
            </div>
            <div style="background:var(--bg);border-radius:8px;padding:12px 14px">
              <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:6px">
                <span style="width:8px;height:8px;border-radius:50%;background:var(--info);display:inline-block"></span>CPO Tasks
              </div>
              ${taskRows('cpo','CPO','var(--info)')}
              <div style="margin-top:8px;display:flex;gap:4px">
                <input type="text" id="recip-cpoReminder" class="input" style="font-size:10px;flex:1" placeholder="e.g. cpo@company.com, finance@company.com" value="${(cfg.cpoReminderRecipients||[]).join(', ')}">
                <button class="btn btn-sm" style="font-size:10px;flex-shrink:0" onclick="saveReportTypeRecipients('cpoReminder')">Save</button>
              </div>
              <div id="recip-status-cpoReminder" style="font-size:10px;color:var(--success);min-height:12px;margin-top:2px"></div>
              <button class="btn btn-sm" style="margin-top:6px;width:100%;background:var(--info);color:#fff;border-color:var(--info)" onclick="sendCeoRemindersNow('cpo')">📨 Send CPO Reminders</button>
            </div>
          </div>`;
        })()}
        <div id="reminder-status" style="margin-top:6px;font-size:11px;color:var(--text-2)"></div>

        <!-- Reminder Schedule -->
        <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
          <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:10px">Scheduled Reminders</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${(['ceo','cpo']).map(role => {
              const schedKey = role + 'ReminderSchedule';
              const curSched = cfg[schedKey] || 'manual';
              const nextKey  = role + 'ReminderNextSend';
              const curNext  = cfg[nextKey] || '';
              return `<div style="background:var(--bg);border-radius:8px;padding:12px 14px">
                <div style="font-size:11px;font-weight:700;color:var(--text-2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">${role.toUpperCase()} Reminder Schedule</div>
                <select id="rem-sched-${role}" style="width:100%;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);margin-bottom:6px">
                  <option value="manual"${curSched==='manual'?' selected':''}>Manual only</option>
                  <option value="daily"${curSched==='daily'?' selected':''}>Daily</option>
                  <option value="weekly"${curSched==='weekly'?' selected':''}>Weekly</option>
                </select>
                <button class="btn btn-sm" style="width:100%;margin-bottom:4px" onclick="saveReminderSchedule('${role}')">Save Schedule</button>
                ${curSched!=='manual'&&curNext?`<div style="font-size:10px;color:var(--success)">● Next: ${curNext}</div>`:''}
              </div>`;
            }).join('')}
          </div>
        </div>

      </div>
    </div>

    <!-- Salesperson Pipeline Digest -->
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">Salesperson Pipeline Digest</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:2px">Send each salesperson a personalized email with only their pipeline deals</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="sendAllDigests()">📧 Send All Now</button>
      </div>
      ${(()=>{
        const pipelineOwners = [...new Set(state.pipeline.filter(d=>d.owner).map(d=>d.owner))];
        const customRepsDigest = state.commSettings?.customReps || [];
        const owners = [...new Set([...pipelineOwners, ...customRepsDigest])].sort();
        const savedDigests = cfg.salespersonDigests || [];
        const repEmails = state.commSettings?.repEmails || {};
        const bulkFreq  = cfg.digestBulkFrequency || 'weekly';
        const bulkStart = cfg.digestBulkStartDate || '';
        if (!owners.length) return '<div style="font-size:12px;color:var(--text-3);padding:8px 0">No salespersons found. Add pipeline deals with an Owner, or add reps manually in Commissions → Settings & Targets.</div>';
        return `
        <!-- Bulk schedule -->
        <div style="background:var(--bg);border-radius:10px;padding:14px;margin-top:12px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Bulk Schedule — applies to all reps</div>
          <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">
            <div>
              <label style="font-size:10px;color:var(--text-2);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Frequency</label>
              <select id="digest-bulk-freq" class="input" style="font-size:12px;margin-top:3px">
                <option value="daily"    ${bulkFreq==='daily'   ?'selected':''}>Daily</option>
                <option value="weekly"   ${bulkFreq==='weekly'  ?'selected':''}>Weekly</option>
                <option value="biweekly" ${bulkFreq==='biweekly'?'selected':''}>Bi-weekly</option>
                <option value="monthly"  ${bulkFreq==='monthly' ?'selected':''}>Monthly</option>
              </select>
            </div>
            <div>
              <label style="font-size:10px;color:var(--text-2);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Start Date</label>
              <input type="date" id="digest-bulk-start" class="input" value="${bulkStart}" style="font-size:12px;margin-top:3px">
            </div>
            <button class="btn btn-sm btn-primary" onclick="saveBulkDigestSettings()">Save Schedule</button>
          </div>
          <div id="digest-bulk-status" style="font-size:11px;color:var(--success);margin-top:6px"></div>
        </div>

        <!-- Rep list -->
        <div style="border-radius:8px;overflow:hidden;border:1px solid var(--border)">
          ${owners.map((owner, i) => {
            const saved     = savedDigests.find(x => x.owner === owner) || {};
            const oid       = owner.replace(/\s+/g,'_');
            const email     = saved.email || repEmails[owner] || '';
            const openDeals = state.pipeline.filter(d=>d.owner===owner&&d.stage!=='Closed Lost'&&d.stage!=='Closed Won').length;
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;${i>0?'border-top:1px solid var(--border)':''}">
              <div style="width:30px;height:30px;border-radius:50%;background:var(--primary-bg);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0">${owner[0]}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;color:var(--text)">${owner}</div>
                <div style="font-size:10px;color:var(--text-3)">${openDeals} open deal${openDeals!==1?'s':''}</div>
              </div>
              <input type="email" id="digest-email-${oid}" placeholder="email@company.com" value="${email}"
                class="input" style="width:220px;font-size:12px;flex-shrink:0">
              <button class="btn btn-sm" onclick="saveSalespersonDigestEmail('${owner}')">Save</button>
              <button class="btn btn-sm btn-primary" onclick="sendSalespersonDigest('${owner}')">Send</button>
              <div id="digest-status-${oid}" style="font-size:11px;min-width:36px;text-align:right"></div>
            </div>`;
          }).join('')}
        </div>`;
      })()}
    </div>

    <!-- Pipeline Digest + Daily CFO Briefing -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">

      <!-- Pipeline Digest -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Pipeline Digest</div>
            <div style="font-size:11px;color:var(--text-2);margin-top:2px">Open deals summary by stage, owner, and weighted value</div>
          </div>
        </div>
        <div style="margin:12px 0;background:var(--bg);border-radius:8px;padding:12px 14px">
          <div style="font-size:11px;color:var(--text-2);margin-bottom:8px;font-weight:600">Email includes:</div>
          ${['Open deals grouped by stage','Deal values & close probabilities','Top deals by weighted value','Owner breakdown & deal count','Stale deals flagged for follow-up'].map(i=>`<div style="font-size:11px;color:var(--text-2);padding:2px 0">✓ ${i}</div>`).join('')}
        </div>
        <div style="background:var(--surface-2);border-radius:8px;padding:10px 14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <label style="font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Recipients</label>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="saveReportTypeRecipients('pipelineDigest')">Save</button>
          </div>
          <input type="text" id="recip-pipelineDigest" class="input" style="font-size:11px" placeholder="e.g. sales@company.com, manager@company.com" value="${(cfg.pipelineDigestRecipients||[]).join(', ')}">
          <div id="recip-status-pipelineDigest" style="font-size:10px;color:var(--success);margin-top:4px;min-height:14px"></div>
        </div>
        <div style="background:var(--surface-2);border-radius:8px;padding:12px 14px;margin-bottom:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:10px">Recurring Schedule</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">
            <div>
              <label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px">Frequency</label>
              <select id="sched-pipelineDigest" style="width:100%;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface)">
                <option value="manual"${!cfg.pipelineDigestSchedule||cfg.pipelineDigestSchedule==='manual'?' selected':''}>Manual only</option>
                <option value="daily"${cfg.pipelineDigestSchedule==='daily'?' selected':''}>Daily — 7 AM Dubai</option>
                <option value="weekly"${cfg.pipelineDigestSchedule==='weekly'?' selected':''}>Weekly — 7 AM Dubai</option>
                <option value="monthly"${cfg.pipelineDigestSchedule==='monthly'?' selected':''}>Monthly — 7 AM Dubai</option>
              </select>
            </div>
            <div>
              <button class="btn btn-primary btn-sm" style="width:100%" onclick="savePipelineEmailSchedule('pipelineDigest')">Save Schedule</button>
              ${cfg.pipelineDigestSchedule&&cfg.pipelineDigestSchedule!=='manual'?`<div style="font-size:10px;color:var(--success);margin-top:4px">● Active — ${cfg.pipelineDigestSchedule}</div>`:''}
            </div>
          </div>
          ${cfg.pipelineDigestNextSend?`<div style="font-size:10px;color:var(--text-2);margin-top:8px">Next send: <strong>${cfg.pipelineDigestNextSend}</strong></div>`:''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="sendPipelineDigest()">📧 Send Now</button>
          <button class="btn btn-sm" onclick="previewEmail('/reports/pipeline-preview')">👁 Preview Email</button>
        </div>
        <div id="pipeline-digest-status" style="margin-top:8px;font-size:11px;color:var(--text-2)"></div>
      </div>

      <!-- Daily CFO Briefing -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Daily CFO Briefing</div>
            <div style="font-size:11px;color:var(--text-2);margin-top:2px">AI-powered daily summary: pending tasks, AR, cash position & tips</div>
          </div>
        </div>
        <div style="margin:12px 0;background:var(--bg);border-radius:8px;padding:12px 14px">
          <div style="font-size:11px;color:var(--text-2);margin-bottom:8px;font-weight:600">Email includes:</div>
          ${['Pending CEO & CPO tasks with deadlines','AR overdue breakdown by client','Current cash position by account','Budget vs. actual variance','Ayla\'s strategic daily tip'].map(i=>`<div style="font-size:11px;color:var(--text-2);padding:2px 0">✓ ${i}</div>`).join('')}
        </div>
        <div style="background:var(--surface-2);border-radius:8px;padding:10px 14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <label style="font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Recipients</label>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="saveReportTypeRecipients('dailyBriefing')">Save</button>
          </div>
          <input type="text" id="recip-dailyBriefing" class="input" style="font-size:11px" placeholder="e.g. ceo@company.com, cfo@company.com" value="${(cfg.dailyBriefingRecipients||[]).join(', ')}">
          <div id="recip-status-dailyBriefing" style="font-size:10px;color:var(--success);margin-top:4px;min-height:14px"></div>
        </div>
        <div style="background:var(--surface-2);border-radius:8px;padding:12px 14px;margin-bottom:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:10px">Recurring Schedule</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">
            <div>
              <label style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px">Frequency</label>
              <select id="sched-dailyBriefing" style="width:100%;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface)">
                <option value="manual"${!cfg.dailyBriefingSchedule||cfg.dailyBriefingSchedule==='manual'?' selected':''}>Manual only</option>
                <option value="daily"${cfg.dailyBriefingSchedule==='daily'?' selected':''}>Daily — 7 AM Dubai</option>
                <option value="weekly"${cfg.dailyBriefingSchedule==='weekly'?' selected':''}>Weekly — 7 AM Dubai</option>
              </select>
            </div>
            <div>
              <button class="btn btn-primary btn-sm" style="width:100%" onclick="savePipelineEmailSchedule('dailyBriefing')">Save Schedule</button>
              ${cfg.dailyBriefingSchedule&&cfg.dailyBriefingSchedule!=='manual'?`<div style="font-size:10px;color:var(--success);margin-top:4px">● Active — ${cfg.dailyBriefingSchedule}</div>`:''}
            </div>
          </div>
          ${cfg.dailyBriefingNextSend?`<div style="font-size:10px;color:var(--text-2);margin-top:8px">Next send: <strong>${cfg.dailyBriefingNextSend}</strong></div>`:''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="sendDailyBriefing()">📧 Send Now</button>
          <button class="btn btn-sm" onclick="previewEmail('/reports/daily-briefing-preview')">👁 Preview Email</button>
        </div>
        <div id="daily-briefing-status" style="margin-top:8px;font-size:11px;color:var(--text-2)"></div>
      </div>

    </div>

    <!-- Project Reports Recipients card -->
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">📁 Project Reports</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:2px">Recipients for all project report emails (sent from the Projects section)</div>
        </div>
      </div>
      <div style="background:var(--surface-2);border-radius:8px;padding:12px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <label style="font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Recipients</label>
          <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="saveReportTypeRecipients('projectReport')">Save</button>
        </div>
        <input type="text" id="recip-projectReport" class="input" style="font-size:11px" placeholder="e.g. ceo@company.com, cfo@company.com, manager@company.com" value="${(cfg.projectReportRecipients||[]).join(', ')}">
        <div id="recip-status-projectReport" style="font-size:10px;color:var(--success);margin-top:4px;min-height:14px"></div>
      </div>
    </div>

    <!-- Email Templates Preview -->
    <div class="card">
      <div class="card-header" style="margin-bottom:14px">
        <div>
          <div class="card-title">📧 Email Templates</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:2px">Preview every email template the system can send — opens a live preview in a new tab</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
        ${[
          { icon:'📊', color:'#FF6600', name:'Financial Summary', desc:'Cash, AR, liabilities, ratios & Ayla insights', endpoint:'/reports/preview' },
          { icon:'📋', color:'#7C3AED', name:'Task Reminder', desc:'Pending CEO/CPO tasks with deadlines', endpoint:'/reports/task-reminder-preview' },
          { icon:'📬', color:'#2563EB', name:'Daily CFO Briefing', desc:'AI-powered morning brief: tasks, AR, cash', endpoint:'/reports/daily-briefing-preview' },
          { icon:'📈', color:'#16A34A', name:'Pipeline Digest', desc:'Deal stage summary for sales team', endpoint:'/reports/pipeline-preview' },
          { icon:'🚨', color:'#D97706', name:'Stale Deal Alert', desc:'Deals with no activity past SLA threshold', endpoint:'/reports/stale-alert-preview' },
          { icon:'🔔', color:'#0891B2', name:'Subscription Reminder', desc:'Renewal coming soon — sent to subscribers', endpoint:'/subscriptions/preview/reminder' },
          { icon:'🎉', color:'#16A34A', name:'Subscription Won', desc:'New subscription confirmed — welcome email', endpoint:'/subscriptions/preview/won' },
          { icon:'💔', color:'#DC2626', name:'Subscription Lost', desc:'Churn/cancellation notification', endpoint:'/subscriptions/preview/lost' },
        ].map(t => `
          <div style="border:1px solid var(--border);border-radius:10px;padding:14px;background:var(--surface);display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:36px;height:36px;border-radius:9px;background:${t.color}22;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${t.icon}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:700;color:var(--text)">${t.name}</div>
              </div>
            </div>
            <div style="font-size:11px;color:var(--text-2);line-height:1.4;flex:1">${t.desc}</div>
            <button class="btn btn-sm" style="width:100%;font-size:11px;justify-content:center" onclick="previewEmail('${t.endpoint}')">👁 Preview</button>
          </div>`).join('')}
      </div>
    </div>

    <!-- Email config info card -->
    <div class="card" style="background:linear-gradient(135deg,#FFF7F5,#fff);border:1px solid #FFD4C0">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:#FF6600;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📬</div>
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--text)">Email Setup Required</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:2px">To send emails, configure SMTP credentials in <code style="background:var(--bg);padding:1px 5px;border-radius:4px">.env</code>. Go to <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="showSection('settings')">Settings → Integrations</button> for step-by-step setup.</div>
        </div>
      </div>
    </div>
  </div>`;

  setTimeout(() => {
    const revMonths = MO.slice(0, new Date().getMonth() + 1);
    const revData = revMonths.map(m => pnlRows.find(r=>r.id==='revenue')?.months?.[m] || 0);
    mkChart('investor-rev-chart', 'bar', {
      labels: revMonths,
      datasets: [{ data: revData, backgroundColor: 'rgba(255,102,0,0.7)', borderColor: '#FF6600', borderWidth: 1, borderRadius: 4 }]
    }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$'+(v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'K':v) } } } });
  }, 50);
}

async function sendSalespersonDigest(owner) {
  const key = owner.replace(/\s+/g, '_');
  const email = document.getElementById(`digest-email-${key}`)?.value.trim();
  const statusEl = document.getElementById(`digest-status-${key}`);
  if (!email) { if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">Enter email first</span>'; return; }
  if (statusEl) statusEl.textContent = 'Sending…';
  try {
    const r = await apiCall('/reports/send-salesperson-digest', { method: 'POST', body: JSON.stringify({ owner, email }) });
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ Sent</span>`;
    toast(r.message || 'Digest sent');
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`;
    toast('Error: ' + e.message);
  }
}

async function saveSalespersonDigestEmail(owner) {
  const key       = owner.replace(/\s+/g, '_');
  const email     = document.getElementById(`digest-email-${key}`)?.value.trim();
  const frequency = document.getElementById(`digest-freq-${key}`)?.value  || 'weekly';
  const startDate = document.getElementById(`digest-start-${key}`)?.value || '';
  const digests   = [...(state.appSettings.salespersonDigests || []).filter(x => x.owner !== owner)];
  digests.push({ owner, email: email||'', frequency, startDate });
  // Also update repEmails in commSettings
  if (email) {
    const cur = state.commSettings || {};
    const repEmails = { ...(cur.repEmails||{}), [owner]: email };
    await apiCall('/commissions/settings', { method:'PUT', body:JSON.stringify({...cur, repEmails}) }).catch(()=>{});
    state.commSettings = { ...cur, repEmails };
  }
  try {
    await apiCall('/app-settings', { method: 'PUT', body: JSON.stringify({ salespersonDigests: digests }) });
    state.appSettings = { ...state.appSettings, salespersonDigests: digests };
    toast('Saved for ' + owner);
  } catch(e) { toast('Error: ' + e.message); }
}

async function saveBulkDigestSettings() {
  const frequency = document.getElementById('digest-bulk-freq')?.value || 'weekly';
  const startDate = document.getElementById('digest-bulk-start')?.value || '';
  const statusEl  = document.getElementById('digest-bulk-status');
  try {
    await apiCall('/app-settings', { method: 'PUT', body: JSON.stringify({ digestBulkFrequency: frequency, digestBulkStartDate: startDate }) });
    state.appSettings = { ...state.appSettings, digestBulkFrequency: frequency, digestBulkStartDate: startDate };
    if (statusEl) statusEl.textContent = '✓ Schedule saved';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
  } catch(e) { toast('Error: ' + e.message); }
}

async function sendAllDigests() {
  const digests  = state.appSettings?.salespersonDigests || [];
  const withEmail = digests.filter(d => d.email);
  if (!withEmail.length) { toast('No rep emails configured', 'error'); return; }
  toast(`Sending to ${withEmail.length} rep${withEmail.length > 1 ? 's' : ''}…`);
  let sent = 0, failed = 0;
  for (const d of withEmail) {
    try {
      await apiCall('/reports/send-salesperson-digest', { method: 'POST', body: JSON.stringify({ owner: d.owner, email: d.email }) });
      const statusEl = document.getElementById('digest-status-' + d.owner.replace(/\s+/g, '_'));
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--success)">✓</span>';
      sent++;
    } catch(e) {
      const statusEl = document.getElementById('digest-status-' + d.owner.replace(/\s+/g, '_'));
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">✗</span>';
      failed++;
    }
  }
  toast(`Sent ${sent}${failed ? `, ${failed} failed` : ''}`);
}

async function saveReportTypeRecipients(type) {
  const input = document.getElementById(`recip-${type}`);
  const statusEl = document.getElementById(`recip-status-${type}`);
  if (!input) return;
  const raw = input.value.trim();
  const emails = raw ? raw.split(',').map(e => e.trim()).filter(Boolean) : [];
  const key = type + 'Recipients'; // e.g. financialReportRecipients, ceoReminderRecipients
  try {
    await apiCall('/app-settings', { method: 'PUT', body: JSON.stringify({ [key]: emails }) });
    state.appSettings = { ...state.appSettings, [key]: emails };
    if (statusEl) { statusEl.textContent = emails.length ? `✓ Saved (${emails.length} recipient${emails.length>1?'s':''})` : '✓ Using global list'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500); }
  } catch(e) { toast('Error: ' + e.message); }
}

async function saveReportRecipients() {
  const ceoEmail = document.getElementById('cfg-ceo-email')?.value.trim() || '';
  const cpoEmail = document.getElementById('cfg-cpo-email')?.value.trim() || '';
  const extraRaw = document.getElementById('cfg-extra-emails')?.value || '';
  const reportRecipients = extraRaw.split(',').map(e=>e.trim()).filter(Boolean);
  const payload = { ceoEmail, cpoEmail, reportRecipients };
  const statusEl = document.getElementById('cfg-save-status');
  try {
    await apiCall('/app-settings', {method:'PUT', body:JSON.stringify(payload)});
    Object.assign(state.appSettings, payload);
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ Saved</span>`;
    toast('Recipients saved');
    setTimeout(()=>{ render(); }, 800);
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: ' + e.message);
  }
}

async function saveReportSchedule() {
  const schedule = document.getElementById('rep-schedule')?.value || 'manual';
  const stopDate = document.getElementById('rep-stop')?.value || '';
  let nextSend = '';
  if (schedule !== 'manual') {
    const d = new Date();
    if (schedule==='daily') d.setDate(d.getDate()+1);
    else if (schedule==='weekly') d.setDate(d.getDate()+7);
    else if (schedule==='monthly') d.setMonth(d.getMonth()+1);
    const pad = n => String(n).padStart(2,'0');
    nextSend = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  try {
    await apiCall('/app-settings',{method:'PUT',body:JSON.stringify({reportSchedule:schedule,reportStopDate:stopDate,reportNextSend:nextSend})});
    state.appSettings = {...state.appSettings, reportSchedule:schedule, reportStopDate:stopDate, reportNextSend:nextSend};
    toast(schedule==='manual' ? 'Schedule disabled' : `Schedule set: ${schedule}${stopDate?' · stops '+stopDate:''}`);
    render();
  } catch(e){toast('Error: '+e.message);}
}
async function savePipelineEmailSchedule(type) {
  const schedule = document.getElementById(`sched-${type}`)?.value || 'manual';
  let nextSend = '';
  if (schedule !== 'manual') {
    const d = new Date();
    if (schedule==='daily') d.setDate(d.getDate()+1);
    else if (schedule==='weekly') d.setDate(d.getDate()+7);
    else if (schedule==='monthly') d.setMonth(d.getMonth()+1);
    const pad = n => String(n).padStart(2,'0');
    nextSend = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  const schedKey = type + 'Schedule';
  const nextKey  = type + 'NextSend';
  try {
    await apiCall('/app-settings', {method:'PUT', body:JSON.stringify({[schedKey]:schedule,[nextKey]:nextSend})});
    state.appSettings = {...state.appSettings, [schedKey]:schedule, [nextKey]:nextSend};
    toast(schedule==='manual' ? 'Schedule disabled' : `Schedule set: ${schedule}${nextSend?' · next: '+nextSend:''}`);
    render();
  } catch(e) { toast('Error: '+e.message); }
}

async function stopReportSchedule() {
  try {
    await apiCall('/app-settings',{method:'PUT',body:JSON.stringify({reportSchedule:'manual',reportStopDate:'',reportNextSend:''})});
    state.appSettings = {...state.appSettings, reportSchedule:'manual', reportStopDate:'', reportNextSend:''};
    toast('Schedule stopped'); render();
  } catch(e){toast('Error: '+e.message);}
}
async function saveEmailTemplates() {
  const subject     = document.getElementById('tpl-subject')?.value.trim() || '';
  const intro       = document.getElementById('tpl-intro')?.value.trim() || '';
  const footer      = document.getElementById('tpl-footer')?.value.trim() || '';
  const brandName   = document.getElementById('tpl-brand-name')?.value.trim() || '';
  const accentColor = document.getElementById('tpl-accent-hex')?.value.trim() || '#FF6600';
  const statusEl = document.getElementById('tpl-save-status');
  try {
    await apiCall('/reports/email-templates', { method: 'PUT', body: JSON.stringify({ subject, intro, footer, brandName, accentColor }) });
    state._emailTemplates = { ...(state._emailTemplates || {}), subject, intro, footer, brandName, accentColor };
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--success)">✓ Saved</span>';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    toast('Email template saved');
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: ' + e.message);
  }
}

function updateTplPreview() {
  const today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const brand = document.getElementById('tpl-brand-name')?.value || 'CFO Genie';
  const accent = document.getElementById('tpl-accent-hex')?.value || '#FF6600';
  const subj = (document.getElementById('tpl-subject')?.value || 'CFO Genie Financial Summary — {{date}}').replace('{{date}}', today).replace('{{brand}}', brand);
  const intro = (document.getElementById('tpl-intro')?.value || 'Here is your financial intelligence briefing for the period ending today.').replace('{{date}}', today).replace('{{brand}}', brand);
  const footer = (document.getElementById('tpl-footer')?.value || 'This report was generated by CFO Genie.').replace('{{date}}', today).replace('{{brand}}', brand);
  const hdr = document.getElementById('tpl-preview-header');
  if (hdr) hdr.style.background = accent;
  const brandEl = document.getElementById('tpl-preview-brand');
  if (brandEl) brandEl.textContent = brand;
  const subjEl = document.getElementById('tpl-preview-subj');
  if (subjEl) subjEl.textContent = subj;
  const introEl = document.getElementById('tpl-preview-intro');
  if (introEl) introEl.textContent = intro;
  const footerEl = document.getElementById('tpl-preview-footer');
  if (footerEl) footerEl.textContent = footer;
}

function insertTplToken(token) {
  const active = document.activeElement;
  const targets = ['tpl-subject','tpl-intro','tpl-footer'];
  const target = targets.includes(active?.id) ? active : document.getElementById('tpl-intro');
  if (!target) return;
  const s = target.selectionStart, e = target.selectionEnd;
  target.value = target.value.slice(0,s) + token + target.value.slice(e);
  target.selectionStart = target.selectionEnd = s + token.length;
  target.focus();
  updateTplPreview();
}

async function sendTestEmail() {
  const to = document.getElementById('tpl-test-to')?.value.trim();
  const statusEl = document.getElementById('tpl-test-status');
  if (!to) { if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">Enter a recipient email</span>'; return; }
  if (statusEl) statusEl.textContent = 'Sending…';
  try {
    const r = await apiCall('/reports/send-test-email', { method: 'POST', body: JSON.stringify({ to }) });
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ ${r.message || 'Test email sent to ' + to}</span>`;
    toast(r.message || 'Test email sent');
    apiCall('/reports/email-log').then(log => { state._emailLog = log; render(); }).catch(()=>{});
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: ' + e.message);
  }
}

async function sendFinancialReport() {
  const cfg = state.appSettings || {};
  const toList = [cfg.ceoEmail, cfg.cpoEmail, ...(cfg.reportRecipients||[])].filter(Boolean);
  const to = toList.length ? toList.join(',') : undefined;
  const statusEl = document.getElementById('report-status');
  if (statusEl) statusEl.textContent = 'Sending…';
  try {
    const r = await apiCall('/reports/send-email', {method:'POST', body:JSON.stringify(to?{to}:{})});
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ ${r.message}</span>`;
    toast(r.message || 'Report sent');
    apiCall('/reports/email-log').then(log => { state._emailLog = log; render(); }).catch(()=>{});
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: ' + e.message);
    apiCall('/reports/email-log').then(log => { state._emailLog = log; render(); }).catch(()=>{});
  }
}

async function saveReminderSchedule(role) {
  const schedule = document.getElementById(`rem-sched-${role}`)?.value || 'manual';
  const schedKey = role + 'ReminderSchedule';
  const nextKey  = role + 'ReminderNextSend';
  let nextSend = '';
  if (schedule !== 'manual') {
    const d = new Date();
    if (schedule === 'daily')       d.setDate(d.getDate() + 1);
    else if (schedule === 'weekly') d.setDate(d.getDate() + 7);
    const pad = n => String(n).padStart(2,'0');
    nextSend = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  try {
    await apiCall('/app-settings', { method: 'PUT', body: JSON.stringify({ [schedKey]: schedule, [nextKey]: nextSend }) });
    state.appSettings = { ...state.appSettings, [schedKey]: schedule, [nextKey]: nextSend };
    toast(schedule === 'manual' ? `${role.toUpperCase()} reminder schedule disabled` : `${role.toUpperCase()} reminders scheduled: ${schedule}`);
    render();
  } catch(e) { toast('Error: ' + e.message); }
}

async function sendCeoRemindersNow(role='ceo') {
  const email = role==='cpo' ? state.appSettings?.cpoEmail : state.appSettings?.ceoEmail;
  const statusEl = document.getElementById('reminder-status');
  if (statusEl) statusEl.textContent = `Sending ${role.toUpperCase()} reminders…`;
  try {
    const r = await apiCall('/reports/send-ceo-reminders', {method:'POST', body:JSON.stringify({ceoEmail:email, taskRole:role})});
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ ${r.message}</span>`;
    toast(r.message || 'Reminders sent');
    apiCall('/reports/email-log').then(log => { state._emailLog = log; render(); }).catch(()=>{});
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: ' + e.message);
    apiCall('/reports/email-log').then(log => { state._emailLog = log; render(); }).catch(()=>{});
  }
}

// ── Settings & Users ──────────────────────────────────────────────────────────
async function renderSettings(c) {
  let integrations=[], gcalStatus={};
  try {
    const [ud, intd, gs] = await Promise.all([apiCall('/users'), apiCall('/sync/integration-config'), apiCall('/events/gcal/status').catch(()=>({}))]);
    state.users=ud.users; state.invitations=ud.invitations; integrations=intd; gcalStatus=gs;
  } catch {}
  // Attach live gcal connection state onto integration cards
  integrations = integrations.map(intg => {
    if (intg.id === 'gcal' || intg.id === 'gdrive') {
      return { ...intg, _gcalConnected: gcalStatus.connected, _gcalEmail: gcalStatus.email };
    }
    return intg;
  });
  const isAdmin=state.user?.role==='admin';
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab active" onclick="switchView(this,'set-team')">Team</button>
      <button class="view-tab" onclick="switchView(this,'set-pipeline')">Pipeline</button>
      <button class="view-tab" onclick="switchView(this,'set-integrations')">Integrations</button>
      <button class="view-tab" onclick="switchView(this,'set-thresholds')">Alerts</button>
      <button class="view-tab" onclick="switchView(this,'set-account')">My Account</button>
    </div>

    <!-- Team -->
    <div class="view-panel active" id="set-team">
      <div class="card">
        <div class="card-header"><div class="card-title">Team Members</div>${isAdmin?'<button class="btn btn-primary btn-sm" onclick="openModal(\'modal-invite\')">+ Invite</button>':''}</div>
        ${state.users.map(u=>`
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border)">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--primary-bg);border:1px solid var(--primary);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--primary);flex-shrink:0">${(u.name||u.email||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
            <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500">${u.name||'(no name)'}</div><div style="font-size:10px;color:var(--text-2)">${u.email}</div></div>
            <span class="tag tag-neutral">${u.role}</span>
            ${isAdmin&&u.id!==state.user?.id?`<button class="del-btn" onclick="removeUser(${u.id})">×</button>`:''}
          </div>`).join('')}
        ${state.users.length===0?'<div style="font-size:11px;color:var(--text-3);padding:12px 0;text-align:center">No users yet</div>':''}
        <div style="margin-top:14px"><div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Pending Invitations</div>
        ${state.invitations.filter(i=>!i.usedAt).map(inv=>`
          <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:0.5px solid var(--border);font-size:11px">
            <div style="flex:1">${inv.email} <span class="tag tag-neutral">${inv.role}</span></div>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="copyInviteLink('${inv.token}')">Copy Link</button>
            <button class="del-btn" onclick="cancelInvite(${inv.id})">×</button>
          </div>`).join('')}
        ${state.invitations.filter(i=>!i.usedAt).length===0?'<div style="font-size:11px;color:var(--text-3);padding:8px 0">No pending invitations</div>':''}
        </div>
      </div>
    </div>

    <!-- Pipeline Settings -->
    <div class="view-panel" id="set-pipeline">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Pipeline Notifications</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">Configure deal reminders and stale-deal alerts sent to deal owners</div></div>
          <button class="btn btn-primary btn-sm" onclick="savePipelineSettings()">Save Settings</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
          <div class="form-row"><label style="font-size:11px">Stale deal threshold (days)</label><input type="number" id="cfg-stale-days" class="input" value="${state.appSettings?.pipelineStaleAfterDays||14}" min="1" max="90" style="font-size:12px"></div>
          <div class="form-row"><label style="font-size:11px">Annual Sales Quota ($)</label><input type="number" id="cfg-sales-quota" class="input" value="${state.appSettings?.salesQuota||''}" min="0" placeholder="e.g. 500000" style="font-size:12px"></div>
        </div>
        <div id="pipeline-cfg-status" style="font-size:11px;color:var(--text-2);margin-top:6px"></div>
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:10px">Stale Deals (${(() => { const d=new Date(Date.now()-(state.appSettings?.pipelineStaleAfterDays||14)*24*60*60*1000); return state.pipeline.filter(p=>p.stage!=='Closed Won'&&p.stage!=='Closed Lost'&&(!p.lastUpdated||new Date(p.lastUpdated)<d)).length; })()} deals)</div>
        ${(() => {
          const staleAfter = state.appSettings?.pipelineStaleAfterDays || 14;
          const cutoff = new Date(Date.now()-staleAfter*24*60*60*1000);
          const stale = state.pipeline.filter(p=>p.stage!=='Closed Won'&&p.stage!=='Closed Lost'&&(!p.lastUpdated||new Date(p.lastUpdated)<cutoff));
          if (!stale.length) return '<div style="font-size:11px;color:var(--success);padding:8px 0">✓ No stale deals</div>';
          return stale.map(d=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border)">
            <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600">${d.name}</div><div style="font-size:11px;color:var(--text-2)">${d.stage} · ${d.owner||'unassigned'}</div></div>
            <div style="font-size:11px;color:var(--danger)">Last: ${d.lastUpdated||'never'}</div>
          </div>`).join('');
        })()}
      </div>
    </div>

    <!-- Integrations -->
    <div class="view-panel" id="set-integrations">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:12px;color:var(--text-2)">Connect your financial and productivity tools. Status shows whether each integration is live. Contact your administrator to configure new connections.</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${integrations.map(intg=>{
          const allSet=intg.envVars.filter(v=>!v.set).length===0;
          const pctSet=Math.round((intg.envVars.filter(v=>v.set).length/intg.envVars.length)*100);
          return `<div class="card" style="padding:0;overflow:hidden">
            <div style="display:flex;align-items:center;gap:14px;padding:16px 18px;cursor:pointer" onclick="toggleIntgDetail('${intg.id}')">
              <div style="width:42px;height:42px;border-radius:10px;background:${intg.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff;flex-shrink:0">${intg.abbr}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:700;color:var(--text)">${intg.name}</div>
                <div style="font-size:11px;color:var(--text-2);margin-top:2px">${intg.tagline}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                ${intg.connected
                  ? '<span style="background:#F0FDF4;color:#16A34A;font-size:10px;font-weight:700;padding:3px 10px;border-radius:5px">● CONNECTED</span>'
                  : '<span style="background:#F4F6FA;color:#97A0AF;font-size:10px;font-weight:700;padding:3px 10px;border-radius:5px">○ NOT SET UP</span>'}
                <div style="font-size:9px;color:var(--text-3);margin-top:4px;text-align:right">${pctSet}% configured ▾</div>
              </div>
            </div>
            <div id="intg-detail-${intg.id}" style="display:none;border-top:1px solid var(--border);padding:16px 18px;background:var(--bg)">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div>
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2);margin-bottom:8px">What it syncs</div>
                  ${intg.syncs.map(s=>`<div style="font-size:12px;color:var(--text);padding:3px 0">✓ ${s}</div>`).join('')}
                  ${(intg.id==='gcal'||intg.id==='gdrive') ? `
                <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
                  ${intg._gcalEmail?`<div style="font-size:11px;color:var(--text-2);padding:6px 10px;background:var(--surface);border-radius:6px;border:0.5px solid var(--border)">Connected as <strong style="color:var(--text)">${intg._gcalEmail}</strong></div>`:''}
                  ${intg._gcalConnected
                    ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
                        <a href="/api/events/gcal/auth?switch=1" class="btn btn-sm" style="text-decoration:none;display:inline-block;font-size:11px">⇄ Switch Account</a>
                        <button class="btn btn-sm" style="font-size:11px;color:#ef4444;border-color:rgba(239,68,68,.4)" onclick="disconnectGcal()">✕ Disconnect</button>
                       </div>`
                    : `<a href="/api/events/gcal/auth" class="btn btn-primary btn-sm" style="text-decoration:none;display:inline-block">Connect Google →</a>`
                  }
                </div>` : intg.oauthUrl?`<div style="margin-top:12px"><a href="${intg.oauthUrl}" class="btn btn-primary btn-sm" style="text-decoration:none;display:inline-block">Connect ${intg.name} →</a></div>`:''}
                </div>
                <div>
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2);margin-bottom:8px">Environment Variables</div>
                  ${intg.envVars.map(v=>`
                  <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid var(--border)">
                    <span style="width:10px;height:10px;border-radius:50%;background:${v.set?'#16A34A':'#EF4444'};flex-shrink:0"></span>
                    <div style="flex:1;min-width:0">
                      <code style="font-size:10px;font-weight:600;color:var(--text)">${v.key}</code>
                      <div style="font-size:10px;color:var(--text-3)">${v.hint}</div>
                    </div>
                  </div>`).join('')}
                </div>
              </div>
              <div style="margin-top:14px;background:var(--surface);border-radius:8px;padding:12px 14px">
                <div style="font-size:11px;font-weight:700;color:var(--text-2);margin-bottom:6px">Setup Guide</div>
                ${intg.setupSteps.map(s=>`<div style="font-size:11px;color:var(--text-2);padding:2px 0">${s}</div>`).join('')}
              </div>
              ${intg.id==='smtp'?`
              <div style="margin-top:14px;background:var(--info-bg);border-radius:8px;padding:12px 14px;border:1px solid rgba(37,99,235,.15)">
                <div style="font-size:11px;font-weight:700;color:var(--info-text);margin-bottom:4px">Email (SMTP) Configuration</div>
                <div style="font-size:11px;color:var(--text-2)">Email sending is configured via your server environment. Contact your system administrator to update SMTP credentials. Once configured, use the test buttons below to verify delivery.</div>
              </div>
              <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                <button id="test-smtp-btn" class="btn btn-sm" onclick="testSmtpConnection()">🔌 Test SMTP Connection</button>
                <button class="btn btn-sm btn-primary" onclick="testEmailReport()">📧 Send Test Report</button>
                <button class="btn btn-sm" onclick="triggerCeoReminders()">Send CEO Reminders Now</button>
              </div>
              <div id="smtp-test-result" style="margin-top:8px;font-size:11px"></div>`:''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Alerts & Thresholds (split from Account) -->
    <div class="view-panel" id="set-thresholds">
      <div style="display:flex;flex-direction:column;gap:12px;max-width:500px">
        <div class="card">
          <div class="card-header"><div><div class="card-title">Cash Alert Threshold</div><div class="card-desc">Dashboard alert when available cash drops below this amount</div></div></div>
          <div class="form-row"><label>Minimum Cash Balance ($)</label><input type="number" id="cash-threshold" class="input" value="${state.appSettings?.cashAlertThreshold||0}" placeholder="e.g. 100000" min="0"></div>
          <button class="btn btn-primary btn-sm" onclick="saveCashThreshold()">Save Threshold</button>
        </div>
        <div class="card">
          <div class="card-header"><div><div class="card-title">SaaS Revenue Target</div><div class="card-desc">Alert when SaaS% of total revenue falls below this target (0 = disabled)</div></div></div>
          <div class="form-row"><label>Target SaaS% of Revenue</label><input type="number" id="saas-target" class="input" value="${state.appSettings?.saasRatioTarget||0}" placeholder="e.g. 20" min="0" max="100"></div>
          <button class="btn btn-primary btn-sm" onclick="saveSaasTarget()">Save Target</button>
        </div>
      </div>
    </div>

    <!-- My Account -->
    <div class="view-panel" id="set-account">
      <div style="display:flex;flex-direction:column;gap:12px;max-width:500px">
        <div class="card">
          <div class="card-header"><div class="card-title">My Profile</div></div>
          <div style="font-size:12px;color:var(--text-2);margin-bottom:14px">Signed in as <strong style="color:var(--text)">${state.user?.email}</strong></div>
          <div class="form-row"><label>Display Name</label><input type="text" id="profile-name" class="input" value="${(state.user?.name||'').replace(/"/g,'&quot;')}" placeholder="Your full name"></div>
          <div class="form-row"><label>Title / Position</label><input type="text" id="profile-title" class="input" value="${(state.user?.title||'').replace(/"/g,'&quot;')}" placeholder="e.g. Chief Financial Officer"></div>
          <div id="profile-status" style="font-size:11px;margin-bottom:10px"></div>
          <button class="btn btn-primary btn-sm" onclick="saveProfile()">Save Profile</button>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Change Password</div></div>
          <div class="form-row"><label>Current Password</label><input type="password" id="cur-pass" placeholder="Current password"></div>
          <div class="form-row"><label>New Password</label><input type="password" id="new-pass" placeholder="New password (min 8 chars)"></div>
          <button class="btn btn-primary btn-sm" onclick="changePassword()">Update Password</button>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Session</div></div>
          <div style="font-size:12px;color:var(--text-2);margin-bottom:12px">Signing out will clear your session on this device.</div>
          <button class="btn btn-danger btn-sm" onclick="logout()">Sign Out</button>
        </div>
      </div>
    </div>
  </div>`;
}

async function saveCashThreshold() {
  const val = Number(document.getElementById('cash-threshold')?.value)||0;
  try {
    await apiCall('/app-settings',{method:'PUT',body:JSON.stringify({cashAlertThreshold:val})});
    state.appSettings.cashAlertThreshold = val;
    toast(val > 0 ? `Cash alert set: below ${fmt(val)}` : 'Cash alert disabled');
  } catch(e){toast('Error: '+e.message);}
}
async function saveSaasTarget() {
  const val = Math.min(100, Math.max(0, Number(document.getElementById('saas-target')?.value)||0));
  try {
    await apiCall('/app-settings',{method:'PUT',body:JSON.stringify({saasRatioTarget:val})});
    if(!state.appSettings) state.appSettings={};
    state.appSettings.saasRatioTarget = val;
    toast(val > 0 ? `SaaS target set: ${val}%` : 'SaaS target disabled');
  } catch(e){toast('Error: '+e.message);}
}

async function savePipelineSettings() {
  const staleDays = parseInt(document.getElementById('cfg-stale-days')?.value)||14;
  const quota = parseFloat(document.getElementById('cfg-sales-quota')?.value)||0;
  const statusEl = document.getElementById('pipeline-cfg-status');
  try {
    await apiCall('/app-settings',{method:'PUT',body:JSON.stringify({pipelineStaleAfterDays:staleDays,salesQuota:quota})});
    state.appSettings.pipelineStaleAfterDays = staleDays;
    state.appSettings.salesQuota = quota;
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--success)">✓ Saved</span>';
    toast('Pipeline settings saved');
  } catch(e) { if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`; }
}

async function sendPipelineDigest() {
  const statusEl = document.getElementById('pipeline-email-status');
  if (statusEl) statusEl.textContent = 'Sending…';
  try {
    const r = await apiCall('/reports/send-pipeline-digest',{method:'POST'});
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ ${r.message}</span>`;
    toast(r.message || 'Digest sent');
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: '+e.message);
  }
}

async function sendStaleAlerts() {
  const statusEl = document.getElementById('pipeline-email-status');
  if (statusEl) statusEl.textContent = 'Sending…';
  try {
    const r = await apiCall('/reports/send-stale-alerts',{method:'POST'});
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ ${r.message}</span>`;
    toast(r.message || 'Alerts sent');
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: '+e.message);
  }
}

async function runDataValidation() {
  const btn = document.getElementById('val-run-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
  try {
    [state._validation, state._emailLog, state._validationHistory] = await Promise.all([
      apiCall('/reports/validate'),
      apiCall('/reports/email-log').catch(()=>[]),
      apiCall('/reports/validate/history').catch(()=>[])
    ]);
    render();
  } catch(e) {
    toast('Validation error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Run Health Check'; }
  }
}

async function loadEmailLog() {
  try {
    state._emailLog = await apiCall('/reports/email-log');
    render();
  } catch(e) { toast('Could not load email log'); }
}

async function backfillLinks() {
  try {
    const r = await apiCall('/linked/backfill', { method: 'POST' });
    if (!r) return;
    toast(`🔗 Backfill done — AR: ${r.updated.ar}, Pipeline: ${r.updated.pipeline}, Commissions: ${r.updated.commissions} records updated`);
    await loadAll();
    render();
  } catch(e) {
    toast('Backfill error: ' + e.message);
  }
}

// ── PDF Export ────────────────────────────────────────────────────────────────
function generateAylaNarrative() {
  const totalCash = state.banks.reduce((a,b)=>a+b.total,0);
  const reserved  = state.reserves.reduce((a,r)=>a+r.amount,0);
  const available = totalCash - reserved;
  const ytdRev    = state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.revenue,0);
  const ytdTgt    = state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.target,0);
  const ytdExp    = state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.expenses,0);
  const margin    = ytdRev ? Math.round(((ytdRev-ytdExp)/ytdRev)*100) : 0;
  const totalAR   = state.ar.filter(x=>x.status!=='paid').reduce((s,x)=>s+x.amount,0);
  const todayStr  = TODAY.toISOString().split('T')[0];
  const overdueAR = state.ar.filter(x=>x.status==='overdue'||(x.status==='pending'&&x.dueDate&&x.dueDate<todayStr)).reduce((s,x)=>s+x.amount,0);
  const totalLiab = state.liabilities.reduce((s,c)=>s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0),0);
  const pipeWtd   = state.pipeline.reduce((a,d)=>a+d.value*(d.probability/100),0);
  const attPct    = ytdTgt ? Math.round(ytdRev/ytdTgt*100) : 0;
  const fmtV      = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v||0);

  const cashLbl  = available > totalLiab ? 'strong' : available > totalLiab*0.5 ? 'adequate' : 'constrained';
  const revLbl   = attPct >= 90 ? 'on track' : attPct >= 70 ? 'slightly behind' : 'behind target';
  const arLbl    = overdueAR > totalAR*0.3 ? 'requiring urgent attention' : overdueAR > 0 ? 'manageable with active follow-up' : 'in good standing';
  const expiring = state.clients.filter(c=>c.renewal&&Math.ceil((new Date(c.renewal)-TODAY)/864e5)<60);
  const wonDeals = state.pipeline.filter(d=>d.stage==='Closed Won').length;

  const highlights = [];
  if (available > 0) highlights.push(`Available cash: ${fmtV(available)} across ${state.banks.length} account${state.banks.length!==1?'s':''}`);
  if (attPct >= 75) highlights.push(`Revenue attainment: ${attPct}% of annual target (${fmtV(ytdRev)})`);
  if (margin >= 15) highlights.push(`Net margin: ${margin}% — within healthy range`);
  if (pipeWtd > 0) highlights.push(`Weighted pipeline: ${fmtV(pipeWtd)} in qualified forecast`);
  if (wonDeals > 0) highlights.push(`${wonDeals} deal${wonDeals!==1?'s':''} closed won this period`);

  const risks = [];
  if (overdueAR > 0)       risks.push(`${fmtV(overdueAR)} overdue AR — collection action required`);
  if (margin < 15)         risks.push(`Profit margin ${margin}% below 20% target`);
  if (totalLiab > available) risks.push(`Liabilities (${fmtV(totalLiab)}) exceed available cash`);
  if (expiring.length > 0) risks.push(`${expiring.length} contract${expiring.length>1?'s':''} expiring within 60 days`);

  const actions = [];
  if (overdueAR > 10000)   actions.push(`Escalate AR collection for ${fmtV(overdueAR)} overdue balance`);
  if (margin < 20)         actions.push(`Target 5–10% OpEx reduction to restore margin above 20%`);
  const proposals = state.pipeline.filter(d=>d.stage==='Proposal'||d.stage==='Negotiation');
  if (proposals.length > 0) actions.push(`Advance ${proposals.length} proposal${proposals.length>1?'s':''} in pipeline to close`);
  if (expiring.length > 0) actions.push(`Begin renewal negotiations: ${expiring.map(c=>c.name).join(', ')}`);

  const dateLabel = TODAY.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const narrative = `As of ${dateLabel}, the company maintains a ${cashLbl} liquidity position with ${fmtV(available)} in available cash against total liabilities of ${fmtV(totalLiab)}. Revenue stands at ${fmtV(ytdRev)} YTD — ${revLbl} at ${attPct}% of the annual target — with a ${margin}% net margin. Accounts receivable (${fmtV(totalAR)} outstanding) are ${arLbl}${overdueAR>0?`, with ${fmtV(overdueAR)} past due`:''}. The weighted pipeline forecast of ${fmtV(pipeWtd)} supports a constructive outlook for the remainder of the fiscal year.`;

  return { narrative, highlights: highlights.slice(0,4), risks: risks.slice(0,4), actions: actions.slice(0,3), margin, attPct };
}

function downloadFinancialPDF() {
  if (typeof window.jspdf === 'undefined') { toast('PDF library not loaded — check internet connection'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const fmtV = v => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(v||0);
  const W = 210, ML = 14, MR = 196;

  // ── Header ──────────────────────────────────────────────────────────────────
  doc.setFillColor(255, 102, 0);
  doc.rect(0, 0, W, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('CFO Genie — Financial Report', ML, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(today, ML, 16);
  doc.text('Aladdin Finance', MR, 16, { align: 'right' });

  let y = 30;

  const sectionHeader = (title) => {
    doc.setFillColor(244, 246, 250);
    doc.rect(ML, y-4, MR-ML, 8, 'F');
    doc.setTextColor(37, 37, 37);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(title, ML+2, y+1);
    y += 8;
  };

  // ── Ayla Executive Summary ───────────────────────────────────────────────────
  const aylaStory = generateAylaNarrative();
  doc.setFillColor(255, 247, 245);
  doc.rect(ML, y-3, MR-ML, 3, 'F');
  doc.setFillColor(255, 102, 0);
  doc.rect(ML, y-3, 2, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 102, 0);
  doc.text('✦ AYLA AI — EXECUTIVE SUMMARY', ML+4, y);
  y += 5;
  doc.setFillColor(255, 247, 245);
  const narLines = doc.splitTextToSize(aylaStory.narrative, MR-ML-6);
  const narH = narLines.length * 4.5 + 6;
  doc.rect(ML, y-2, MR-ML, narH, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60, 60, 70);
  doc.text(narLines, ML+3, y+2);
  y += narH + 2;

  // Highlights & risks two-column
  const colW = (MR-ML-4)/2;
  const colL = ML, colR = ML+colW+4;
  const colStartY = y;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(22, 163, 74);
  doc.text('KEY HIGHLIGHTS', colL, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(220, 38, 38);
  doc.text('RISK FACTORS', colR, y);
  y += 4;
  const maxItems = Math.max(aylaStory.highlights.length, aylaStory.risks.length);
  for (let i = 0; i < maxItems; i++) {
    if (aylaStory.highlights[i]) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(36, 41, 46);
      const hl = doc.splitTextToSize('• '+aylaStory.highlights[i], colW-2);
      doc.text(hl, colL, y);
    }
    if (aylaStory.risks[i]) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(180, 30, 30);
      const rl = doc.splitTextToSize('• '+aylaStory.risks[i], colW-2);
      doc.text(rl, colR, y);
    }
    y += 5.5;
  }
  if (aylaStory.actions.length) {
    y += 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(37, 99, 235);
    doc.text('RECOMMENDED ACTIONS', ML, y); y += 4;
    aylaStory.actions.forEach(a => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(36, 41, 46);
      const al = doc.splitTextToSize(`${aylaStory.actions.indexOf(a)+1}. ${a}`, MR-ML-4);
      doc.text(al, ML+2, y); y += al.length*4.5;
    });
  }
  y += 4;
  doc.setDrawColor(230, 230, 235); doc.line(ML, y, MR, y); y += 6;

  const kv = (label, value, color) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(94, 108, 132);
    doc.text(label, ML+2, y);
    doc.setFont('helvetica', 'bold');
    if (color) doc.setTextColor(...color); else doc.setTextColor(36, 41, 46);
    doc.text(value, MR, y, { align: 'right' });
    doc.setTextColor(36, 41, 46);
    y += 6;
  };

  // ── Cash Position ───────────────────────────────────────────────────────────
  const totalCash = state.banks.reduce((a,b) => a+b.total, 0);
  const reserved  = state.reserves.reduce((a,r) => a+r.amount, 0);
  const available = totalCash - reserved;
  sectionHeader('Cash Position');
  state.banks.forEach(b => kv(b.name, fmtV(b.total)));
  kv('Reserved', fmtV(reserved), [220, 38, 38]);
  kv('Available Cash', fmtV(available), [22, 163, 74]);
  y += 3;

  // ── AR Summary ──────────────────────────────────────────────────────────────
  const arPending = state.ar.filter(x => x.status !== 'paid');
  const arOverdue = state.ar.filter(x => x.status === 'overdue');
  const arTotal   = arPending.reduce((a,x) => a+x.amount, 0);
  const arOvTotal = arOverdue.reduce((a,x) => a+x.amount, 0);
  sectionHeader('Accounts Receivable');
  kv('Total Outstanding', fmtV(arTotal));
  kv('Overdue', fmtV(arOvTotal), arOvTotal > 0 ? [220, 38, 38] : null);
  kv('Invoice Count (open)', String(arPending.length));
  y += 3;

  // ── Revenue YTD ─────────────────────────────────────────────────────────────
  const ytdRev = state.revenue.reduce((a,r) => a+r.revenue, 0);
  const ytdTgt = state.revenue.reduce((a,r) => a+r.target, 0);
  const ytdExp = state.revenue.reduce((a,r) => a+r.expenses, 0);
  const attPct = ytdTgt ? Math.round(ytdRev/ytdTgt*100) : 0;
  sectionHeader('Revenue YTD');
  kv('Total Revenue', fmtV(ytdRev), [22, 163, 74]);
  kv('Budget Target', fmtV(ytdTgt));
  kv('Attainment', attPct+'%', attPct >= 90 ? [22, 163, 74] : attPct >= 70 ? [217, 119, 6] : [220, 38, 38]);
  kv('Total Expenses', fmtV(ytdExp), [220, 38, 38]);
  kv('Net Margin', fmtV(ytdRev - ytdExp));
  y += 3;

  // ── Pipeline ─────────────────────────────────────────────────────────────────
  const pipeWtd = state.pipeline.reduce((a,d) => a+d.value*(d.probability/100), 0);
  const pipeWon = state.pipeline.filter(d=>d.stage==='Closed Won').reduce((a,d)=>a+d.value,0);
  sectionHeader('Pipeline');
  kv('Weighted Forecast', fmtV(pipeWtd), [37, 99, 235]);
  kv('Closed Won', fmtV(pipeWon), [22, 163, 74]);
  kv('Open Deals', String(state.pipeline.filter(d=>d.stage!=='Closed Won'&&d.stage!=='Closed Lost').length));
  y += 3;

  // ── Liabilities ──────────────────────────────────────────────────────────────
  const totalLiab = state.liabilities.reduce((s,c) => s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0), 0);
  sectionHeader('Liabilities');
  state.liabilities.forEach(c => {
    const t = (c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0);
    if (t > 0) kv(c.name, fmtV(t));
  });
  kv('Total Liabilities', fmtV(totalLiab), [220, 38, 38]);
  y += 3;

  // ── AR Invoices Table (open) ─────────────────────────────────────────────────
  if (y > 240) { doc.addPage(); y = 20; }
  sectionHeader('Open AR Invoices');
  y += 2;
  const arRows = arPending.slice(0,20).map(x => [x.client, x.invoice||'—', x.dueDate||'—', fmtV(x.amount), x.status]);
  doc.autoTable({
    startY: y,
    head: [['Client','Invoice #','Due Date','Amount','Status']],
    body: arRows,
    theme: 'striped',
    headStyles: { fillColor: [255,102,0], textColor:[255,255,255], fontStyle:'bold', fontSize:8 },
    bodyStyles: { fontSize: 8, textColor: [36,41,46] },
    columnStyles: { 3: { halign:'right' } },
    margin: { left: ML, right: 14 },
    styles: { cellPadding: 3 },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ── Pipeline Deals Table ──────────────────────────────────────────────────────
  if (y > 240) { doc.addPage(); y = 20; }
  sectionHeader('Pipeline Deals');
  y += 2;
  const openDeals = state.pipeline.filter(d => d.stage !== 'Closed Lost').slice(0,15)
    .map(d => [d.name, d.client||'—', d.stage, fmtV(d.value), d.probability+'%', fmtV(d.value*d.probability/100)]);
  doc.autoTable({
    startY: y,
    head: [['Deal','Client','Stage','Value','Prob','Weighted']],
    body: openDeals,
    theme: 'striped',
    headStyles: { fillColor: [37,99,235], textColor:[255,255,255], fontStyle:'bold', fontSize:8 },
    bodyStyles: { fontSize: 8, textColor: [36,41,46] },
    columnStyles: { 3:{ halign:'right' }, 5:{ halign:'right' } },
    margin: { left: ML, right: 14 },
    styles: { cellPadding: 3 },
  });

  // ── Footer ────────────────────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(151, 160, 175);
    doc.text(`CFO Genie · Confidential · Page ${i} of ${pageCount}`, W/2, 290, { align:'center' });
  }

  doc.save(`CFO-Report-${new Date().toISOString().split('T')[0]}.pdf`);
  toast('PDF downloaded');
}

function downloadInvestorPDF() {
  if (typeof window.jspdf === 'undefined') { toast('PDF library not loaded'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const period = new Date().toLocaleDateString('en-US', { month:'long', year:'numeric' });
  const fmtV = v => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(v||0);
  const W = 210, ML = 14, MR = 196;
  let y = 0;

  // Header
  doc.setFillColor(255, 102, 0);
  doc.rect(0, 0, W, 28, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(255,255,255);
  doc.text('INVESTOR REPORT', ML, 11);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`${period}  ·  Confidential`, ML, 19);
  doc.text(today, MR, 19, { align:'right' });
  y = 36;

  // KPI grid
  const pnlRows = state.statements?.pnl?.rows || [];
  const ytdMo = MO.filter((_, i) => i <= new Date().getMonth());
  const rT = r => ytdMo.reduce((a, m) => a + (r?.months?.[m] || 0), 0);
  const revRow = pnlRows.find(r => r.id === 'revenue');
  const cogsRow = pnlRows.find(r => r.id === 'cogs');
  const opexRows = pnlRows.filter(r => r.type === 'opex');
  const ytdRev = rT(revRow), ytdCogs = rT(cogsRow);
  const ytdOpex = opexRows.reduce((a, r) => a + rT(r), 0);
  const ytdGross = ytdRev - ytdCogs;
  const ytdEbitda = ytdGross - ytdOpex;
  const totalCash = state.banks.reduce((a, b) => a + b.total, 0);
  const reserved = state.reserves.reduce((a, r) => a + r.amount, 0);
  const available = totalCash - reserved;
  const lastMoBurn = opexRows.reduce((a, r) => a + (r.months?.[MO[new Date().getMonth() - 1]] || 0), 0);
  const runway = lastMoBurn ? Math.round(available / lastMoBurn) : 0;
  const wtdPipe = state.pipeline.reduce((a, d) => a + d.value * (d.probability / 100), 0);
  const totalAR = state.ar.filter(x => x.status !== 'paid').reduce((s, x) => s + x.amount, 0);
  const overdueAR = state.ar.filter(x => x.status === 'overdue').reduce((s, x) => s + x.amount, 0);
  const grossPct = ytdRev ? Math.round((ytdGross / ytdRev) * 100) : 0;
  const ebitdaPct = ytdRev ? Math.round((ytdEbitda / ytdRev) * 100) : 0;

  const kpis = [
    ['Revenue YTD', fmtV(ytdRev)], ['Gross Profit', `${fmtV(ytdGross)} (${grossPct}%)`],
    ['EBITDA', `${fmtV(ytdEbitda)} (${ebitdaPct}%)`], ['Cash Available', fmtV(available)],
    ['Runway', runway ? runway + ' months' : '—'], ['Pipeline (Wtd)', fmtV(wtdPipe)],
    ['Outstanding AR', fmtV(totalAR)], ['Overdue AR', fmtV(overdueAR)],
  ];
  doc.setFillColor(244,246,250); doc.rect(ML, y-4, MR-ML, 8, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(36,41,46);
  doc.text('KEY PERFORMANCE INDICATORS', ML+2, y+1); y += 10;
  doc.autoTable({
    startY: y,
    body: kpis.map(([k,v]) => [k, v]),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle:'bold', cellWidth: 70 }, 1: { halign:'right' } },
    alternateRowStyles: { fillColor: [250,251,253] },
    margin: { left: ML, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 8;

  // Revenue month table
  doc.setFillColor(244,246,250); doc.rect(ML, y-4, MR-ML, 8, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(36,41,46);
  doc.text('MONTHLY REVENUE', ML+2, y+1); y += 10;
  doc.autoTable({
    startY: y,
    head: [ytdMo],
    body: [ytdMo.map(m => fmtV(revRow?.months?.[m] || 0))],
    theme: 'grid', styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [255,102,0], textColor: 255, fontStyle:'bold', fontSize:8 },
    columnStyles: Object.fromEntries(ytdMo.map((_,i) => [i, { halign:'right' }])),
    margin: { left: ML, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 8;

  // Pipeline top deals
  if (y < 250) {
    const openDeals = state.pipeline.filter(d => d.stage !== 'Closed Lost').sort((a,b)=>b.value-a.value).slice(0,8);
    if (openDeals.length) {
      doc.setFillColor(244,246,250); doc.rect(ML, y-4, MR-ML, 8, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(36,41,46);
      doc.text('PIPELINE — TOP DEALS', ML+2, y+1); y += 10;
      doc.autoTable({
        startY: y,
        head: [['Deal', 'Client', 'Value', 'Probability', 'Stage']],
        body: openDeals.map(d => [d.name, d.client||'—', fmtV(d.value), d.probability+'%', d.stage]),
        theme: 'grid', styles: { fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: [255,102,0], textColor: 255, fontStyle:'bold', fontSize:8 },
        columnStyles: { 2:{halign:'right'}, 3:{halign:'center'} },
        margin: { left: ML, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 8;
    }
  }

  // Footer
  doc.setFontSize(7); doc.setTextColor(150,150,150);
  doc.text('Confidential — Aladdin Finance CFO Command Center', ML, 290);
  doc.text(today, MR, 290, { align:'right' });

  doc.save(`investor-report-${new Date().toISOString().slice(0,7)}.pdf`);
  toast('Investor Report downloaded');
}

function downloadStatementPDF(type) {
  if (typeof window.jspdf === 'undefined') { toast('PDF library not loaded'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const fmtV = v => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(v||0);
  const W = 210, ML = 14, MR = 196;

  const title = type === 'pnl' ? 'Profit & Loss Statement' : 'Balance Sheet';
  doc.setFillColor(255, 102, 0);
  doc.rect(0, 0, W, 22, 'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text(`CFO Genie — ${title}`, ML, 10);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text(today, ML, 16);

  let y = 30;

  if (type === 'pnl') {
    const pnl = state.statements?.pnl || {};
    const rows = pnl.rows || [];
    const moKeys = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const rowTotal = r => moKeys.reduce((a, m) => a + (r?.months?.[m] || 0), 0);
    const revenueRow = rows.find(r => r.id === 'revenue');
    const cogsRow = rows.find(r => r.id === 'cogs');
    const opexRows = rows.filter(r => r.type === 'opex');
    const grossRow = rows.find(r => r.id === 'gross');
    const ebitdaRow = rows.find(r => r.id === 'ebitda');
    const sections = [
      { label: 'Revenue', items: revenueRow ? [{ label: revenueRow.cat || 'Revenue', value: rowTotal(revenueRow) }] : [], color: [22,163,74] },
      { label: 'Cost of Revenue', items: cogsRow ? [{ label: cogsRow.cat || 'Cost of Revenue', value: rowTotal(cogsRow) }] : [], color: [220,38,38] },
      { label: 'Gross Profit', items: grossRow ? [{ label: 'Gross Profit', value: rowTotal(revenueRow) - rowTotal(cogsRow) }] : [], color: [37,99,235] },
      { label: 'Operating Expenses', items: opexRows.map(r => ({ label: r.cat || r.id, value: rowTotal(r) })), color: [220,38,38] },
      { label: 'EBITDA', items: ebitdaRow ? [{ label: 'EBITDA', value: rowTotal(revenueRow) - rowTotal(cogsRow) - opexRows.reduce((a,r)=>a+rowTotal(r),0) }] : [], color: [37,99,235] },
    ];
    sections.forEach(sec => {
      if (!sec.items.length) return;
      doc.setFillColor(244,246,250); doc.rect(ML, y-4, MR-ML, 8, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(36,41,46);
      doc.text(sec.label, ML+2, y+1); y += 10;
      const tRows = sec.items.map(it => [it.label||'', fmtV(it.value||0)]);
      doc.autoTable({ startY:y, body:tRows, theme:'plain', bodyStyles:{fontSize:9}, columnStyles:{1:{halign:'right'}}, margin:{left:ML+4,right:14}, styles:{cellPadding:2.5} });
      y = doc.lastAutoTable.finalY + 4;
    });
  } else {
    const bs = state.statements?.balanceSheet || {};
    ['assets','liabilities','equity'].forEach(sec => {
      const items = bs[sec] || [];
      if (!items.length) return;
      doc.setFillColor(244,246,250); doc.rect(ML, y-4, MR-ML, 8, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(36,41,46);
      doc.text(sec.charAt(0).toUpperCase()+sec.slice(1), ML+2, y+1); y += 10;
      const rows = items.map(it => [it.label||'', fmtV(it.value||0)]);
      const total = items.reduce((a,it)=>a+(it.value||0),0);
      rows.push([{ content:'Total '+sec.charAt(0).toUpperCase()+sec.slice(1), styles:{fontStyle:'bold'} }, { content:fmtV(total), styles:{fontStyle:'bold',halign:'right'} }]);
      doc.autoTable({ startY:y, body:rows, theme:'plain', bodyStyles:{fontSize:9}, columnStyles:{1:{halign:'right'}}, margin:{left:ML+4,right:14}, styles:{cellPadding:2.5} });
      y = doc.lastAutoTable.finalY + 4;
    });
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(151,160,175);
    doc.text(`CFO Genie · Confidential · Page ${i} of ${pageCount}`, W/2, 290, { align:'center' });
  }

  doc.save(`CFO-${title.replace(/\s+/g,'-')}-${new Date().toISOString().split('T')[0]}.pdf`);
  toast('PDF downloaded');
}

// ── PowerPoint Export ─────────────────────────────────────────────────────────
async function downloadPPTX() {
  if (typeof PptxGenJS === 'undefined') { toast('PowerPoint library not loaded — check internet connection'); return; }
  const prs = new PptxGenJS();
  prs.layout = 'LAYOUT_WIDE';

  const ORANGE = 'FF6600', DARK = '24292E', GRAY = '5E6C84', LTGRAY = 'F4F6FA', WHITE = 'FFFFFF';
  const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const fmtV = v => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(v||0);

  const titleSlide = (title, sub) => {
    const sl = prs.addSlide();
    sl.background = { color: ORANGE };
    sl.addShape(prs.ShapeType.rect, { x:0, y:0, w:'100%', h:'100%', fill:{ color: ORANGE } });
    sl.addText('CFO Genie', { x:0.5, y:0.8, w:12, h:0.5, fontSize:13, color:'FFFFFF99', bold:false });
    sl.addText(title, { x:0.5, y:1.4, w:12, h:1.2, fontSize:34, bold:true, color:WHITE, fontFace:'Arial' });
    sl.addText(sub, { x:0.5, y:2.7, w:12, h:0.5, fontSize:14, color:'FFFFFFCC', fontFace:'Arial' });
    sl.addText(today, { x:0.5, y:4.8, w:12, h:0.3, fontSize:11, color:'FFFFFF88', fontFace:'Arial' });
    return sl;
  };

  const contentSlide = (title) => {
    const sl = prs.addSlide();
    sl.background = { color: LTGRAY };
    sl.addShape(prs.ShapeType.rect, { x:0, y:0, w:'100%', h:0.65, fill:{ color: DARK } });
    sl.addText(title, { x:0.35, y:0.1, w:12, h:0.45, fontSize:15, bold:true, color:WHITE, fontFace:'Arial' });
    sl.addText('CFO Genie · Confidential', { x:9.5, y:0.12, w:3, h:0.35, fontSize:8, color:'FFFFFF88', align:'right' });
    return sl;
  };

  const kpiBox = (sl, x, y, w, h, label, value, sub, valueColor) => {
    sl.addShape(prs.ShapeType.rect, { x, y, w, h, fill:{ color: WHITE }, line:{ color:'DDE1E9', width:0.5 }, rectRadius: 0.08 });
    sl.addText(label, { x:x+0.15, y:y+0.12, w:w-0.3, h:0.25, fontSize:8, color:GRAY, bold:false });
    sl.addText(value, { x:x+0.15, y:y+0.38, w:w-0.3, h:0.45, fontSize:18, bold:true, color:valueColor||DARK });
    if (sub) sl.addText(sub, { x:x+0.15, y:y+0.85, w:w-0.3, h:0.22, fontSize:8, color:GRAY });
  };

  // ── Slide 1: Title ──────────────────────────────────────────────────────────
  const company = state.appSettings?.companyName || 'Aladdin Finance';
  titleSlide('Financial Review', company);

  // ── Slide 2: Ayla Executive Summary ─────────────────────────────────────────
  const aylaStory = generateAylaNarrative();
  const slA = contentSlide('Executive Summary — Ayla AI');
  slA.addText('✦ AI-GENERATED NARRATIVE', { x:0.35, y:0.72, w:11, h:0.22, fontSize:8, bold:true, color:ORANGE, fontFace:'Arial' });
  slA.addShape(prs.ShapeType.rect, { x:0.35, y:0.96, w:11, h:1.38, fill:{ color:'FFF7F5' }, line:{ color:'FFD4C0', width:0.5 }, rectRadius:0.06 });
  slA.addText(aylaStory.narrative, { x:0.5, y:1.0, w:10.7, h:1.3, fontSize:9.5, color:'3C3C46', fontFace:'Arial', wrap:true, valign:'top' });
  const hlY = 2.5, colW2 = 5.0;
  slA.addText('KEY HIGHLIGHTS', { x:0.35, y:hlY, w:colW2, h:0.25, fontSize:8, bold:true, color:'16A34A', fontFace:'Arial' });
  slA.addText('RISK FACTORS', { x:5.85, y:hlY, w:colW2, h:0.25, fontSize:8, bold:true, color:'DC2626', fontFace:'Arial' });
  const hlText = aylaStory.highlights.map(h=>'• '+h).join('\n');
  const riskText = aylaStory.risks.length ? aylaStory.risks.map(r=>'• '+r).join('\n') : '• No critical risks identified';
  slA.addText(hlText, { x:0.35, y:hlY+0.3, w:colW2-0.1, h:1.5, fontSize:9, color:DARK, fontFace:'Arial', wrap:true, valign:'top' });
  slA.addText(riskText, { x:5.85, y:hlY+0.3, w:colW2-0.1, h:1.5, fontSize:9, color:'8B0000', fontFace:'Arial', wrap:true, valign:'top' });
  if (aylaStory.actions.length) {
    slA.addShape(prs.ShapeType.rect, { x:0.35, y:4.15, w:11, h:0.25, fill:{ color:'EFF6FF' }, line:{ color:'BFDBFE', width:0.5 } });
    slA.addText('RECOMMENDED ACTIONS', { x:0.45, y:4.17, w:3, h:0.22, fontSize:7.5, bold:true, color:'2563EB', fontFace:'Arial' });
    slA.addText(aylaStory.actions.map((a,i)=>`${i+1}. ${a}`).join('   |   '), { x:3.6, y:4.17, w:7.6, h:0.22, fontSize:7.5, color:DARK, fontFace:'Arial', wrap:false });
  }

  // ── Slide 3: Cash Position ──────────────────────────────────────────────────
  const totalCash = state.banks.reduce((a,b) => a+b.total, 0);
  const reserved  = state.reserves.reduce((a,r) => a+r.amount, 0);
  const available = totalCash - reserved;
  const totalLiab = state.liabilities.reduce((s,c) => s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0), 0);
  const cashRatio = totalLiab ? Math.round((totalLiab/available)*100) : 0;
  const sl2 = contentSlide('Cash Position');
  kpiBox(sl2, 0.35, 0.85, 3.5, 1.2, 'Total Cash', fmtV(totalCash), 'Across all accounts', '16A34A');
  kpiBox(sl2, 4.1, 0.85, 3.5, 1.2, 'Available Cash', fmtV(available), `${fmtV(reserved)} reserved`, '2563EB');
  kpiBox(sl2, 7.85, 0.85, 3.5, 1.2, 'Liabilities/Cash Ratio', cashRatio+'%', cashRatio<=80?'Healthy':cashRatio<=120?'Elevated':'Critical', cashRatio<=80?'16A34A':cashRatio<=120?'D97706':'DC2626');
  const bankRows = state.banks.map(b => [b.name, fmtV(b.total)]);
  sl2.addTable([['Bank', 'Balance'], ...bankRows], { x:0.35, y:2.3, w:5, colW:[3.5,1.5], fontSize:9, border:{pt:0.5,color:'DDE1E9'}, rowH:0.32, autoPage:false, headFontBold:true, headFill:{ color:'24292E' }, headFontColor:WHITE });

  // ── Slide 4: Revenue & Budget ───────────────────────────────────────────────
  const ytdRev = state.revenue.reduce((a,r) => a+r.revenue, 0);
  const ytdTgt = state.revenue.reduce((a,r) => a+r.target, 0);
  const ytdExp = state.revenue.reduce((a,r) => a+r.expenses, 0);
  const attPct = ytdTgt ? Math.round(ytdRev/ytdTgt*100) : 0;
  const netMargin = ytdRev ? Math.round(((ytdRev-ytdExp)/ytdRev)*100) : 0;
  const sl3 = contentSlide('Revenue & Budget Performance');
  kpiBox(sl3, 0.35, 0.85, 2.8, 1.2, 'YTD Revenue', fmtV(ytdRev), '', '16A34A');
  kpiBox(sl3, 3.35, 0.85, 2.8, 1.2, 'Budget Target', fmtV(ytdTgt), '', DARK);
  kpiBox(sl3, 6.35, 0.85, 2.8, 1.2, 'Attainment', attPct+'%', attPct>=90?'On track':attPct>=70?'Watch closely':'Below target', attPct>=90?'16A34A':attPct>=70?'D97706':'DC2626');
  kpiBox(sl3, 9.35, 0.85, 2.0, 1.2, 'Net Margin', netMargin+'%', '', netMargin>0?'16A34A':'DC2626');
  const revRows = state.revenue.slice(0,12).map(r => [r.month||'', fmtV(r.revenue), fmtV(r.target), r.target?Math.round(r.revenue/r.target*100)+'%':'—', fmtV(r.expenses)]);
  sl3.addTable([['Month','Revenue','Target','Att%','Expenses'], ...revRows], { x:0.35, y:2.3, w:11, colW:[1.5,2,2,1.5,2], fontSize:8, border:{pt:0.5,color:'DDE1E9'}, rowH:0.28, autoPage:false, headFontBold:true, headFill:{ color:'24292E' }, headFontColor:WHITE });

  // ── Slide 5: Pipeline ───────────────────────────────────────────────────────
  const openDeals = state.pipeline.filter(d => d.stage !== 'Closed Lost');
  const pipeWtd   = openDeals.reduce((a,d) => a+d.value*(d.probability/100), 0);
  const pipeWon   = openDeals.filter(d=>d.stage==='Closed Won').reduce((a,d)=>a+d.value,0);
  const byStage   = {};
  openDeals.forEach(d => { byStage[d.stage] = (byStage[d.stage]||0)+1; });
  const sl4 = contentSlide('Pipeline Overview');
  kpiBox(sl4, 0.35, 0.85, 3.5, 1.2, 'Weighted Forecast', fmtV(pipeWtd), `${openDeals.filter(d=>d.stage!=='Closed Won').length} open deals`, ORANGE);
  kpiBox(sl4, 4.1, 0.85, 3.5, 1.2, 'Closed Won', fmtV(pipeWon), openDeals.filter(d=>d.stage==='Closed Won').length+' deals', '16A34A');
  kpiBox(sl4, 7.85, 0.85, 3.5, 1.2, 'Total Pipeline', fmtV(openDeals.reduce((a,d)=>a+d.value,0)), openDeals.length+' deals tracked', '2563EB');
  const dealRows = [...openDeals].sort((a,b)=>b.value*b.probability/100 - a.value*a.probability/100).slice(0,10)
    .map(d => [d.name, d.client||'—', d.stage, fmtV(d.value), d.probability+'%', fmtV(d.value*d.probability/100)]);
  sl4.addTable([['Deal','Client','Stage','Value','Prob','Weighted'], ...dealRows], { x:0.35, y:2.3, w:11, colW:[2.5,2,1.8,1.7,1,2], fontSize:8, border:{pt:0.5,color:'DDE1E9'}, rowH:0.28, autoPage:false, headFontBold:true, headFill:{ color:'24292E' }, headFontColor:WHITE });

  // ── Slide 6: AR Summary ─────────────────────────────────────────────────────
  const arOpen    = state.ar.filter(x => x.status !== 'paid');
  const arOverdue = state.ar.filter(x => x.status === 'overdue');
  const arTotal   = arOpen.reduce((a,x)=>a+x.amount,0);
  const arOvTot   = arOverdue.reduce((a,x)=>a+x.amount,0);
  const sl5 = contentSlide('Accounts Receivable');
  kpiBox(sl5, 0.35, 0.85, 3.5, 1.2, 'AR Outstanding', fmtV(arTotal), arOpen.length+' open invoices', DARK);
  kpiBox(sl5, 4.1, 0.85, 3.5, 1.2, 'Overdue Amount', fmtV(arOvTot), arOverdue.length+' overdue', arOvTot>0?'DC2626':'16A34A');
  kpiBox(sl5, 7.85, 0.85, 3.5, 1.2, 'Total Liabilities', fmtV(totalLiab), state.liabilities.length+' categories', 'DC2626');
  const arRows = arOpen.slice(0,12).map(x => [x.client, x.invoice||'—', x.dueDate||'—', fmtV(x.amount), x.status]);
  sl5.addTable([['Client','Invoice','Due Date','Amount','Status'], ...arRows], { x:0.35, y:2.3, w:11, colW:[2.5,2,2,2,2.5], fontSize:8, border:{pt:0.5,color:'DDE1E9'}, rowH:0.28, autoPage:false, headFontBold:true, headFill:{ color:'24292E' }, headFontColor:WHITE });

  await prs.writeFile({ fileName: `CFO-Presentation-${new Date().toISOString().split('T')[0]}.pptx` });
  toast('PowerPoint downloaded');
}

async function sendDailyBriefing() {
  const statusEl = document.getElementById('pipeline-email-status');
  if (statusEl) statusEl.textContent = 'Sending…';
  try {
    const r = await apiCall('/reports/send-daily-briefing',{method:'POST'});
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ ${r.message}</span>`;
    toast(r.message || 'Daily briefing sent');
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: '+e.message);
  }
}

function toggleIntgDetail(id) {
  const el=document.getElementById('intg-detail-'+id); if(!el) return;
  el.style.display=el.style.display==='none'?'block':'none';
}
async function testEmailReport() {
  try { const r=await apiCall('/reports/send-email',{method:'POST'}); toast(r.message||'Report sent'); } catch(e){ toast('Error: '+e.message); }
}

async function testSmtpConnection() {
  const btn = document.getElementById('test-smtp-btn');
  const result = document.getElementById('smtp-test-result');
  if (btn) { btn.textContent = '⏳ Testing…'; btn.disabled = true; }
  if (result) result.innerHTML = '';
  try {
    const r = await apiCall('/sync/test-smtp', {method:'POST'});
    if (btn) { btn.textContent = '✓ Connected'; btn.disabled = false; btn.style.color='var(--success)'; }
    if (result) result.innerHTML = `<span style="color:var(--success)">✓ ${r.message}</span>`;
    toast('SMTP connection successful');
  } catch(e) {
    if (btn) { btn.textContent = '🔌 Test SMTP Connection'; btn.disabled = false; btn.style.color=''; }
    if (result) result.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('SMTP error — check .env credentials');
  }
}

async function triggerCeoReminders() {
  try { const r=await apiCall('/reports/send-ceo-reminders',{method:'POST'}); toast(r.message||'Reminders sent'); } catch(e){ toast('Error: '+e.message); }
}

async function sendInvite() {
  const email=document.getElementById('inv-email').value.trim(), role=document.getElementById('inv-role').value, name=document.getElementById('inv-name').value.trim();
  if (!email){toast('Email required');return;}
  try { const r=await apiCall('/auth/invite',{method:'POST',body:JSON.stringify({email,role,name})}); closeModal('modal-invite'); renderSettings(document.getElementById('main-content')); toast(r.emailSent ? `Invitation sent to ${email}` : 'Invitation created — copy the link below'); console.log('Invite link:',r.link); } catch(e){toast(e.message);}
}

function copyInviteLink(token) {
  const link=window.location.origin+`/register?token=${token}`;
  navigator.clipboard.writeText(link).then(()=>toast('Link copied to clipboard')).catch(()=>{ prompt('Copy this link:',link); });
}

async function cancelInvite(id) {
  try { await apiCall(`/users/invitations/${id}`,{method:'DELETE'}); renderSettings(document.getElementById('main-content')); toast('Invitation cancelled'); } catch(e){toast(e.message);}
}

async function removeUser(id) {
  showConfirm('Remove this team member?', async () => {
    try { await apiCall(`/users/${id}`,{method:'DELETE'}); renderSettings(document.getElementById('main-content')); toast('User removed'); } catch(e){toast(e.message);}
  });
}

async function changePassword() {
  const cur=document.getElementById('cur-pass').value, next=document.getElementById('new-pass').value;
  if (!cur||!next){toast('Both password fields required');return;}
  try { await apiCall('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:cur,newPassword:next})}); document.getElementById('cur-pass').value=''; document.getElementById('new-pass').value=''; toast('Password updated'); } catch(e){toast(e.message);}
}

async function saveProfile() {
  const name = document.getElementById('profile-name')?.value.trim();
  const title = document.getElementById('profile-title')?.value.trim();
  const statusEl = document.getElementById('profile-status');
  if (!name) { toast('Name cannot be empty'); return; }
  try {
    const r = await apiCall('/auth/profile', { method:'PUT', body: JSON.stringify({ name, title }) });
    state.user = { ...state.user, name: r.user.name, title: r.user.title };
    updateUserUI();
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--success)">✓ Profile saved</span>';
    toast('Profile updated');
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: ' + e.message);
  }
}

// ── AI Chat ───────────────────────────────────────────────────────────────────
function openAI(context) {
  const ctx = context || state.section || '';
  state._aylaContext = ctx;
  document.getElementById('ai-chat-panel').classList.add('open');
  const aylaBtn = document.querySelector('.ayla-float');
  if (aylaBtn) aylaBtn.classList.add('ayla-hidden');
  setTimeout(() => {
    document.getElementById('ai-input')?.focus();
    const msgsEl = document.getElementById('ai-msgs');
    if (ctx && msgsEl) {
      // Replace greeting with a context-aware brief if only the default greeting is showing
      const botMsgs = msgsEl.querySelectorAll('.ai-msg.bot');
      if (botMsgs.length === 1) {
        const brief = _aylaContextBrief(ctx);
        if (brief) {
          botMsgs[0].innerHTML = brief;
          msgsEl.scrollTop = msgsEl.scrollHeight;
        }
      }
    }
    _renderAylaSuggestions(ctx);
  }, 120);
}
function closeAI() {
  document.getElementById('ai-chat-panel').classList.remove('open');
  const chips = document.getElementById('ayla-chips');
  if (chips) chips.remove();
  const aylaBtn = document.querySelector('.ayla-float');
  if (aylaBtn) aylaBtn.classList.remove('ayla-hidden');
}

function _renderAylaSuggestions(ctx) {
  const existing = document.getElementById('ayla-chips');
  if (existing) existing.remove();
  const map = {
    ar:            ['AR aging breakdown', 'Top overdue invoices', 'Collection priorities', 'DSO analysis'],
    revenue:       ['Revenue vs target', 'Best performing month', 'Revenue by type', 'Growth trend'],
    cashflow:      ['Current runway', 'Cash flow trend', 'Inflow vs outflow', 'Cash forecast'],
    budget:        ['Budget variance', 'Biggest overspends', 'Cost reduction ideas', 'OpEx vs revenue'],
    pipeline:      ['Pipeline forecast', 'Stale deals', 'Win rate analysis', 'Top deals to close'],
    commissions:   ['Top performers', 'Pending commissions', 'Commission vs revenue', 'Rep attainment'],
    statements:    ['EBITDA this year', 'Gross margin trend', 'OpEx breakdown', 'Net income forecast'],
    dashboard:     ['Executive brief', 'Top 3 risks', 'Cash runway', 'What needs attention'],
    clients:       ['Client concentration', 'Contracts renewing soon', 'Top clients by revenue', 'Churn risk'],
    liabilities:   ['Debt-to-cash ratio', 'Upcoming payments', 'Largest liabilities', 'Liability trend'],
    hr:            ['Headcount by department', 'Pending leave requests', 'Onboarding status', 'Staff summary'],
    subscriptions: ['MRR breakdown', 'Churn analysis', 'Renewals due soon', 'SaaS KPIs'],
    tasks:         ['Overdue tasks', 'Priority breakdown', 'CEO tasks pending', 'Task completion rate'],
    requests:      ['Pending requests', 'Request priorities', 'Recent activity', 'Response rate'],
    projects:      ['Over-budget projects', 'Completion status', 'Linked revenue', 'Budget utilization'],
  };
  const chips = map[ctx] || ['Cash analysis', 'AR status', 'Revenue vs target', 'Top risks'];
  const el = document.createElement('div');
  el.id = 'ayla-chips';
  el.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;padding:8px 12px 4px;border-top:1px solid var(--border)';
  chips.forEach(label => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'font-size:10px;padding:3px 9px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-2);cursor:pointer;transition:all .1s';
    btn.onmouseenter = () => { btn.style.background = 'var(--primary-bg)'; btn.style.color = 'var(--primary)'; btn.style.borderColor = 'var(--primary)'; };
    btn.onmouseleave = () => { btn.style.background = 'var(--surface-2)'; btn.style.color = 'var(--text-2)'; btn.style.borderColor = 'var(--border)'; };
    btn.onclick = () => {
      const inp = document.getElementById('ai-input');
      if (inp) { inp.value = label; inp.focus(); sendAIMsg(); el.remove(); }
    };
    el.appendChild(btn);
  });
  const inputArea = document.querySelector('.ai-chat-input');
  if (inputArea) inputArea.parentNode.insertBefore(el, inputArea);
}

function _aylaContextBrief(ctx) {
  const totalCash=state.banks.reduce((a,b)=>a+b.total,0);
  const reserved=state.reserves.reduce((a,r)=>a+r.amount,0);
  const available=totalCash-reserved;
  const ytdRev=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.revenue,0);
  const ytdExp=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.expenses,0);
  const margin=ytdRev?Math.round(((ytdRev-ytdExp)/ytdRev)*100):0;
  const totalAR=state.ar.filter(x=>x.status!=='paid').reduce((s,x)=>s+x.amount,0);
  const todayStr=TODAY.toISOString().split('T')[0];
  const overdueAR=state.ar.filter(x=>x.status==='overdue'||(x.status==='pending'&&x.dueDate&&x.dueDate<todayStr)).reduce((s,x)=>s+x.amount,0);
  const pipeWtd=state.pipeline.reduce((a,d)=>a+d.value*(d.probability/100),0);

  if (ctx==='ar'||ctx==='revenue') {
    const aging={d30:0,d60:0,d90:0,d90p:0};
    state.ar.filter(x=>x.status!=='paid').forEach(x=>{
      if(!x.dueDate)return;
      const days=Math.ceil((TODAY-new Date(x.dueDate+'T00:00:00'))/864e5);
      if(days<=0) aging.d30+=x.amount;
      else if(days<=30) aging.d30+=x.amount;
      else if(days<=60) aging.d60+=x.amount;
      else if(days<=90) aging.d90+=x.amount;
      else aging.d90p+=x.amount;
    });
    const top3=state.ar.filter(x=>x.status==='overdue').sort((a,b)=>b.amount-a.amount).slice(0,3);
    return `<strong>AR module context</strong> — ${fmt(totalAR)} outstanding, <strong style="color:var(--danger)">${fmt(overdueAR)} overdue</strong>.<br>
Aging: 0–30d <strong>${fmt(aging.d30)}</strong> · 31–60d <strong>${fmt(aging.d60)}</strong> · 61–90d <strong>${fmt(aging.d90)}</strong> · 90d+ <strong style="color:var(--danger)">${fmt(aging.d90p)}</strong>${top3.length?`<br>Priority: ${top3.map(x=>`<strong>${x.client}</strong> (${fmt(x.amount)})`).join(', ')}`:''}<br>Ask me anything about your receivables.`;
  }
  if (ctx==='cashflow') {
    const lastCF=state.cashflow[state.cashflow.length-1];
    const closingBal=lastCF?lastCF.opening+lastCF.inflow-lastCF.outflow:0;
    const burnMo=budgetCurrentMonth();
    const burnRate=state.budget.reduce((a,b)=>a+(b.months?.[burnMo]?.actual||0),0);
    const runway=burnRate?Math.round(available/burnRate):0;
    const trend=state.cashflow.slice(-3).map(r=>r.inflow-r.outflow);
    const trendSign=trend.length>=2?(trend[trend.length-1]>trend[0]?'↑ improving':'↓ tightening'):'';
    return `<strong>Cash flow context</strong> — <strong>${fmt(available)}</strong> available (${fmt(reserved)} reserved).<br>
Closing balance forecast: <strong>${fmt(closingBal)}</strong>${runway?` · Runway: <strong>${runway} months</strong>`:''}${trendSign?` · Trend: <strong>${trendSign}</strong>`:''}<br>Ask about runway, burn rate, inflow/outflow, or forecasts.`;
  }
  if (ctx==='budget') {
    const topOver=state.budget.map(b=>{
      const spent=MO.reduce((a,m)=>a+(b.months?.[m]?.actual||0),0);
      const budgeted=MO.reduce((a,m)=>a+(b.months?.[m]?.budgeted||0),0);
      return {cat:b.cat,spent,budgeted,var:spent-budgeted};
    }).filter(b=>b.var>0).sort((a,c)=>c.var-a.var).slice(0,3);
    return `<strong>Budget context</strong> — Margin <strong>${margin}%</strong>, YTD expenses <strong>${fmt(ytdExp)}</strong>.<br>
${topOver.length?`Top variances: ${topOver.map(b=>`<strong>${b.cat}</strong> +${fmt(b.var)} over`).join(' · ')}<br>`:''}Ask about variances, overspends, or cost reduction opportunities.`;
  }
  if (ctx==='pipeline') {
    const byStage={};
    state.pipeline.forEach(d=>{byStage[d.stage]=(byStage[d.stage]||0)+1;});
    const stageStr=Object.entries(byStage).map(([s,n])=>`${n} ${s}`).join(' · ');
    const staleD=state.appSettings?.pipelineStaleAfterDays||14;
    const stale=state.pipeline.filter(d=>d.lastActivity&&Math.ceil((TODAY-new Date(d.lastActivity))/864e5)>staleD).length;
    return `<strong>Pipeline context</strong> — <strong>${state.pipeline.length} deals</strong>, weighted forecast <strong>${fmt(pipeWtd)}</strong>.<br>
Stages: ${stageStr}${stale?` · <strong style="color:var(--warning)">${stale} stale deals</strong>`:''}.<br>Ask about specific stages, win rates, or deals to prioritize.`;
  }
  if (ctx==='commissions') {
    const paidComm=state.commissions.filter(c=>c.status==='paid').reduce((a,c)=>a+(c.amount||0),0);
    const pendingComm=state.commissions.filter(c=>c.status!=='paid'&&c.status!=='rejected').reduce((a,c)=>a+(c.amount||0),0);
    const byRep={};
    state.commissions.filter(c=>c.status==='paid').forEach(c=>{if(c.salesRep)byRep[c.salesRep]=(byRep[c.salesRep]||0)+(c.amount||0);});
    const topRep=Object.entries(byRep).sort((a,b)=>b[1]-a[1])[0];
    return `<strong>Commissions context</strong> — <strong>${fmt(paidComm)}</strong> paid YTD, <strong>${fmt(pendingComm)}</strong> pending.<br>
${topRep?`Top earner: <strong>${topRep[0]}</strong> (${fmt(topRep[1])}). `:''}${pendingComm>0?`<strong style="color:var(--warning)">${fmt(pendingComm)} pending</strong> awaiting approval.`:''}<br>Ask about rep performance, pending approvals, or commission vs revenue.`;
  }
  if (ctx==='statements') {
    const pnlRows=state.statements?.pnl?.rows||[];
    const rev=pnlRows.find(r=>r.id==='revenue');
    const totalRev=rev?MO.reduce((a,m)=>a+(rev.months[m]||0),0):ytdRev;
    return `<strong>Statements context</strong> — Revenue <strong>${fmt(totalRev)}</strong>, Margin <strong>${margin}%</strong>.<br>
Ask about EBITDA, gross profit, OpEx breakdown, or net income forecast.`;
  }
  if (ctx==='clients') {
    const top=state.clients.slice().sort((a,b)=>b.revenue-a.revenue)[0];
    const renewing=state.clients.filter(c=>c.renewal&&Math.ceil((new Date(c.renewal)-TODAY)/864e5)<90).length;
    const topPct=top&&ytdRev?Math.round((top.revenue/ytdRev)*100):0;
    return `<strong>Client context</strong> — <strong>${state.clients.length} clients</strong>, ${renewing} renewing in 90 days.<br>
${top?`Top client: <strong>${top.name}</strong> (${fmt(top.revenue)}/yr${topPct?`, ${topPct}% of revenue`:''}). `:''}Ask about concentration risk, renewals, or churn risk.`;
  }
  if (ctx==='dashboard') {
    const totalLiab=state.liabilities.reduce((s,c)=>s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0),0);
    const risks=[];
    if(overdueAR>0) risks.push(`${fmt(overdueAR)} overdue AR`);
    if(margin<15) risks.push(`margin at ${margin}%`);
    if(totalLiab>available) risks.push(`liabilities exceed cash`);
    return `<strong>Executive brief</strong> — Cash <strong>${fmt(available)}</strong> · Revenue <strong>${fmt(ytdRev)}</strong> · Margin <strong>${margin}%</strong> · Pipeline <strong>${fmt(pipeWtd)}</strong><br>
${risks.length?`⚠ Watch: <strong>${risks.join(' · ')}</strong><br>`:'✓ No critical alerts. '}Ask me anything.`;
  }
  if (ctx==='hr') {
    const emps = state.hrEmployees||[];
    const active = emps.filter(e=>e.status!=='terminated');
    const pending = (state.hrTimeOff||[]).filter(t=>t.status==='pending');
    const onboarding = emps.filter(e=>e.onboarding&&!e.onboarding.completedAt);
    const depts = [...new Set(active.map(e=>e.department).filter(Boolean))];
    return `<strong>HR context</strong> — <strong>${active.length} active employees</strong> across ${depts.length} departments.<br>
${pending.length?`<strong style="color:var(--warning)">${pending.length} leave request${pending.length!==1?'s':''}</strong> pending approval. `:''}${onboarding.length?`<strong>${onboarding.length} employees</strong> in onboarding. `:''}Ask about headcount, leave, onboarding, or payroll costs.`;
  }
  if (ctx==='subscriptions') {
    const subs = state.subscriptions||[];
    const active = subs.filter(s=>s.status==='active');
    const subMrr = s => s.billing==='monthly'?s.amount:s.billing==='quarterly'?s.amount/3:s.amount/12;
    const mrr = active.reduce((a,s)=>a+subMrr(s),0);
    const renewing = subs.filter(s=>s.status==='active'&&s.renewalDate&&Math.ceil((new Date(s.renewalDate)-TODAY)/864e5)<=30).length;
    return `<strong>Subscriptions context</strong> — <strong>${active.length} active</strong> subscriptions, MRR <strong>${fmt(Math.round(mrr))}</strong>.<br>
${renewing?`<strong style="color:var(--warning)">${renewing} renewal${renewing!==1?'s':''}</strong> due in 30 days. `:''}Ask about MRR, churn, renewals, or SaaS KPIs.`;
  }
  if (ctx==='tasks') {
    const open = (state.tasks||[]).filter(t=>!t.done);
    const high = open.filter(t=>t.priority==='high');
    const ceo  = open.filter(t=>t.taskType==='ceo'||t.taskType==='cpo');
    const overdue = open.filter(t=>t.deadline&&t.deadline<TODAY.toISOString().split('T')[0]);
    return `<strong>Tasks context</strong> — <strong>${open.length} open tasks</strong>${high.length?`, <strong style="color:var(--danger)">${high.length} high priority</strong>`:''}.<br>
${ceo.length?`<strong>${ceo.length} CEO/CPO task${ceo.length!==1?'s':''}</strong> awaiting completion. `:''}${overdue.length?`<strong style="color:var(--danger)">${overdue.length} overdue</strong>. `:''}Ask about priorities, deadlines, or task breakdown.`;
  }
  if (ctx==='requests') {
    const reqs = state.requests||[];
    const pending = reqs.filter(r=>r.status==='pending'||r.status==='adjusted'||r.status==='adjustment_declined');
    const high = pending.filter(r=>r.priority==='high');
    return `<strong>Requests context</strong> — <strong>${reqs.length} total</strong>, <strong>${pending.length} pending</strong> review.<br>
${high.length?`<strong style="color:var(--danger)">${high.length} high priority</strong> need urgent response. `:''}Ask about pending requests, priorities, or response status.`;
  }
  if (ctx==='projects') {
    const projs = state.projects||[];
    const active = projs.filter(p=>!['completed','cancelled'].includes(p.status));
    const over = active.filter(p=>p.actualSpend>p.budget&&p.budget>0);
    const totalBudget = active.reduce((a,p)=>a+(p.budget||0),0);
    const totalSpend  = active.reduce((a,p)=>a+(p.actualSpend||0),0);
    return `<strong>Projects context</strong> — <strong>${active.length} active projects</strong>, budget utilization <strong>${totalBudget?Math.round(totalSpend/totalBudget*100):0}%</strong>.<br>
${over.length?`<strong style="color:var(--danger)">${over.length} project${over.length!==1?'s':''} over budget</strong>. `:'All projects within budget. '}Ask about spend, milestones, or linked revenue.`;
  }
  return null;
}

function sendAIMsg() {
  try {
    const inp=document.getElementById('ai-input'), msg=inp.value.trim(); if(!msg) return;
    const msgsEl=document.getElementById('ai-msgs');
    msgsEl.innerHTML+=`<div class="ai-msg user">${msg}</div>`;
    inp.value=''; inp.disabled=true;
    const loadingId='ai-loading-'+Date.now();
    msgsEl.innerHTML+=`<div class="ai-msg bot" id="${loadingId}"><em style="opacity:.6">Ayla is thinking…</em></div>`;
    msgsEl.scrollTop=msgsEl.scrollHeight;
    setTimeout(()=>{
      try {
        const reply=generateAIReply(msg);
        const loadEl=document.getElementById(loadingId);
        if(loadEl) loadEl.innerHTML=reply; else msgsEl.innerHTML+=`<div class="ai-msg bot">${reply}</div>`;
      } catch(e) {
        const loadEl=document.getElementById(loadingId);
        if(loadEl) loadEl.innerHTML='Sorry, something went wrong. Please try again.';
      }
      msgsEl.scrollTop=msgsEl.scrollHeight;
      inp.disabled=false; inp.focus();
    },600);
  } catch(e) { console.error('sendAIMsg error:', e); }
}

function _aylaSrc(items) {
  if (!items.length) return '';
  const rows = items.map(([lbl,val])=>`<span style="display:flex;justify-content:space-between;gap:12px"><span style="color:var(--text-3)">${lbl}</span><strong style="color:var(--text-2)">${val}</strong></span>`).join('');
  return `<details style="margin-top:9px;padding-top:8px;border-top:1px solid var(--border)"><summary style="cursor:pointer;font-size:10px;font-weight:700;color:var(--text-3);letter-spacing:.04em;user-select:none">📊 DATA SOURCES</summary><div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;font-size:10px;background:var(--surface);border-radius:5px;padding:8px 10px">${rows}</div></details>`;
}

function generateAIReply(msg) {
  const m=msg.toLowerCase();
  const totalCash=state.banks.reduce((a,b)=>a+b.total,0);
  const reserved=state.reserves.reduce((a,r)=>a+r.amount,0);
  const available=totalCash-reserved;
  const ytdRev=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.revenue,0);
  const ytdExp=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.expenses,0);
  const totalLiab=state.liabilities.reduce((s,c)=>s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0),0);
  const totalAR=state.ar.filter(x=>x.status!=='paid').reduce((s,x)=>s+x.amount,0);
  const todayStr=TODAY.toISOString().split('T')[0];
  const isOverdueAR=x=>x.status==='overdue'||(x.status==='pending'&&x.dueDate&&x.dueDate<todayStr);
  const overdueAR=state.ar.filter(isOverdueAR).reduce((s,x)=>s+x.amount,0);
  const margin=ytdRev?Math.round(((ytdRev-ytdExp)/ytdRev)*100):0;
  const currentRatio=totalLiab?((available+totalAR)/totalLiab).toFixed(2):'—';
  const pipeWtd=state.pipeline.reduce((a,d)=>a+d.value*(d.probability/100),0);

  if (m.includes('ratio')||m.includes('health')) {
    const pipeWtd=state.pipeline.reduce((a,d)=>a+d.value*(d.probability/100),0);
    return `Financial health snapshot:<br>• <strong>Current Ratio: ${currentRatio}x</strong> (target ≥2.0)<br>• <strong>Profit Margin: ${margin}%</strong> (target >20%)<br>• <strong>AR Overdue: ${fmt(overdueAR)}</strong> — ${overdueAR>0?'action needed':'all current'}<br>• <strong>Pipeline: ${fmt(pipeWtd)}</strong> weighted forecast<br>${margin<15?'<br>⚠ Profit margin is below optimal — review operating costs.':''}` + _aylaSrc([['Total Cash',fmt(totalCash)],['Reserves',fmt(reserved)],['Available',fmt(available)],['Total AR Outstanding',fmt(totalAR)],['Overdue AR',fmt(overdueAR)],['Total Liabilities',fmt(totalLiab)],['Pipeline (weighted)',fmt(pipeWtd)],['Margin',margin+'%']]);
  }
  if (m.includes('cash')||m.includes('balance')||m.includes('available')) {
    const lastCF=state.cashflow[state.cashflow.length-1];
    const decClose=lastCF?lastCF.opening+lastCF.inflow-lastCF.outflow:0;
    const burnMo=budgetCurrentMonth();
    const burnRate=state.budget.reduce((a,b)=>a+(b.months?.[burnMo]?.actual||0),0);
    const runway=burnRate?Math.round(available/burnRate):0;
    const bankRows=state.banks.map(b=>[b.name,fmt(b.total)]);
    return `Cash position: <strong>${fmt(totalCash)}</strong> total across ${state.banks.length} accounts. After reserves: <strong>${fmt(available)}</strong> available.<br><br>At current burn rate (~${fmt(burnRate)}/mo), runway is <strong>${runway} months</strong>. Dec forecast: <strong>${fmt(decClose)}</strong>.<br>${available<400000?'<br>⚠ <strong>Alert:</strong> Cash is tightening — consider accelerating AR collection or deferring non-critical spend.':''}` + _aylaSrc([...bankRows,['Total Cash',fmt(totalCash)],['Reserves',fmt(reserved)],['Available',fmt(available)],['Burn Rate ('+burnMo+')',fmt(burnRate)+'/mo'],['Runway',runway+' months']]);
  }
  if (m.includes('liabilit')||m.includes('debt')||m.includes('payable')) {
    const cats=state.liabilities.map(c=>c.name+': '+fmt((c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0))).join(', ');
    const liabRows=state.liabilities.map(c=>[c.name,fmt((c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0))]);
    return `Total liabilities: <strong>${fmt(totalLiab)}</strong>.<br>Breakdown: ${cats}.<br><br>Compared to available cash of ${fmt(available)}, your debt-to-cash ratio is <strong>${available?((totalLiab/available)*100).toFixed(0):0}%</strong>. ${totalLiab>available*0.8?'⚠ Liabilities are high relative to cash. Prioritize upcoming payments.':'Liabilities are manageable.'}` + _aylaSrc([...liabRows,['Total Liabilities',fmt(totalLiab)],['Available Cash',fmt(available)]]);
  }
  if (m.includes('receivable')||m.includes('invoice')||m.includes('ar')) {
    const overdueList=state.ar.filter(isOverdueAR).map(x=>`• ${x.client}: ${fmt(x.amount)}${x.status==='pending'?' (past due)':''}`).join('<br>');
    const arRows=state.ar.filter(x=>x.status!=='paid').map(x=>[x.client+' ('+x.status+')',fmt(x.amount)]);
    return `Accounts receivable: <strong>${fmt(totalAR)}</strong> outstanding (<strong>${fmt(overdueAR)}</strong> overdue or past due).<br><br>${overdueList||'No overdue invoices.'}<br><br>${overdueAR>0?'Recommendation: send reminders within 48 hours and consider escalating accounts >30 days overdue.':'Great — all invoices are current!'}` + _aylaSrc([...arRows,['Total Outstanding',fmt(totalAR)],['Overdue / Past Due',fmt(overdueAR)]]);
  }
  if (m.includes('budget')||m.includes('expense')||m.includes('cost')) {
    const total=state.budget.reduce((a,b)=>a+budgetAnnual(b),0);
    const topCat=[...state.budget].sort((a,b)=>budgetAnnual(b)-budgetAnnual(a))[0];
    const budRows=state.budget.slice(0,5).map(b=>[b.cat,fmt(budgetAnnual(b))]);
    return `Annual budget: <strong>${fmt(total)}</strong> across ${state.budget.length} categories. Largest allocation: <strong>${topCat?.cat} (${fmt(topCat?budgetAnnual(topCat):0)})</strong>.<br><br>YTD expenses: <strong>${fmt(ytdExp)}</strong> · Margin: <strong>${margin}%</strong>.<br>${margin<20?'⚠ Consider reducing variable costs to improve margin.':'Expenses are well-controlled.'}` + _aylaSrc([...budRows,['Total Annual Budget',fmt(total)],['YTD Expenses',fmt(ytdExp)],['Margin',margin+'%']]);
  }
  if (m.includes('revenue')||m.includes('target')||m.includes('sales')) {
    const ytdTgt=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.target,0);
    const pct=ytdTgt?((ytdRev/ytdTgt)*100).toFixed(1):0;
    const revRows=state.revenue.filter(r=>r.revenue>0).map(r=>[r.month,fmt(r.revenue)]);
    return `Revenue YTD: <strong>${fmt(ytdRev)}</strong> vs target <strong>${fmt(ytdTgt)}</strong> — <strong>${pct}%</strong> of target achieved.<br><br>Best month: ${state.revenue.filter(r=>r.revenue>0).sort((a,b)=>b.revenue-a.revenue)[0]?.month||'—'}.<br>${ytdRev<ytdTgt?'⚠ Revenue is behind target. Review pipeline and accelerate deals in Negotiation/Proposal stages.':'Revenue is on track!'}` + _aylaSrc([...revRows,['YTD Revenue',fmt(ytdRev)],['YTD Target',fmt(ytdTgt)],['Attainment',pct+'%']]);
  }
  if (m.includes('pipeline')||m.includes('deal')) {
    const pipeTotal=state.pipeline.reduce((a,d)=>a+d.value,0);
    const pipeWtd=state.pipeline.reduce((a,d)=>a+d.value*(d.probability/100),0);
    const topDeal=[...state.pipeline].sort((a,b)=>b.value-a.value)[0];
    const dealRows=state.pipeline.slice(0,5).map(d=>[d.name+' ('+d.stage+')',fmt(d.value)+' @ '+d.probability+'%']);
    return `Pipeline: <strong>${state.pipeline.length} deals</strong>, total value <strong>${fmt(pipeTotal)}</strong>, weighted forecast <strong>${fmt(pipeWtd)}</strong>.<br><br>Largest deal: <strong>${topDeal?.name} (${fmt(topDeal?.value||0)})</strong> — ${topDeal?.stage}.<br>Won ${state.pipeline.filter(d=>d.stage==='Closed Won').length} deals this period.` + _aylaSrc([...dealRows,['Total Pipeline',fmt(pipeTotal)],['Weighted Forecast',fmt(pipeWtd)]]);
  }
  if (m.includes('client')) {
    const top=[...state.clients].sort((a,b)=>b.revenue-a.revenue)[0];
    const renewing=state.clients.filter(c=>Math.ceil((new Date(c.renewal)-TODAY)/864e5)<90);
    const clientRows=state.clients.slice(0,5).map(c=>[c.name,fmt(c.revenue)+'/yr']);
    return `${state.clients.length} active clients. Top: <strong>${top?.name} (${fmt(top?.revenue||0)}/yr)</strong>.<br>${renewing.length} contract${renewing.length!==1?'s':''} renewing within 90 days: ${renewing.map(c=>c.name).join(', ')||'none'}.<br><br>SaaS revenue concentration: focus on expanding SaaS share to improve margins.` + _aylaSrc([...clientRows,['Total Clients',state.clients.length+''],['Renewing <90d',renewing.length+'']]);
  }
  if (m.includes('aging')||m.includes('aged')||(m.includes('overdue')&&m.includes('day'))) {
    const aging={d30:0,d60:0,d90:0,d90p:0,counts:{d30:0,d60:0,d90:0,d90p:0}};
    state.ar.filter(x=>x.status!=='paid').forEach(x=>{
      if(!x.dueDate)return;
      const days=Math.ceil((TODAY-new Date(x.dueDate+'T00:00:00'))/864e5);
      if(days<=0){aging.d30+=x.amount;aging.counts.d30++;}
      else if(days<=30){aging.d30+=x.amount;aging.counts.d30++;}
      else if(days<=60){aging.d60+=x.amount;aging.counts.d60++;}
      else if(days<=90){aging.d90+=x.amount;aging.counts.d90++;}
      else{aging.d90p+=x.amount;aging.counts.d90p++;}
    });
    return `AR Aging Analysis:<br>• <strong>0–30 days:</strong> ${fmt(aging.d30)} (${aging.counts.d30} inv) — current or very recent<br>• <strong>31–60 days:</strong> <span style="color:var(--warning)">${fmt(aging.d60)} (${aging.counts.d60} inv)</span> — send reminder now<br>• <strong>61–90 days:</strong> <span style="color:var(--danger)">${fmt(aging.d90)} (${aging.counts.d90} inv)</span> — escalate to account manager<br>• <strong>90+ days:</strong> <span style="color:var(--danger);font-weight:700">${fmt(aging.d90p)} (${aging.counts.d90p} inv)</span> — consider legal notice or write-off<br><br>${aging.d90p>0?'⚠ 90+ day balances are a collection priority — high risk of becoming bad debt.':'No severely aged balances.'}` + _aylaSrc([['0-30 days',fmt(aging.d30)],['31-60 days',fmt(aging.d60)],['61-90 days',fmt(aging.d90)],['90+ days',fmt(aging.d90p)],['Total Outstanding',fmt(totalAR)]]);
  }
  if (m.includes('commission')||m.includes('rep')||m.includes('salesperson')||m.includes('attainment')) {
    const paidComm=state.commissions.filter(c=>c.status==='paid').reduce((a,c)=>a+(c.amount||0),0);
    const pendingComm=state.commissions.filter(c=>c.status!=='paid'&&c.status!=='rejected').reduce((a,c)=>a+(c.amount||0),0);
    const byRep={};
    state.commissions.forEach(c=>{if(c.salesRep)byRep[c.salesRep]=(byRep[c.salesRep]||{paid:0,pending:0}),byRep[c.salesRep][c.status==='paid'?'paid':'pending']+=(c.amount||0);});
    const repRows=Object.entries(byRep).sort((a,b)=>b[1].paid-a[1].paid).slice(0,5).map(([n,v])=>[n,`${fmt(v.paid)} paid${v.pending?` + ${fmt(v.pending)} pending`:''}`]);
    const commVsRev=ytdRev?((paidComm/ytdRev)*100).toFixed(1):0;
    return `Commission analysis:<br>• Paid YTD: <strong>${fmt(paidComm)}</strong> (${commVsRev}% of revenue)<br>• Pending/approved: <strong>${fmt(pendingComm)}</strong><br>${repRows.length?`<br>By rep:<br>${repRows.map(([n,v])=>`• <strong>${n}:</strong> ${v}`).join('<br>')}`:''}<br><br>${commVsRev>8?`⚠ Commission rate at ${commVsRev}% of revenue — review rate structure.`:`Commission-to-revenue ratio is healthy at ${commVsRev}%.`}` + _aylaSrc([['Paid Commissions',fmt(paidComm)],['Pending',fmt(pendingComm)],['As % of Revenue',commVsRev+'%'],...repRows]);
  }
  if (m.includes('project')||m.includes('milestone')) {
    const active=state.projects.filter(p=>p.status!=='completed'&&p.status!=='cancelled');
    const budgetedTotal=active.reduce((a,p)=>a+(p.budget||0),0);
    const spentTotal=active.reduce((a,p)=>a+(p.spent||0),0);
    const overBudget=active.filter(p=>p.spent>p.budget&&p.budget>0);
    const overMiles=active.filter(p=>(p.milestones||[]).some(ms=>ms.dueDate&&ms.dueDate<todayStr&&!ms.done));
    return `Project analysis — <strong>${active.length} active projects</strong>:<br>• Budget utilization: <strong>${fmt(spentTotal)}</strong> of <strong>${fmt(budgetedTotal)}</strong> (${budgetedTotal?Math.round(spentTotal/budgetedTotal*100):0}%)<br>${overBudget.length?`• ⚠ Over budget: ${overBudget.map(p=>`<strong>${p.name}</strong> (+${fmt(p.spent-p.budget)})`).join(', ')}`:'• All projects within budget'}<br>${overMiles.length?`• ⚠ Overdue milestones: ${overMiles.map(p=>p.name).join(', ')}`:'• No overdue milestones'}` + _aylaSrc([['Active Projects',active.length+''],['Total Budget',fmt(budgetedTotal)],['Total Spent',fmt(spentTotal)],['Over Budget',overBudget.length+' projects']]);
  }
  if (m.includes('ebitda')||m.includes('net income')||m.includes('p&l')||m.includes('profit and loss')||m.includes('gross margin')||m.includes('operating')) {
    const pnlRows=state.statements?.pnl?.rows||[];
    const revRow=pnlRows.find(r=>r.id==='revenue');
    const cogsRow=pnlRows.find(r=>r.id==='cogs');
    const opexRows=pnlRows.filter(r=>r.type==='opex');
    if (revRow) {
      const totalRev=MO.reduce((a,m)=>a+(revRow.months[m]||0),0);
      const totalCogs=cogsRow?MO.reduce((a,m)=>a+(cogsRow.months[m]||0),0):0;
      const grossProfit=totalRev-totalCogs;
      const totalOpex=opexRows.reduce((a,r)=>a+MO.reduce((s,m)=>s+(r.months[m]||0),0),0);
      const ebitda=grossProfit-totalOpex;
      const grossPct=totalRev?Math.round(grossProfit/totalRev*100):0;
      const ebitdaPct=totalRev?Math.round(ebitda/totalRev*100):0;
      return `P&L Summary — FY ${state.statements?.pnl?.year||state.fiscalYear}:<br>• Revenue: <strong>${fmt(totalRev)}</strong><br>• COGS: <strong>${fmt(totalCogs)}</strong> → Gross Profit <strong>${fmt(grossProfit)}</strong> (<strong>${grossPct}%</strong> margin)<br>• Operating Expenses: <strong>${fmt(totalOpex)}</strong><br>• EBITDA: <strong style="color:${ebitda>=0?'var(--success)':'var(--danger)'}">${fmt(ebitda)}</strong> (<strong>${ebitdaPct}%</strong> margin)<br><br>${ebitdaPct<10?'⚠ EBITDA margin is thin — focus on OpEx reduction or revenue growth.':ebitdaPct>20?'Strong EBITDA margin. Consider reinvesting in growth.':'Healthy EBITDA range.'}` + _aylaSrc([['Revenue',fmt(totalRev)],['Gross Profit',fmt(grossProfit)],['Gross Margin',grossPct+'%'],['EBITDA',fmt(ebitda)],['EBITDA Margin',ebitdaPct+'%']]);
    }
    return `No P&L data loaded. Go to Statements → Profit & Loss to enter or import data.`;
  }
  if (m.includes('variance')||m.includes('actual vs budget')||m.includes('overspend')) {
    const variances=state.budget.map(b=>{
      const actual=MO.reduce((a,mo)=>a+(b.months?.[mo]?.actual||0),0);
      const budgeted=MO.reduce((a,mo)=>a+(b.months?.[mo]?.budgeted||0),0);
      return {cat:b.cat,actual,budgeted,var:actual-budgeted,pct:budgeted?Math.round(((actual-budgeted)/budgeted)*100):0};
    }).filter(b=>b.budgeted>0).sort((a,c)=>Math.abs(c.var)-Math.abs(a.var));
    const over=variances.filter(v=>v.var>0);
    const under=variances.filter(v=>v.var<0);
    return `Budget variance (YTD actuals vs budget):<br>${variances.slice(0,6).map(v=>`• <strong>${v.cat}:</strong> ${fmt(v.actual)} vs ${fmt(v.budgeted)} → <span style="color:${v.var>0?'var(--danger)':'var(--success)'}">${v.var>0?'+':''}${fmt(v.var)} (${v.pct>0?'+':''}${v.pct}%)</span>`).join('<br>')}<br><br>${over.length?`⚠ ${over.length} categories over budget.`:''} ${under.length?`✓ ${under.length} categories under budget — potential reallocation opportunity.`:''}` + _aylaSrc([...variances.slice(0,5).map(v=>[v.cat,`${fmt(v.var)} var`]),['Total Over',fmt(over.reduce((a,v)=>a+v.var,0))],['Total Under',fmt(under.reduce((a,v)=>a+v.var,0))]]);
  }
  if (m.includes('trend')||m.includes('month over month')||m.includes('growth')||m.includes('seasonalit')) {
    const revData=state.revenue.filter(r=>r.revenue>0).map(r=>({month:r.month,rev:r.revenue}));
    if (revData.length>=2) {
      const last=revData[revData.length-1], prev=revData[revData.length-2];
      const moGrowth=prev.rev?((last.rev-prev.rev)/prev.rev*100).toFixed(1):0;
      const peak=revData.reduce((a,b)=>b.rev>a.rev?b:a);
      const avg=Math.round(revData.reduce((a,r)=>a+r.rev,0)/revData.length);
      return `Revenue trend analysis:<br>• Latest month: <strong>${last.month} — ${fmt(last.rev)}</strong> (${moGrowth>0?'+':''}${moGrowth}% vs prior month)<br>• Peak month: <strong>${peak.month} (${fmt(peak.rev)})</strong><br>• Monthly average: <strong>${fmt(avg)}</strong><br>• YTD total: <strong>${fmt(ytdRev)}</strong><br><br>${Number(moGrowth)<0?`⚠ Revenue declined ${Math.abs(moGrowth)}% last month. Investigate pipeline and invoicing timing.`:Number(moGrowth)>10?`Strong momentum — ${moGrowth}% growth last month.`:'Revenue is stable.'}` + _aylaSrc(revData.map(r=>[r.month,fmt(r.rev)]));
    }
    return `Not enough monthly data for trend analysis. Enter at least 2 months of revenue data.`;
  }
  if (m.includes('concentration')||m.includes('client risk')||m.includes('top client')) {
    const sorted=[...state.clients].sort((a,b)=>b.revenue-a.revenue);
    const top3Rev=sorted.slice(0,3).reduce((a,c)=>a+c.revenue,0);
    const top3Pct=ytdRev?Math.round(top3Rev/ytdRev*100):0;
    const clientRows=sorted.slice(0,5).map(c=>[c.name,fmt(c.revenue)+'/yr'+(ytdRev?` (${Math.round(c.revenue/ytdRev*100)}%)`:'')]);
    return `Client concentration analysis:<br>${sorted.slice(0,5).map((c,i)=>`• <strong>${c.name}:</strong> ${fmt(c.revenue)}/yr ${ytdRev?`(${Math.round(c.revenue/ytdRev*100)}% of revenue)`:''}`).join('<br>')}<br><br>${top3Pct>60?`⚠ Top 3 clients represent <strong>${top3Pct}%</strong> of revenue — high concentration risk. Diversify.`:top3Pct>40?`Moderate concentration: top 3 = ${top3Pct}% of revenue.`:`Low concentration risk — revenue is well-diversified.`}` + _aylaSrc([...clientRows,['Top 3 Share',top3Pct+'%']]);
  }
  if (m.includes('forecast')||m.includes('predict')||m.includes('next month')) {
    const lastCF=state.cashflow[state.cashflow.length-1];
    const avgInflow=state.cashflow.length?Math.round(state.cashflow.reduce((a,r)=>a+r.inflow,0)/state.cashflow.length):0;
    const avgOutflow=state.cashflow.length?Math.round(state.cashflow.reduce((a,r)=>a+r.outflow,0)/state.cashflow.length):0;
    const closingBal=lastCF?lastCF.opening+lastCF.inflow-lastCF.outflow:available;
    const nextMoForecast=closingBal+avgInflow-avgOutflow;
    return `Cash flow forecast:<br>• Current closing balance: <strong>${fmt(closingBal)}</strong><br>• Avg monthly inflow (YTD): <strong>${fmt(avgInflow)}</strong><br>• Avg monthly outflow (YTD): <strong>${fmt(avgOutflow)}</strong><br>• Next month estimate: <strong style="color:${nextMoForecast>=closingBal?'var(--success)':'var(--danger)'}">${fmt(nextMoForecast)}</strong><br>• Pending AR to collect: <strong>${fmt(totalAR)}</strong><br><br>${nextMoForecast<200000?'⚠ Cash may tighten next month — accelerate AR collections.':'Cash forecast looks healthy.'}` + _aylaSrc([['Current Balance',fmt(closingBal)],['Avg Monthly Inflow',fmt(avgInflow)],['Avg Monthly Outflow',fmt(avgOutflow)],['Next Month Forecast',fmt(nextMoForecast)],['Pending AR',fmt(totalAR)]]);
  }
  if (m.includes('executive')||m.includes('brief')||m.includes('summary')||m.includes('overview')) {
    const totalLiab=state.liabilities.reduce((s,c)=>s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0),0);
    const alerts=[];
    if(overdueAR>0) alerts.push(`${fmt(overdueAR)} overdue AR`);
    if(margin<15) alerts.push(`margin at ${margin}%`);
    if(totalLiab>available) alerts.push(`liabilities exceed available cash`);
    state.clients.filter(c=>c.renewal&&Math.ceil((new Date(c.renewal)-TODAY)/864e5)<30).forEach(c=>alerts.push(`${c.name} renewing <30 days`));
    return `Executive financial brief:<br>• Cash: <strong>${fmt(available)}</strong> available (${fmt(reserved)} reserved)<br>• Revenue YTD: <strong>${fmt(ytdRev)}</strong> · Margin: <strong>${margin}%</strong><br>• AR Outstanding: <strong>${fmt(totalAR)}</strong>${overdueAR?` (<strong style="color:var(--danger)">${fmt(overdueAR)} overdue</strong>)`:''}<br>• Liabilities: <strong>${fmt(totalLiab)}</strong><br>• Pipeline: <strong>${fmt(pipeWtd)}</strong> weighted forecast<br><br>${alerts.length?`⚠ Action needed: ${alerts.join(' · ')}`:' All key metrics look healthy.'}` + _aylaSrc([['Cash Available',fmt(available)],['Revenue YTD',fmt(ytdRev)],['Margin',margin+'%'],['Overdue AR',fmt(overdueAR)],['Pipeline',fmt(pipeWtd)]]);
  }
  if (m.includes('risk')||m.includes('alert')||m.includes('issue')) {
    const totalLiab=state.liabilities.reduce((s,c)=>s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0),0);
    const risks=[];
    if(overdueAR>0) risks.push(`• <span style="color:var(--danger)">Overdue AR:</span> ${fmt(overdueAR)} needs collection`);
    if(totalLiab>available) risks.push(`• <span style="color:var(--danger)">Liabilities (${fmt(totalLiab)}) exceed available cash (${fmt(available)})</span>`);
    if(margin<10) risks.push(`• <span style="color:var(--danger)">Profit margin critically low at ${margin}%</span>`);
    else if(margin<20) risks.push(`• <span style="color:var(--warning)">Margin at ${margin}% — below 20% target</span>`);
    state.clients.filter(c=>c.renewal&&Math.ceil((new Date(c.renewal)-TODAY)/864e5)<30).forEach(c=>risks.push(`• <span style="color:var(--warning)">Renewal in <30 days: ${c.name}</span>`));
    const staleD=state.appSettings?.pipelineStaleAfterDays||14;
    const staleCount=state.pipeline.filter(d=>d.lastActivity&&Math.ceil((TODAY-new Date(d.lastActivity))/864e5)>staleD).length;
    if(staleCount>0) risks.push(`• ${staleCount} stale pipeline deals (no activity >${staleD} days)`);
    return (risks.length ? `Active financial risks (${risks.length}):<br>${risks.join('<br>')}` : '✓ No critical financial risks detected. All metrics within healthy ranges.') + _aylaSrc([['Available Cash',fmt(available)],['Overdue AR',fmt(overdueAR)],['Total Liabilities',fmt(totalLiab)],['Margin',margin+'%'],['Stale Deals',staleCount+'']]);
  }
  if (m.includes('suggest')||m.includes('advice')||m.includes('recommend')||m.includes('what should')) {
    const totalLiab=state.liabilities.reduce((s,c)=>s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0),0);
    const suggestions=[];
    if(overdueAR>20000) suggestions.push(`• <strong>Immediate:</strong> Send collection reminders for ${fmt(overdueAR)} overdue AR — recover cash now`);
    if(margin<20) suggestions.push(`• <strong>Cost control:</strong> Margin at ${margin}% — identify top 2 OpEx categories to trim by 10%`);
    if(state.pipeline.filter(d=>d.stage==='Proposal'||d.stage==='Negotiation').length>0) suggestions.push(`• <strong>Revenue:</strong> ${state.pipeline.filter(d=>d.stage==='Proposal'||d.stage==='Negotiation').length} deals in Proposal/Negotiation — push for Q closes this week`);
    if(state.clients.filter(c=>c.renewal&&Math.ceil((new Date(c.renewal)-TODAY)/864e5)<60).length>0) suggestions.push(`• <strong>Retention:</strong> ${state.clients.filter(c=>c.renewal&&Math.ceil((new Date(c.renewal)-TODAY)/864e5)<60).length} contracts expiring in 60 days — initiate renewal discussions`);
    if(available>totalLiab*3) suggestions.push(`• <strong>Capital efficiency:</strong> Cash reserves are strong — consider short-term investment or strategic deployment`);
    suggestions.push(`• <strong>Governance:</strong> Schedule monthly CFO review — validate actuals vs budget by category`);
    return `CFO recommendations:<br>${suggestions.join('<br>')}` + _aylaSrc([['Cash Available',fmt(available)],['Overdue AR',fmt(overdueAR)],['Margin',margin+'%'],['Open Proposals',state.pipeline.filter(d=>d.stage==='Proposal').length+'']]);
  }
  if (m.includes('employee')||m.includes('headcount')||m.includes('staff')||m.includes('hr')||m.includes('leave')||m.includes('time off')||m.includes('onboard')) {
    const emps=state.hrEmployees||[];
    const active=emps.filter(e=>e.status!=='terminated');
    const terminated=emps.filter(e=>e.status==='terminated');
    const onLeave=emps.filter(e=>e.status==='on-leave');
    const onboarding=emps.filter(e=>e.onboarding&&!e.onboarding.completedAt);
    const pendingLeave=(state.hrTimeOff||[]).filter(t=>t.status==='pending');
    const approvedLeave=(state.hrTimeOff||[]).filter(t=>t.status==='approved');
    const deptMap={};
    active.forEach(e=>{if(e.department) deptMap[e.department]=(deptMap[e.department]||0)+1;});
    const typeMap={};
    active.forEach(e=>{if(e.type) typeMap[e.type]=(typeMap[e.type]||0)+1;});
    const deptRows=Object.entries(deptMap).sort((a,b)=>b[1]-a[1]).map(([d,n])=>[d,n+' employees']);
    const typeRows=Object.entries(typeMap).map(([t,n])=>[t,n+'']);
    return `HR overview — <strong>${active.length} active employees</strong> (${onLeave.length} on leave, ${terminated.length} terminated):<br>
${Object.entries(deptMap).sort((a,b)=>b[1]-a[1]).map(([d,n])=>`• ${d}: <strong>${n}</strong>`).join('<br>')}<br>
Employment mix: ${Object.entries(typeMap).map(([t,n])=>`${n} ${t}`).join(', ')}<br>
${onboarding.length?`<br>Onboarding: <strong>${onboarding.length} employees</strong> in progress.`:''}<br>
${pendingLeave.length?`Leave requests: <strong style="color:var(--warning)">${pendingLeave.length} pending</strong> approval, ${approvedLeave.length} approved.`:'No pending leave requests.'}` + _aylaSrc([['Active Staff',active.length+''],['On Leave',onLeave.length+''],['Pending Leave',pendingLeave.length+''],['Onboarding',onboarding.length+''],...deptRows,...typeRows]);
  }
  if (m.includes('subscription')||m.includes('saas')||m.includes('mrr')||m.includes('arr')||m.includes('churn')||m.includes('renewal')) {
    const subs=state.subscriptions||[];
    const active=subs.filter(s=>s.status==='active');
    const trial=subs.filter(s=>s.status==='trial');
    const churned=subs.filter(s=>s.status==='churned'||s.status==='cancelled');
    const subMrr=s=>s.billing==='monthly'?s.amount:s.billing==='quarterly'?s.amount/3:s.amount/12;
    const mrr=active.reduce((a,s)=>a+subMrr(s),0);
    const arr=mrr*12;
    const churnRate=subs.length?Math.round((churned.length/subs.length)*100):0;
    const renewing=active.filter(s=>s.renewalDate&&Math.ceil((new Date(s.renewalDate)-TODAY)/864e5)<=30);
    const byBilling={monthly:0,quarterly:0,yearly:0};
    active.forEach(s=>{if(byBilling[s.billing]!==undefined) byBilling[s.billing]++;});
    return `SaaS Subscriptions — <strong>${active.length} active</strong> (${trial.length} trial, ${churned.length} churned):<br>
• MRR: <strong>${fmt(Math.round(mrr))}</strong> · ARR: <strong>${fmt(Math.round(arr))}</strong><br>
• Billing mix: ${byBilling.monthly} monthly · ${byBilling.quarterly} quarterly · ${byBilling.yearly} yearly<br>
• Churn rate: <strong style="color:${churnRate>10?'var(--danger)':churnRate>5?'var(--warning)':'var(--success)'}">${churnRate}%</strong> (${churned.length} of ${subs.length} total)<br>
${renewing.length?`• ⚠ <strong style="color:var(--warning)">${renewing.length} renewal${renewing.length!==1?'s':''}</strong> due within 30 days: ${renewing.map(s=>s.client||s.name).join(', ')}`:'• No renewals due in 30 days.'}` + _aylaSrc([['Active',active.length+''],['MRR',fmt(Math.round(mrr))],['ARR',fmt(Math.round(arr))],['Churn Rate',churnRate+'%'],['Renewals <30d',renewing.length+'']]);
  }
  if (m.includes('task')||m.includes('todo')||m.includes('ceo task')||m.includes('deadline')||m.includes('pending task')) {
    const tasks=state.tasks||[];
    const open=tasks.filter(t=>!t.done);
    const done=tasks.filter(t=>t.done);
    const high=open.filter(t=>t.priority==='high');
    const med=open.filter(t=>t.priority==='medium');
    const low=open.filter(t=>t.priority==='low');
    const ceo=open.filter(t=>t.taskType==='ceo');
    const cpo=open.filter(t=>t.taskType==='cpo');
    const todayStr=TODAY.toISOString().split('T')[0];
    const overdue=open.filter(t=>t.deadline&&t.deadline<todayStr);
    const dueThisWeek=open.filter(t=>t.deadline&&t.deadline>=todayStr&&Math.ceil((new Date(t.deadline)-TODAY)/864e5)<=7);
    const doneRate=tasks.length?Math.round((done.length/tasks.length)*100):0;
    return `Task status — <strong>${open.length} open</strong>, ${done.length} completed (${doneRate}% done):<br>
• Priority: <strong style="color:var(--danger)">${high.length} high</strong> · ${med.length} medium · ${low.length} low<br>
${ceo.length||cpo.length?`• Executive tasks: <strong>${ceo.length} CEO</strong>${cpo.length?` · ${cpo.length} CPO`:''} pending completion<br>`:''}
${overdue.length?`• ⚠ <strong style="color:var(--danger)">${overdue.length} overdue</strong>: ${overdue.slice(0,3).map(t=>t.title).join(', ')}${overdue.length>3?` + ${overdue.length-3} more`:''}<br>`:'• No overdue tasks. '}
${dueThisWeek.length?`• Due this week: <strong>${dueThisWeek.length} task${dueThisWeek.length!==1?'s':''}</strong>`:''}` + _aylaSrc([['Open Tasks',open.length+''],['High Priority',high.length+''],['CEO Tasks',ceo.length+''],['Overdue',overdue.length+''],['Due This Week',dueThisWeek.length+''],['Completion Rate',doneRate+'%']]);
  }
  if (m.includes('request')||m.includes('incoming request')||m.includes('pending request')) {
    const reqs=state.requests||[];
    const pending=reqs.filter(r=>r.status==='pending'||r.status==='adjusted'||r.status==='adjustment_declined');
    const accepted=reqs.filter(r=>r.status==='accepted'||r.status==='adjustment_accepted');
    const rejected=reqs.filter(r=>r.status==='rejected');
    const highPri=pending.filter(r=>r.priority==='high');
    const oldest=pending.sort((a,b)=>new Date(a.submittedAt)-new Date(b.submittedAt))[0];
    const fmtD=iso=>iso?new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'-';
    return `Requests overview — <strong>${reqs.length} total</strong> (${pending.length} pending, ${accepted.length} accepted, ${rejected.length} rejected):<br>
${pending.length?`• <strong style="color:var(--warning)">${pending.length} awaiting review</strong>${highPri.length?` — <strong style="color:var(--danger)">${highPri.length} high priority</strong>`:''}<br>`:''}
${oldest?`• Oldest pending: <strong>"${oldest.subject}"</strong> (received ${fmtD(oldest.submittedAt)})<br>`:''}
${highPri.length?`High priority: ${highPri.map(r=>r.subject||'Untitled').join(', ')}`:'All pending items are medium/low priority.'}` + _aylaSrc([['Total',reqs.length+''],['Pending',pending.length+''],['High Priority',highPri.length+''],['Accepted',accepted.length+''],['Rejected',rejected.length+'']]);
  }
  return `I can analyze: <strong>cash</strong>, <strong>AR aging</strong>, <strong>revenue trends</strong>, <strong>budget variance</strong>, <strong>EBITDA</strong>, <strong>pipeline</strong>, <strong>commissions</strong>, <strong>projects</strong>, <strong>HR & headcount</strong>, <strong>subscriptions / SaaS</strong>, <strong>tasks</strong>, <strong>requests</strong>, <strong>client concentration</strong>, <strong>risks</strong>, or <strong>forecasts</strong>. What do you need?`;
}

// ── Notifications ─────────────────────────────────────────────────────────────
function notifKey() { return 'af_dismissed_notifs_'+(state.user?.id||'guest'); }
function getDismissed() { try { return JSON.parse(localStorage.getItem(notifKey())||'[]'); } catch{return[];} }
function saveDismissed(arr) { localStorage.setItem(notifKey(),JSON.stringify(arr)); }

function buildNotifications() {
  const notifs = [];
  // Overdue AR
  state.ar.filter(x=>x.status==='overdue').forEach(x=>{
    notifs.push({id:'ar-'+x.id,type:'danger',icon:'💸',title:'Overdue Invoice',sub:`${x.client} — ${fmt(x.amount)} past due`});
  });
  // Renewals within 60 days
  state.clients.filter(c=>{ const d=Math.ceil((new Date(c.renewal)-TODAY)/864e5); return d>=0&&d<60; }).forEach(c=>{
    const d=Math.ceil((new Date(c.renewal)-TODAY)/864e5);
    notifs.push({id:'renew-'+c.id,type:'warning',icon:'📋',title:'Contract Renewal Due',sub:`${c.name} renews in ${d} days`});
  });
  // Upcoming tax events
  state.events.filter(e=>e.type==='tax'&&daysTo(e.date)>=0&&daysTo(e.date)<14).forEach(e=>{
    notifs.push({id:'tax-'+e.id,type:'warning',icon:'📅',title:'Tax Deadline',sub:`${e.title} — ${fmtDate(e.date)}`});
  });
  // High priority open tasks
  const urgentTasks=state.tasks.filter(t=>!t.done&&t.priority==='high'&&t.deadline&&daysTo(t.deadline)<=3);
  if (urgentTasks.length) notifs.push({id:'tasks-urgent',type:'danger',icon:'⚡',title:'Urgent Tasks',sub:`${urgentTasks.length} high priority task${urgentTasks.length>1?'s':''} due within 3 days`});
  // Liabilities due soon
  state.liabilities.forEach(cat=>(cat.breakdown||[]).filter(r=>r.dueDate&&daysTo(r.dueDate)>=0&&daysTo(r.dueDate)<7).forEach(r=>{
    notifs.push({id:'liab-'+r.id,type:'danger',icon:'🔴',title:'Liability Due Soon',sub:`${r.name} — ${fmt(r.amount)} due ${fmtDate(r.dueDate)}`});
  }));

  // Expiring documents within 30 days
  (state.files||[]).filter(f=>f.expiryDate).forEach(f=>{
    const d=Math.ceil((new Date(f.expiryDate)-TODAY)/864e5);
    if(d<0) notifs.push({id:'file-exp-'+f.id,type:'danger',icon:'📄',title:'Document Expired',sub:`${f.name} expired ${Math.abs(d)} day${Math.abs(d)!==1?'s':''} ago`});
    else if(d<=30) notifs.push({id:'file-exp-'+f.id,type:'warning',icon:'📄',title:'Document Expiring Soon',sub:`${f.name} expires in ${d} day${d!==1?'s':''}`});
  });

  // Closed Won deals with no commission record (ISSUE-10)
  const wonWithNoComm = (state.pipeline||[]).filter(d=>{
    if(d.stage!=='Closed Won') return false;
    return !(state.commissions||[]).some(c=>c.dealId===d.id||(c.dealName&&c.dealName.toLowerCase()===d.name.toLowerCase()));
  });
  if(wonWithNoComm.length) notifs.push({id:'comm-missing',type:'warning',icon:'💰',title:'Commission Record Missing',sub:`${wonWithNoComm.length} Closed Won deal${wonWithNoComm.length>1?'s':''} have no commission entry: ${wonWithNoComm.map(d=>d.name).join(', ')}`});

  // Stale pipeline deals (ISSUE-28)
  const staleDays = state.appSettings?.pipelineStaleAfterDays || 14;
  const staleDate = new Date(Date.now() - staleDays * 864e5);
  const staleDeals = (state.pipeline||[]).filter(d=>d.stage!=='Closed Won'&&d.stage!=='Closed Lost'&&(!d.lastUpdated||new Date(d.lastUpdated)<staleDate));
  if(staleDeals.length) notifs.push({id:'pipeline-stale',type:'warning',icon:'📊',title:'Stale Pipeline Deals',sub:`${staleDeals.length} deal${staleDeals.length>1?'s':''} not updated in ${staleDays}+ days — review and update stages`});

  // Filter dismissed
  const dismissed=getDismissed();
  state._notifications=notifs.filter(n=>!dismissed.includes(n.id));
  updateNotifBadge();
}

function updateNotifBadge() {
  const badge=document.getElementById('notif-badge');
  if(!badge) return;
  const count=(state._notifications||[]).length;
  badge.classList.toggle('hidden',count===0);
}

function updateHealthPill() {
  const pill  = document.getElementById('health-pill');
  const label = document.getElementById('health-pill-text');
  if (!pill) return;
  const ls = state._linked?.stats;
  if (!ls) { pill.classList.add('hidden'); return; }
  const issues = (ls.arMissingClientId||0)+(ls.arMissingRevenueType||0)+(ls.commMissingDealId||0)+(ls.wonWithoutAR||0);
  pill.classList.remove('hidden','ok','warn');
  if (issues > 0) {
    pill.classList.add('warn');
    if (label) label.textContent = `${issues} data issue${issues>1?'s':''}`;
  } else {
    pill.classList.add('ok');
    if (label) label.textContent = 'Data OK';
  }
}

function notifMarkAllRead() {
  // Visual: collapse all to a "read" state (same as dismiss for now)
  dismissAllNotifs();
}

function toggleNotifPanel() {
  const panel=document.getElementById('notif-panel');
  if(!panel) return;
  const open=panel.classList.toggle('open');
  if(open) renderNotifPanel();
}

function renderNotifPanel() {
  const list=document.getElementById('notif-list'); if(!list) return;
  const notifs=state._notifications||[];
  if(!notifs.length){list.innerHTML='<div style="padding:20px;text-align:center;font-size:12px;color:var(--text-3)">All caught up — no pending alerts.</div>';return;}
  const COLOR={danger:'var(--danger-bg)',warning:'var(--warning-bg)',info:'var(--info-bg)'};
  // Group by title for identical entries (e.g. multiple "Overdue Invoice")
  const groups = {};
  notifs.forEach(n => {
    const key = n.title;
    if (!groups[key]) groups[key] = { type:n.type, icon:n.icon, items:[] };
    groups[key].items.push(n);
  });
  let html = '';
  for (const [title, g] of Object.entries(groups)) {
    const count = g.items.length;
    if (count > 1) {
      // Collapsed group
      const ids = g.items.map(n=>`'${n.id}'`).join(',');
      html += `<div class="notif-group"><span>${g.icon} ${title}</span><span class="notif-group-count">${count}</span></div>`;
      const preview = g.items.slice(0,2);
      preview.forEach(n => {
        html += `<div class="notif-item" style="padding-left:28px">
          <div class="notif-body"><div class="notif-sub" style="font-size:11px;color:var(--text-2)">${n.sub}</div></div>
          <button class="notif-dismiss" onclick="dismissNotif('${n.id}')">×</button>
        </div>`;
      });
      if (count > 2) {
        html += `<div style="padding:4px 15px 8px 28px;font-size:10px;color:var(--text-3)">+${count-2} more · <span style="cursor:pointer;color:var(--primary);text-decoration:underline" onclick="dismissNotifGroup([${ids}])">Dismiss all</span></div>`;
      }
    } else {
      const n = g.items[0];
      html += `<div class="notif-item">
        <div class="notif-icon" style="background:${COLOR[n.type]||'var(--surface-2)'}">${n.icon}</div>
        <div class="notif-body"><div class="notif-title">${n.title}</div><div class="notif-sub">${n.sub}</div></div>
        <button class="notif-dismiss" onclick="dismissNotif('${n.id}')">×</button>
      </div>`;
    }
  }
  list.innerHTML = html;
}

function dismissNotifGroup(ids) {
  ids.forEach(id => {
    const dismissed=getDismissed(); if(!dismissed.includes(id)) dismissed.push(id); saveDismissed(dismissed);
  });
  state._notifications=(state._notifications||[]).filter(n=>!ids.includes(n.id));
  renderNotifPanel(); updateNotifBadge();
}

function dismissNotif(id) {
  const dismissed=getDismissed(); if(!dismissed.includes(id)) dismissed.push(id); saveDismissed(dismissed);
  state._notifications=(state._notifications||[]).filter(n=>n.id!==id);
  renderNotifPanel(); updateNotifBadge();
}
function dismissDashAlert(id) {
  const dismissed=getDismissed(); if(!dismissed.includes(id)) dismissed.push(id); saveDismissed(dismissed);
  renderDashboard(document.getElementById('main-content'));
}

function dismissAllNotifs() {
  const dismissed=getDismissed();
  (state._notifications||[]).forEach(n=>{ if(!dismissed.includes(n.id)) dismissed.push(n.id); });
  saveDismissed(dismissed); state._notifications=[];
  renderNotifPanel(); updateNotifBadge();
}

// ── AI Proactive popup ─────────────────────────────────────────────────────────
function showAIPopup(msg) {
  const popup=document.getElementById('ai-popup'), body=document.getElementById('ai-popup-body');
  if(!popup||!body) return;
  body.textContent=msg; popup.classList.add('show');
  setTimeout(()=>popup.classList.remove('show'), 8000);
}
function dismissAIPopup() { document.getElementById('ai-popup')?.classList.remove('show'); }

function executeBrief() {
  openAI('dashboard');
  setTimeout(() => {
    const inp = document.getElementById('ai-input');
    if (inp) { inp.value = 'Executive brief'; sendAIMsg(); }
  }, 150);
}

function triggerProactiveAI() {
  const totalCash=state.banks.reduce((a,b)=>a+b.total,0);
  const reserved=state.reserves.reduce((a,r)=>a+r.amount,0);
  const available=totalCash-reserved;
  const totalLiab=state.liabilities.reduce((s,c)=>{return s+(c.breakdown||[]).reduce((a,b)=>a+(b.amount||0),0);},0);
  const overdueAR=state.ar.filter(x=>x.status==='overdue').reduce((s,x)=>s+x.amount,0);
  const ytdRev=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.revenue,0);
  const ytdExp=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.expenses,0);
  const margin=ytdRev?Math.round(((ytdRev-ytdExp)/ytdRev)*100):0;

  if(overdueAR>50000) { showAIPopup(`You have ${fmt(overdueAR)} in overdue receivables. Consider sending reminders or escalating collections to protect cash flow.`); return; }
  if(available<300000) { showAIPopup(`Available cash is ${fmt(available)} — approaching a tight runway. Review discretionary spending and accelerate AR collection.`); return; }
  if(totalLiab>available*0.8) { showAIPopup(`Liabilities (${fmt(totalLiab)}) are approaching your available cash (${fmt(available)}). Consider cash flow planning.`); return; }
  if(margin<15) { showAIPopup(`Profit margin is ${margin}% YTD. Review your cost structure to improve profitability.`); return; }
}

// ── Auto-logout (2h inactivity) ───────────────────────────────────────────────
let _inactivityTimer = null;
const INACTIVITY_MS = 2 * 60 * 60 * 1000;
function resetInactivityTimer() {
  clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(()=>{
    logout();
    toast('Signed out due to inactivity');
  }, INACTIVITY_MS);
}
function setupInactivityTimer() {
  ['mousemove','keypress','click','touchstart'].forEach(evt=>document.addEventListener(evt, resetInactivityTimer, {passive:true}));
  resetInactivityTimer();
}

// ── Requests Page ─────────────────────────────────────────────────────────────
function renderRequests(c) {
  const items = state.requests || [];
  const cfg   = state.requestCfg || {};
  const token = cfg.token || '';
  const origin = location.origin;
  const publicUrl = `${origin}/request/${token}`;

  const rf = state._reqFilter || {};
  let filtered = items;
  if (rf.q) { const q=rf.q.toLowerCase(); filtered=filtered.filter(x=>(x.subject||'').toLowerCase().includes(q)||(x.details||'').toLowerCase().includes(q)||(x.email||'').toLowerCase().includes(q)); }
  if (rf.priority) filtered=filtered.filter(x=>x.priority===rf.priority);
  if (rf.status==='pending')  filtered=filtered.filter(x=>x.status==='pending'||x.status==='adjusted'||x.status==='adjustment_declined');
  else if (rf.status==='accepted') filtered=filtered.filter(x=>x.status==='accepted'||x.status==='adjustment_accepted');
  else if (rf.status==='rejected') filtered=filtered.filter(x=>x.status==='rejected');

  const pending  = filtered.filter(x => x.status === 'pending' || x.status === 'adjusted' || x.status === 'adjustment_declined');
  const accepted = filtered.filter(x => x.status === 'accepted' || x.status === 'adjustment_accepted');
  const rejected = filtered.filter(x => x.status === 'rejected');

  const prioBadge = p => {
    if (p === 'high')   return `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--danger-bg);color:var(--danger);font-weight:700">High</span>`;
    if (p === 'low')    return `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--success-bg);color:var(--success);font-weight:700">Low</span>`;
    return `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--warning-bg);color:var(--warning);font-weight:700">Medium</span>`;
  };
  const statusBadge = s => {
    if (s === 'accepted')             return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--success-bg);color:var(--success);font-weight:700">Accepted</span>`;
    if (s === 'rejected')             return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--danger-bg);color:var(--danger);font-weight:700">Rejected</span>`;
    if (s === 'adjusted')             return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--info-bg);color:var(--info);font-weight:700">Adjustment Sent</span>`;
    if (s === 'adjustment_accepted')  return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--success-bg);color:var(--success);font-weight:700">Adj. Accepted</span>`;
    if (s === 'adjustment_declined')  return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--danger-bg);color:var(--danger);font-weight:700">Adj. Declined</span>`;
    return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--warning-bg);color:var(--warning);font-weight:700">Pending</span>`;
  };
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';

  const rowHTML = r => `
    <tr>
      <td style="padding:12px 14px;max-width:220px">
        <div style="font-weight:600;color:var(--text);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.subject}</div>
        ${r.details ? `<div style="font-size:11px;color:var(--text-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${r.details}</div>` : ''}
      </td>
      <td style="padding:12px 14px;white-space:nowrap">${prioBadge(r.priority)}</td>
      <td style="padding:12px 14px;font-size:11px;color:var(--text-2);white-space:nowrap">${r.email||'—'}</td>
      <td style="padding:12px 14px;font-size:11px;color:var(--text-2);white-space:nowrap">${r.dueDate||'—'}</td>
      <td style="padding:12px 14px">${statusBadge(r.status)}</td>
      <td style="padding:12px 14px;font-size:11px;color:var(--text-2);white-space:nowrap">${fmtDate(r.submittedAt)}</td>
      <td style="padding:12px 14px">
        <div style="display:flex;gap:5px;justify-content:flex-end">
          <button class="btn btn-sm" style="font-size:11px" onclick="showReqDetail(${r.id})" title="View request details">View</button>
          ${r.status==='pending'||r.status==='adjustment_declined' ? `
            <button class="btn btn-sm" style="color:var(--success);border-color:rgba(22,163,74,.3);font-size:11px;font-weight:600" onclick="openReqCompose('accept',${r.id})" title="Approve this request">Approve</button>
            <button class="btn btn-sm" style="color:var(--danger);border-color:rgba(220,38,38,.3);font-size:11px;font-weight:600" onclick="openReqCompose('reject',${r.id})" title="Reject this request">Reject</button>
          ` : r.status==='adjusted' ? `
            <button class="btn btn-sm" style="font-size:11px;color:var(--info)" onclick="openAdjustReq(${r.id})">Re-adjust</button>
          ` : ''}
          <button class="btn btn-sm btn-danger" style="font-size:11px" onclick="deleteReq(${r.id})" title="Permanently delete this request">Delete</button>
        </div>
      </td>
    </tr>`;

  const tableWrap = rows => rows.length ? `
    <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">
      <table style="width:100%;border-collapse:collapse;background:var(--surface)">
        <thead><tr style="background:var(--surface-2)">
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Subject</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Priority</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Email</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Due</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Status</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Received</th>
          <th style="padding:9px 14px"></th>
        </tr></thead>
        <tbody>${rows.map(rowHTML).join('')}</tbody>
      </table>
    </div>` : `<div style="text-align:center;padding:32px;color:var(--text-2);font-size:12px">No requests in this category.</div>`;

  c.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Requests</div>
        <div class="page-sub">Manage incoming requests from clients & team members</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" style="color:var(--primary);border-color:var(--primary-bg)" onclick="openAI('requests')">✦ Ask Ayla</button>
        <button class="btn btn-primary" onclick="openReqSettings()">⚙ Form Settings</button>
      </div>
    </div>

    <!-- Share Link Card -->
    <div class="card" style="margin-bottom:18px;border:1.5px solid rgba(255,102,0,.25);background:linear-gradient(135deg,rgba(255,102,0,.04) 0%,var(--surface) 100%)">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="width:42px;height:42px;border-radius:12px;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🔗</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:3px">Public Request Link</div>
          <div style="font-size:11px;color:var(--text-2);margin-bottom:8px">Share this link with anyone — they can submit requests without needing an account.</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <code style="font-size:11px;background:var(--surface-2);border:1px solid var(--border);border-radius:7px;padding:6px 12px;color:var(--primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${publicUrl}</code>
            <button class="btn btn-sm btn-primary" onclick="copyReqLink('${publicUrl}')">📋 Copy</button>
            <button class="btn btn-sm" onclick="window.open('${publicUrl}','_blank')">↗ Open</button>
            <button class="btn btn-sm" style="color:var(--danger-text)" onclick="regenerateReqToken()">🔄 Regenerate</button>
          </div>
        </div>
      </div>
    </div>

    <!-- KPI row -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px">
      <div class="card" style="text-align:center;padding:18px">
        <div style="font-size:26px;font-weight:800;color:var(--warning);font-family:'Montserrat',sans-serif">${items.filter(x=>x.status==='pending'||x.status==='adjusted'||x.status==='adjustment_declined').length}</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:3px">Pending Review</div>
      </div>
      <div class="card" style="text-align:center;padding:18px">
        <div style="font-size:26px;font-weight:800;color:var(--success);font-family:'Montserrat',sans-serif">${items.filter(x=>x.status==='accepted'||x.status==='adjustment_accepted').length}</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:3px">Accepted</div>
      </div>
      <div class="card" style="text-align:center;padding:18px">
        <div style="font-size:26px;font-weight:800;color:var(--danger);font-family:'Montserrat',sans-serif">${items.filter(x=>x.status==='rejected').length}</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:3px">Rejected</div>
      </div>
    </div>

    <!-- Filter bar -->
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      <input class="input" style="font-size:11px;max-width:220px" placeholder="Search subject, details, email…" value="${(rf.q||'').replace(/"/g,'&quot;')}" oninput="state._reqFilter.q=this.value;renderRequests(document.getElementById('main-content'))">
      <select class="input" style="font-size:11px;max-width:130px" onchange="state._reqFilter.status=this.value;renderRequests(document.getElementById('main-content'))">
        <option value=""${!rf.status?' selected':''}>All Statuses</option>
        <option value="pending"${rf.status==='pending'?' selected':''}>Pending</option>
        <option value="accepted"${rf.status==='accepted'?' selected':''}>Accepted</option>
        <option value="rejected"${rf.status==='rejected'?' selected':''}>Rejected</option>
      </select>
      <select class="input" style="font-size:11px;max-width:130px" onchange="state._reqFilter.priority=this.value;renderRequests(document.getElementById('main-content'))">
        <option value=""${!rf.priority?' selected':''}>All Priorities</option>
        <option value="high"${rf.priority==='high'?' selected':''}>High</option>
        <option value="medium"${rf.priority==='medium'?' selected':''}>Medium</option>
        <option value="low"${rf.priority==='low'?' selected':''}>Low</option>
      </select>
      ${rf.q||rf.status||rf.priority?`<button class="btn btn-sm" style="font-size:10px" onclick="state._reqFilter={q:'',status:'',priority:''};renderRequests(document.getElementById('main-content'))">✕ Clear</button>`:''}
      <span style="font-size:11px;color:var(--text-3);margin-left:auto">${filtered.length} of ${items.length} requests</span>
    </div>

    <!-- Pending -->
    ${pending.length ? `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:13px;font-weight:700;color:var(--text)">Pending Review <span style="font-size:11px;background:var(--warning-bg);color:var(--warning);padding:2px 8px;border-radius:10px;margin-left:6px">${pending.length}</span></div>
      </div>
      ${tableWrap(pending)}
    </div>` : ''}

    <!-- Accepted -->
    ${accepted.length ? `
    <div class="card" style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px">Accepted <span style="font-size:11px;background:var(--success-bg);color:var(--success);padding:2px 8px;border-radius:10px;margin-left:6px">${accepted.length}</span></div>
      ${tableWrap(accepted)}
    </div>` : ''}

    <!-- Rejected -->
    ${rejected.length ? `
    <div class="card" style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px">Rejected <span style="font-size:11px;background:var(--danger-bg);color:var(--danger);padding:2px 8px;border-radius:10px;margin-left:6px">${rejected.length}</span></div>
      ${tableWrap(rejected)}
    </div>` : ''}

    ${items.length === 0 ? `
    <div class="card" style="text-align:center;padding:48px">
      <div style="font-size:40px;margin-bottom:12px">📥</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">No requests yet</div>
      <div style="font-size:12px;color:var(--text-2)">Share the public link above and requests will appear here for your review.</div>
    </div>` : ''}
  `;
}

let _reqActionId = null;
let _reqViewId   = null;

// ── Request View helpers ──────────────────────────────────────────────────────
function showReqDetail(id) {
  _reqViewId = id; _reqActionId = id;
  const r = (state.requests||[]).find(x=>x.id===id); if(!r) return;
  document.getElementById('req-view-title').textContent = '📋 Request Details';
  _renderReqViewPanel(r);
  openModal('modal-req-view');
}

function _renderReqViewPanel(r) {
  const fmtDt = iso => iso ? new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const prioBg  = {high:'#FEF2F2',medium:'#FFFBEB',low:'#F0FDF4'};
  const prioCol = {high:'#DC2626',medium:'#D97706',low:'#16A34A'};
  const stMap   = {pending:{lbl:'Pending',bg:'var(--warning-bg)',col:'var(--warning)'},accepted:{lbl:'Accepted',bg:'var(--success-bg)',col:'var(--success)'},rejected:{lbl:'Rejected',bg:'var(--danger-bg)',col:'var(--danger)'},adjusted:{lbl:'Adjustment Sent',bg:'var(--info-bg)',col:'var(--info)'},adjustment_accepted:{lbl:'Adj. Accepted',bg:'var(--success-bg)',col:'var(--success)'},adjustment_declined:{lbl:'Adj. Declined',bg:'var(--danger-bg)',col:'var(--danger)'}};
  const st = stMap[r.status]||{lbl:r.status,bg:'var(--surface-2)',col:'var(--text-2)'};
  const isPending = r.status==='pending'||r.status==='adjustment_declined';
  document.getElementById('req-view-body').innerHTML = `
  <div style="padding:24px 28px">
    <!-- Status row -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:22px;flex-wrap:wrap">
      <span style="font-size:11px;padding:3px 11px;border-radius:10px;background:${prioBg[r.priority]||prioBg.medium};color:${prioCol[r.priority]||prioCol.medium};font-weight:700;text-transform:capitalize">${r.priority||'medium'} priority</span>
      <span style="font-size:11px;padding:3px 11px;border-radius:10px;background:${st.bg};color:${st.col};font-weight:700">${st.lbl}</span>
      <span style="font-size:10px;color:var(--text-3);margin-left:auto">Received ${fmtDt(r.submittedAt)}</span>
    </div>
    <!-- Subject -->
    <div style="margin-bottom:20px">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:5px">Subject</div>
      <div style="font-size:20px;font-weight:800;color:var(--text);line-height:1.25">${r.subject||'—'}</div>
    </div>
    <!-- Message -->
    ${r.details ? `<div style="margin-bottom:20px">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:6px">Message</div>
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;font-size:13px;color:var(--text);line-height:1.7;white-space:pre-wrap">${r.details}</div>
    </div>` : ''}
    <!-- Meta -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
      <div style="background:var(--surface-2);border-radius:9px;padding:12px 14px;border:1px solid var(--border)">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px">From</div>
        <div style="font-size:12px;font-weight:600;color:var(--text)">${r.email||'—'}</div>
      </div>
      <div style="background:var(--surface-2);border-radius:9px;padding:12px 14px;border:1px solid var(--border)">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:4px">Requested Delivery</div>
        <div style="font-size:12px;font-weight:600;color:var(--text)">${r.dueDate||'Not specified'}</div>
      </div>
    </div>
    ${r.rejectionReason?`<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:9px;padding:12px 14px;margin-bottom:16px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#DC2626;font-weight:700;margin-bottom:4px">Rejection Reason</div><div style="font-size:12px;color:#991B1B">${r.rejectionReason}</div></div>`:''}
    ${r.note?`<div style="background:var(--info-bg);border:1px solid rgba(37,99,235,.15);border-radius:9px;padding:12px 14px;margin-bottom:16px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--info);font-weight:700;margin-bottom:4px">Response Note</div><div style="font-size:12px;color:var(--info)">${r.note}</div></div>`:''}
    <!-- No-email warning for pending -->
    ${isPending && !r.email ? `<div style="background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.25);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:var(--warning)">⚠ No email address on this request — status will update but no email will be sent to the requester.</div>` : ''}
    <!-- Actions -->
    <div style="border-top:1px solid var(--border);padding-top:18px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center">
      ${isPending ? `
        <button class="btn" style="font-size:12px;padding:8px 16px;color:var(--success);border-color:rgba(22,163,74,.35);font-weight:700" onclick="openReqCompose('accept')">✓ Accept</button>
        <button class="btn" style="font-size:12px;padding:8px 16px;color:var(--info);border-color:rgba(37,99,235,.3);font-weight:700" onclick="openAdjustReq(${r.id});closeModal('modal-req-view')">✎ Adjust</button>
        <button class="btn" style="font-size:12px;padding:8px 16px;color:var(--danger);border-color:rgba(220,38,38,.35);font-weight:700" onclick="openReqCompose('reject')">✕ Reject</button>
      ` : r.status==='accepted' ? `
        <button class="btn btn-sm" onclick="previewReqEmail('accept',${r.id})" style="font-size:11px">📧 View Sent Email</button>
        <button class="btn btn-sm" style="font-size:11px;color:var(--success);border-color:rgba(22,163,74,.3)" onclick="openReqCompose('accept')">↩ Re-send Accept</button>
      ` : r.status==='rejected' ? `
        <button class="btn btn-sm" onclick="previewReqEmail('reject',${r.id})" style="font-size:11px">📧 View Sent Email</button>
        <button class="btn btn-sm" style="font-size:11px;color:var(--danger);border-color:rgba(220,38,38,.3)" onclick="openReqCompose('reject')">↩ Re-send Reject</button>
      ` : ''}
      <button class="btn btn-sm" style="font-size:12px;padding:8px 14px" onclick="closeModal('modal-req-view')">Close</button>
    </div>
  </div>`;
}

function openReqCompose(type, id) {
  if (id) { _reqViewId = id; _reqActionId = id; }
  const r = (state.requests||[]).find(x=>x.id===_reqViewId); if(!r) return;
  const isAccept = type === 'accept';
  const today = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('req-view-title').textContent = isAccept ? '✓ Accept Request' : '✕ Reject Request';
  const defSubject = isAccept ? `Request Accepted: ${r.subject}` : `Request Update: ${r.subject}`;
  const defMsg = isAccept
    ? `Hi,\n\nGreat news! Your request has been reviewed and accepted. We will begin working on it promptly and deliver by the date indicated below.\n\nThank you for reaching out to us.`
    : `Hi,\n\nThank you for submitting your request. After careful review, we are unable to proceed with it at this time.\n\nWe appreciate your understanding and welcome you to submit a revised request or contact us if you have questions.`;

  document.getElementById('req-view-body').innerHTML = `
  <div style="display:grid;grid-template-columns:1fr 1fr;min-height:520px">
    <!-- Left: Compose -->
    <div style="padding:24px;border-right:1px solid var(--border);display:flex;flex-direction:column;gap:14px">
      <div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin-bottom:10px">Compose Email</div>
        <div style="background:${r.email?'var(--surface-2)':'rgba(234,179,8,.08)'};border:1px solid ${r.email?'var(--border)':'rgba(234,179,8,.3)'};border-radius:8px;padding:10px 12px;font-size:11px;color:var(--text-2)">
          <span style="font-weight:700;color:var(--text-3);font-size:9px;text-transform:uppercase;letter-spacing:.06em">To: </span>${r.email ? `<strong style="color:var(--text)">${r.email}</strong>` : '<em style="color:var(--warning)">⚠ No email — only status will be updated, no email sent</em>'}
        </div>
      </div>
      <div class="form-row" style="margin:0">
        <label style="font-size:10px">Email Subject</label>
        <input class="input" id="req-compose-subject" value="${defSubject.replace(/"/g,'&quot;')}" oninput="updateReqPreview('${type}')" style="font-size:12px;margin-top:4px">
      </div>
      ${isAccept ? `
      <div class="form-row" style="margin:0">
        <label style="font-size:10px">Delivery Date <span style="font-weight:400;color:var(--text-3)">(when will it be ready?)</span></label>
        <input class="input" type="date" id="req-compose-delivery" value="${r.dueDate||''}" oninput="updateReqPreview('${type}')" style="font-size:12px;margin-top:4px">
      </div>` : ''}
      <div class="form-row" style="margin:0;flex:1;display:flex;flex-direction:column">
        <label style="font-size:10px">${isAccept ? 'Message to Requester' : 'Rejection Reason / Message'}</label>
        <textarea id="req-compose-message" oninput="updateReqPreview('${type}')" style="font-size:12px;resize:vertical;flex:1;margin-top:4px;min-height:120px">${defMsg}</textarea>
      </div>
      ${!isAccept ? `
      <div class="form-row" style="margin:0">
        <label style="font-size:10px">Alternative Suggestion <span style="font-weight:400;color:var(--text-3)">(optional)</span></label>
        <textarea id="req-compose-alt" rows="2" oninput="updateReqPreview('${type}')" placeholder="e.g. Please resubmit with a narrower scope or contact us…" style="font-size:12px;resize:vertical;margin-top:4px"></textarea>
      </div>` : ''}
      <div id="req-compose-status" style="font-size:11px;min-height:16px"></div>
      <div style="display:flex;gap:8px;margin-top:auto">
        <button class="btn btn-sm" onclick="_renderReqViewPanel((state.requests||[]).find(x=>x.id===_reqViewId));document.getElementById('req-view-title').textContent='📋 Request Details'">← Back</button>
        <button class="btn btn-primary" style="${isAccept?'background:var(--success);box-shadow:none':'background:var(--danger);box-shadow:none'};font-size:12px;padding:8px 16px;flex:1" onclick="confirmSendReqAction('${type}')">
          ${r.email ? (isAccept ? '✓ Send & Accept' : '✕ Send & Reject') : (isAccept ? '✓ Accept (no email)' : '✕ Reject (no email)')}
        </button>
      </div>
    </div>
    <!-- Right: Live Preview -->
    <div style="padding:24px;background:var(--bg);overflow-y:auto">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin-bottom:12px">Live Email Preview</div>
      <div id="req-email-preview" style="border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"></div>
    </div>
  </div>`;

  updateReqPreview(type);
  // ensure modal is open
  if (!document.getElementById('modal-req-view').classList.contains('open')) openModal('modal-req-view');
}

function updateReqPreview(type) {
  const c = document.getElementById('req-email-preview'); if(!c) return;
  const r = (state.requests||[]).find(x=>x.id===_reqViewId); if(!r) return;
  const subject  = document.getElementById('req-compose-subject')?.value || '';
  const message  = document.getElementById('req-compose-message')?.value || '';
  const delivery = document.getElementById('req-compose-delivery')?.value || '';
  const alt      = document.getElementById('req-compose-alt')?.value || '';
  c.innerHTML = type==='accept' ? _buildAcceptPreview(r,message,delivery) : _buildRejectPreview(r,message,alt);
}

function _buildAcceptPreview(r, message, deliveryDate) {
  const today = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const delivFmt = deliveryDate ? new Date(deliveryDate+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) : '';
  const msgHtml = (message||'').split('\n').map(l=>`<div style="margin-bottom:3px;min-height:18px">${l||'&nbsp;'}</div>`).join('');
  return `
  <div style="background:linear-gradient(135deg,#14532D 0%,#15803D 50%,#16A34A 100%);padding:28px 28px 24px">
    <div style="font-size:9px;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Request Management</div>
    <div style="width:48px;height:48px;background:rgba(255,255,255,.18);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:12px;color:#fff;text-align:center;line-height:48px">✓</div>
    <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">Request Accepted</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6)">${today}</div>
  </div>
  <div style="background:#fff;padding:24px 28px">
    <div style="font-size:13px;color:#374151;line-height:1.75;margin-bottom:20px">${msgHtml}</div>
    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px;margin-bottom:16px">
      <div style="font-size:9px;color:#15803D;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:8px">Request Details</div>
      <div style="font-size:16px;font-weight:700;color:#14532D;margin-bottom:${r.details?'8px':'0'}">${r.subject||''}</div>
      ${r.details?`<div style="font-size:12px;color:#166534;line-height:1.5;padding-top:8px;border-top:1px solid #BBF7D0">${r.details}</div>`:''}
      ${delivFmt?`<div style="font-size:11px;color:#15803D;margin-top:10px;padding-top:8px;border-top:1px solid #BBF7D0;font-weight:700">📅 Delivery: ${delivFmt}</div>`:''}
    </div>
    <div style="font-size:11px;color:#9CA3AF;line-height:1.6">We will keep you informed of progress. If you have questions, please reach out to us directly. This message was automatically generated.</div>
  </div>
  <div style="background:#0F1B2D;padding:14px 28px;text-align:center">
    <div style="font-size:12px;font-weight:700;color:#FF681A;margin-bottom:2px">Aladdin Finance</div>
    <div style="font-size:9px;color:rgba(255,255,255,.3)">Request Management System · ${new Date().getFullYear()}</div>
  </div>`;
}

function _buildRejectPreview(r, message, alternative) {
  const today = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const msgHtml = (message||'').split('\n').map(l=>`<div style="margin-bottom:3px;min-height:18px">${l||'&nbsp;'}</div>`).join('');
  return `
  <div style="background:linear-gradient(135deg,#1F2937 0%,#374151 100%);padding:28px 28px 24px">
    <div style="font-size:9px;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Aladdin Finance · Request Management</div>
    <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">Request Update</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6)">${today}</div>
  </div>
  <div style="background:#fff;padding:24px 28px">
    <div style="font-size:13px;color:#374151;line-height:1.75;margin-bottom:20px">${msgHtml}</div>
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:16px;margin-bottom:${alternative?'14px':'16px'}">
      <div style="font-size:9px;color:#DC2626;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:8px">Request</div>
      <div style="font-size:16px;font-weight:700;color:#7F1D1D">${r.subject||''}</div>
    </div>
    ${alternative?`<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:16px;margin-bottom:16px"><div style="font-size:9px;color:#C2410C;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:6px">Suggestion</div><div style="font-size:12px;color:#7C2D12;line-height:1.6">${alternative}</div></div>`:''}
    <div style="font-size:11px;color:#9CA3AF;line-height:1.6">You are welcome to submit a revised request or contact us for more details. We appreciate your understanding.</div>
  </div>
  <div style="background:#0F1B2D;padding:14px 28px;text-align:center">
    <div style="font-size:12px;font-weight:700;color:#FF681A;margin-bottom:2px">Aladdin Finance</div>
    <div style="font-size:9px;color:rgba(255,255,255,.3)">Request Management System · ${new Date().getFullYear()}</div>
  </div>`;
}

async function confirmSendReqAction(type) {
  const statusEl = document.getElementById('req-compose-status');
  const subject  = document.getElementById('req-compose-subject')?.value.trim() || '';
  const message  = document.getElementById('req-compose-message')?.value.trim() || '';
  const delivery = document.getElementById('req-compose-delivery')?.value || '';
  const alt      = document.getElementById('req-compose-alt')?.value.trim() || '';
  if (statusEl) statusEl.textContent = 'Sending…';
  try {
    const req = (state.requests||[]).find(x=>x.id===_reqViewId);
    const hasEmail = !!(req?.email);
    if (type === 'accept') {
      await apiCall(`/requests/${_reqViewId}/accept`, { method:'PUT', body: JSON.stringify({ note: message, deliveryDate: delivery, customSubject: subject }) });
      toast(hasEmail ? 'Request accepted — task created & email sent' : 'Request accepted — task created (no email address on file)');
    } else {
      await apiCall(`/requests/${_reqViewId}/reject`, { method:'PUT', body: JSON.stringify({ reason: message, alternative: alt, customSubject: subject }) });
      toast(hasEmail ? 'Request rejected — email sent' : 'Request rejected (no email address on file)');
    }
    closeModal('modal-req-view');
    const [requests, requestCfg] = await Promise.all([apiCall('/requests'), apiCall('/requests/config')]);
    Object.assign(state, { requests, requestCfg }); render();
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`;
  }
}

function openAcceptReq(id) { openReqCompose('accept', id); if(!document.getElementById('modal-req-view').classList.contains('open')) openModal('modal-req-view'); }
function openRejectReq(id) { openReqCompose('reject', id); if(!document.getElementById('modal-req-view').classList.contains('open')) openModal('modal-req-view'); }

// legacy stubs — redirect to new compose flow
function confirmAcceptReq() { confirmSendReqAction('accept'); }
function confirmRejectReq() { confirmSendReqAction('reject'); }

function openAdjustReq(id) {
  _reqActionId = id;
  const r = (state.requests || []).find(x => x.id === id);
  if (!r) return;
  document.getElementById('req-adj-subject').value  = r.adjustedSubject  || r.subject  || '';
  document.getElementById('req-adj-details').value  = r.adjustedDetails  || r.details  || '';
  document.getElementById('req-adj-duedate').value  = r.adjustedDueDate  || r.dueDate  || '';
  document.getElementById('req-adj-priority').value = r.adjustedPriority || r.priority || 'medium';
  document.getElementById('req-adj-note').value     = r.adjustNote || '';
  document.getElementById('req-adj-email-hint').textContent = r.email ? `Proposal will be emailed to: ${r.email}` : 'No email on file — adjustment will be saved but no email will be sent.';
  document.getElementById('req-adj-status').innerHTML = '';
  openModal('modal-req-adjust');
}

async function confirmAdjustReq() {
  const statusEl = document.getElementById('req-adj-status');
  const body = {
    adjustedSubject:  document.getElementById('req-adj-subject').value.trim(),
    adjustedDetails:  document.getElementById('req-adj-details').value.trim(),
    adjustedDueDate:  document.getElementById('req-adj-duedate').value.trim(),
    adjustedPriority: document.getElementById('req-adj-priority').value,
    adjustNote:       document.getElementById('req-adj-note').value.trim()
  };
  if (!body.adjustedSubject) { statusEl.innerHTML = '<span style="color:var(--danger)">Subject is required</span>'; return; }
  statusEl.textContent = 'Sending…';
  try {
    await apiCall(`/requests/${_reqActionId}/adjust`, { method: 'PUT', body: JSON.stringify(body) });
    closeModal('modal-req-adjust');
    toast('Adjustment proposal sent');
    const [requests, requestCfg] = await Promise.all([apiCall('/requests'), apiCall('/requests/config')]);
    Object.assign(state, { requests, requestCfg });
    render();
  } catch(e) {
    statusEl.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`;
  }
}

async function confirmAcceptReq() {
  const note = document.getElementById('req-accept-note').value.trim();
  const statusEl = document.getElementById('req-accept-status');
  statusEl.textContent = 'Processing…';
  try {
    await apiCall(`/requests/${_reqActionId}/accept`, { method:'PUT', body: JSON.stringify({ note }) });
    closeModal('modal-req-accept');
    toast('Request accepted — task created');
    const [requests, requestCfg] = await Promise.all([apiCall('/requests'), apiCall('/requests/config')]);
    Object.assign(state, { requests, requestCfg });
    render();
  } catch(e) {
    statusEl.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`;
  }
}

async function confirmRejectReq() {
  const reason = document.getElementById('req-reject-reason').value.trim();
  const statusEl = document.getElementById('req-reject-status');
  statusEl.textContent = 'Processing…';
  try {
    await apiCall(`/requests/${_reqActionId}/reject`, { method:'PUT', body: JSON.stringify({ reason }) });
    closeModal('modal-req-reject');
    toast('Request rejected');
    const [requests, requestCfg] = await Promise.all([apiCall('/requests'), apiCall('/requests/config')]);
    Object.assign(state, { requests, requestCfg });
    render();
  } catch(e) {
    statusEl.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`;
  }
}

async function deleteReq(id) {
  if (!confirm('Delete this request?')) return;
  await apiCall(`/requests/${id}`, { method:'DELETE' });
  state.requests = (state.requests||[]).filter(x => x.id !== id);
  render();
}

function copyReqLink(url) {
  navigator.clipboard.writeText(url).then(() => toast('Link copied!')).catch(() => toast('Copy failed'));
}

async function regenerateReqToken() {
  if (!confirm('Regenerate the link? The old link will stop working.')) return;
  try {
    const r = await apiCall('/requests/regenerate-token', { method:'POST' });
    state.requestCfg = { ...(state.requestCfg||{}), token: r.token };
    render();
    toast('New link generated');
  } catch(e) { toast('Error: '+e.message); }
}

function previewReqEmail(type, id) {
  window.open(`/api/requests/preview-${type}/${id}`, '_blank');
}

function openReqSettings() {
  const cfg = state.requestCfg || {};
  document.getElementById('req-cfg-title').value = cfg.formTitle || '';
  document.getElementById('req-cfg-desc').value  = cfg.formDesc  || '';
  const corpEl = document.getElementById('req-cfg-corp-email');
  if (corpEl) corpEl.checked = !!cfg.requireCorporateEmail;
  openModal('modal-req-settings');
}

async function saveReqSettings() {
  const title = document.getElementById('req-cfg-title').value.trim();
  const desc  = document.getElementById('req-cfg-desc').value.trim();
  const requireCorporateEmail = document.getElementById('req-cfg-corp-email')?.checked || false;
  try {
    await apiCall('/requests/config', { method:'PUT', body: JSON.stringify({ formTitle: title, formDesc: desc, requireCorporateEmail }) });
    state.requestCfg = { ...(state.requestCfg||{}), formTitle: title, formDesc: desc, requireCorporateEmail };
    closeModal('modal-req-settings');
    toast('Form settings saved');
    render();
  } catch(e) { toast('Error: '+e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
// HR SECTION
// ══════════════════════════════════════════════════════════════════════════════

function renderHR(c) {
  const emps     = state.hrEmployees  || [];
  const timeOff  = state.hrTimeOff    || [];
  const settings = state.hrSettings   || {};

  const active      = emps.filter(e => e.status === 'active');
  const onLeave     = emps.filter(e => e.status === 'on-leave');
  const pendingTOff = timeOff.filter(t => t.status === 'pending');
  const onboarding  = emps.filter(e => e.onboarding && !e.onboarding.completedAt);

  const STATUS_COL = { active:'var(--success)', 'on-leave':'var(--warning)', terminated:'var(--danger)' };
  const TYPE_COL   = { annual:'#2563EB', sick:'#DC2626', emergency:'#D97706', unpaid:'#6B7280' };

  const tabBtn = (id, label, active) =>
    `<button onclick="state.hrTab='${id}';renderHR(document.getElementById('main-content'))"
      style="padding:8px 16px;font-size:12px;font-weight:600;border:none;background:${active?'var(--primary)':'transparent'};color:${active?'#fff':'var(--text-2)'};border-radius:7px;cursor:pointer">${label}${id==='timeoff'&&pendingTOff.length?`<span style="margin-left:6px;background:rgba(255,255,255,.25);font-size:10px;padding:1px 6px;border-radius:8px">${pendingTOff.length}</span>`:''}</button>`;

  const portalLoginUrl = `${location.origin}/employee-login`;

  c.innerHTML = `
  <div class="page-header">
    <div><div class="page-title">HR</div><div class="page-sub">${emps.length} employees · ${active.length} active</div></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-sm" style="color:var(--primary);border-color:var(--primary-bg)" onclick="openAI('hr')">✦ Ask Ayla</button>
      <button class="btn btn-primary btn-sm" onclick="openAddEmployee()">+ Employee</button>
      <button class="btn btn-sm" onclick="openHRTimeOff()">+ Leave Request</button>
      <button class="btn btn-sm" style="color:var(--warning)" onclick="checkHRReminders()" title="Check & send birthday/anniversary reminders">🔔 Reminders</button>
    </div>
  </div>

  <!-- Portal login strip -->
  <div style="background:linear-gradient(90deg,#0F1B2D,#1E2D40);border-radius:10px;padding:12px 18px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:32px;height:32px;background:var(--primary);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">🔗</div>
      <div>
        <div style="font-size:12px;font-weight:700;color:#fff">Employee Portal Login</div>
        <div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:1px">${portalLoginUrl}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-sm" style="font-size:11px;background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.15)" onclick="navigator.clipboard?.writeText('${portalLoginUrl}').then(()=>toast('Link copied!'))">Copy Link</button>
      <a href="${portalLoginUrl}" target="_blank" class="btn btn-sm" style="font-size:11px;background:var(--primary);color:#fff;border-color:var(--primary);text-decoration:none">Open →</a>
    </div>
  </div>

  <!-- KPI row -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px">
    <div class="card" style="padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:var(--primary);font-family:'Montserrat',sans-serif">${emps.length}</div>
      <div style="font-size:11px;color:var(--text-2);margin-top:2px">Total Headcount</div>
    </div>
    <div class="card" style="padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:var(--success);font-family:'Montserrat',sans-serif">${active.length}</div>
      <div style="font-size:11px;color:var(--text-2);margin-top:2px">Active</div>
    </div>
    <div class="card" style="padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:var(--warning);font-family:'Montserrat',sans-serif">${pendingTOff.length}</div>
      <div style="font-size:11px;color:var(--text-2);margin-top:2px">Pending Leave</div>
    </div>
    <div class="card" style="padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:var(--info);font-family:'Montserrat',sans-serif">${onboarding.length}</div>
      <div style="font-size:11px;color:var(--text-2);margin-top:2px">Onboarding</div>
    </div>
  </div>

  <!-- Tabs -->
  <div style="display:flex;gap:4px;background:var(--surface-2);padding:4px;border-radius:10px;margin-bottom:18px;width:fit-content">
    ${tabBtn('directory', 'Directory',  state.hrTab==='directory')}
    ${tabBtn('timeoff',   'Time Off',   state.hrTab==='timeoff')}
    ${tabBtn('onboarding','Onboarding', state.hrTab==='onboarding')}
    ${tabBtn('reports',   'Reports',    state.hrTab==='reports')}
    ${tabBtn('calendar',  '📅 Calendar', state.hrTab==='calendar')}
    ${tabBtn('policy',    '📄 Policy',   state.hrTab==='policy')}
    ${tabBtn('settings',  '⚙ Settings', state.hrTab==='settings')}
  </div>

  <div id="hr-tab-content"></div>`;

  if (state.hrTab === 'directory')        _renderHRDirectory();
  else if (state.hrTab === 'timeoff')     _renderHRTimeOff();
  else if (state.hrTab === 'onboarding')  _renderHROnboarding();
  else if (state.hrTab === 'reports')     _renderHRReports();
  else if (state.hrTab === 'calendar')    _renderHRCalendar();
  else if (state.hrTab === 'policy')      _renderHRPolicy();
  else if (state.hrTab === 'settings')    _renderHRSettings();
}

function _renderHRDirectory() {
  const el = document.getElementById('hr-tab-content'); if (!el) return;
  const settings = state.hrSettings || {};
  const depts    = [...new Set((state.hrEmployees||[]).map(e=>e.department).filter(Boolean))];
  const STATUS_COL = { active:'var(--success)', 'on-leave':'var(--warning)', terminated:'var(--danger)' };
  const STATUS_BG  = { active:'var(--success-bg)', 'on-leave':'var(--warning-bg)', terminated:'var(--danger-bg)' };
  const TYPE_BADGE = t => {
    const MAP = {'full-time':'#2563EB','part-time':'#7C3AED','contractor':'#D97706','intern':'#6B7280'};
    return `<span style="font-size:10px;padding:2px 7px;border-radius:8px;background:rgba(${t==='full-time'?'37,99,235':t==='part-time'?'124,58,222':t==='contractor'?'217,119,6':'107,114,128'},.1);color:${MAP[t]||'var(--text-2)'};font-weight:600;text-transform:capitalize">${t||'—'}</span>`;
  };

  let filtered = (state.hrEmployees||[]);
  if (state._hrEmpSearch) {
    const q = state._hrEmpSearch.toLowerCase();
    filtered = filtered.filter(e => `${e.firstName} ${e.lastName} ${e.email} ${e.position} ${e.department}`.toLowerCase().includes(q));
  }
  if (state._hrEmpDept)   filtered = filtered.filter(e => e.department === state._hrEmpDept);
  if (state._hrEmpStatus) filtered = filtered.filter(e => e.status === state._hrEmpStatus);
  if (state._hrEmpType)   filtered = filtered.filter(e => e.type === state._hrEmpType);

  el.innerHTML = `
  <div class="card">
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <input class="input" style="max-width:200px;font-size:12px" placeholder="Search name, email, position…" value="${(state._hrEmpSearch||'').replace(/"/g,'&quot;')}" oninput="state._hrEmpSearch=this.value;_renderHRDirectory()">
      <select class="input" style="max-width:160px;font-size:12px" onchange="state._hrEmpDept=this.value;_renderHRDirectory()">
        <option value="">All Departments</option>
        ${depts.map(d=>`<option value="${d}"${state._hrEmpDept===d?' selected':''}>${d}</option>`).join('')}
      </select>
      <select class="input" style="max-width:130px;font-size:12px" onchange="state._hrEmpStatus=this.value;_renderHRDirectory()">
        <option value=""${!state._hrEmpStatus?' selected':''}>All Statuses</option>
        <option value="active"${state._hrEmpStatus==='active'?' selected':''}>Active</option>
        <option value="on-leave"${state._hrEmpStatus==='on-leave'?' selected':''}>On Leave</option>
        <option value="terminated"${state._hrEmpStatus==='terminated'?' selected':''}>Terminated</option>
      </select>
      <select class="input" style="max-width:130px;font-size:12px" onchange="state._hrEmpType=this.value;_renderHRDirectory()">
        <option value=""${!state._hrEmpType?' selected':''}>All Types</option>
        <option value="full-time"${state._hrEmpType==='full-time'?' selected':''}>Full-time</option>
        <option value="part-time"${state._hrEmpType==='part-time'?' selected':''}>Part-time</option>
        <option value="contractor"${state._hrEmpType==='contractor'?' selected':''}>Contractor</option>
        <option value="intern"${state._hrEmpType==='intern'?' selected':''}>Intern</option>
      </select>
      ${state._hrEmpSearch||state._hrEmpDept||state._hrEmpStatus||state._hrEmpType?`<button class="btn btn-sm" style="font-size:11px" onclick="state._hrEmpSearch='';state._hrEmpDept='';state._hrEmpStatus='';state._hrEmpType='';_renderHRDirectory()">✕ Clear</button>`:''}
      <span style="font-size:11px;color:var(--text-3);margin-left:auto">${filtered.length} employees</span>
    </div>
    ${filtered.length ? `
    <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">
      <table style="width:100%;border-collapse:collapse;background:var(--surface)">
        <thead><tr style="background:var(--surface-2)">
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Employee</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Department</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Position</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Type</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Status</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Leave</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em">Since</th>
          <th style="padding:9px 14px"></th>
        </tr></thead>
        <tbody>
        ${filtered.map(e => {
          const initials = `${(e.firstName||'?')[0]}${(e.lastName||'?')[0]}`.toUpperCase();
          const annualBal = e.leaveBalances?.annual ?? '—';
          const sickBal   = e.leaveBalances?.sick   ?? '—';
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:11px 14px">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--primary),#FF8C4A);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0">${initials}</div>
                <div>
                  <div style="font-size:12px;font-weight:600;color:var(--text)">${e.firstName} ${e.lastName}</div>
                  <div style="font-size:11px;color:var(--text-2)">${e.email||'—'}</div>
                </div>
              </div>
            </td>
            <td style="padding:11px 14px;font-size:12px;color:var(--text)">${e.department||'—'}</td>
            <td style="padding:11px 14px;font-size:12px;color:var(--text)">${e.position||'—'}</td>
            <td style="padding:11px 14px">${TYPE_BADGE(e.type)}</td>
            <td style="padding:11px 14px"><span style="font-size:11px;padding:2px 8px;border-radius:8px;background:${STATUS_BG[e.status]||'var(--surface-2)'};color:${STATUS_COL[e.status]||'var(--text-2)'};font-weight:600;text-transform:capitalize">${e.status==='terminated'?(e.terminationType||'terminated'):e.status||'—'}</span>${e.terminationDate?`<div style="font-size:10px;color:var(--text-3);margin-top:2px">${e.terminationDate}</div>`:''}</td>
            <td style="padding:11px 14px;font-size:11px;color:var(--text-2)"><span title="Annual">${annualBal}d ann</span> · <span title="Sick">${sickBal}d sick</span></td>
            <td style="padding:11px 14px;font-size:11px;color:var(--text-2)">${e.startDate||'—'}</td>
            <td style="padding:11px 14px">
              <div style="display:flex;gap:5px;justify-content:flex-end;align-items:center">
                <!-- Onboard: only when NOT started -->
                ${!e.onboarding ? `<button class="btn btn-sm" style="font-size:10px;padding:2px 9px;color:var(--primary);border-color:rgba(255,102,0,.25);font-weight:600" onclick="startOnboarding(${e.id})">▶ Onboard</button>` : ''}
                <!-- Welcome: only when NOT yet sent -->
                ${!e.welcomeEmailSent ? `<button class="btn btn-sm" style="font-size:10px;padding:2px 9px;color:#7C3AED;border-color:rgba(124,58,222,.25);font-weight:600" onclick="sendWelcomeEmail(${e.id})">✉ Welcome</button>` : ''}
                <!-- Three-dot dropdown -->
                <div style="position:relative;flex-shrink:0">
                  <button class="btn btn-sm" style="font-size:15px;padding:0 8px;line-height:1.6;font-weight:700;letter-spacing:1px;color:var(--text-2)" onclick="toggleHRDirDrop(event,${e.id})" id="hr-dir-dot-${e.id}">⋯</button>
                  <div id="hr-dir-drop-${e.id}" style="display:none;position:absolute;right:0;top:calc(100% + 4px);background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.14);z-index:10000;min-width:190px;padding:5px 0;white-space:nowrap">
                    <button class="hr-drop-item" onclick="openEditEmployee(${e.id});closeHRDirDrop()">✏️ Edit Employee</button>
                    <button class="hr-drop-item" onclick="openHRTimeOff(${e.id});closeHRDirDrop()">🏖 Leave Request</button>
                    <div style="border-top:1px solid var(--border);margin:4px 0"></div>
                    ${e.onboarding ? `<button class="hr-drop-item" onclick="openOnboarding(${e.id});closeHRDirDrop()">📋 View Onboarding</button>` : ''}
                    ${e.welcomeEmailSent ? `<button class="hr-drop-item" onclick="sendWelcomeEmail(${e.id});closeHRDirDrop()">✉ Resend Welcome</button>` : ''}
                    ${e.portalToken ? `<button class="hr-drop-item" onclick="copyPortalLink(${e.id});closeHRDirDrop()">🔗 Copy Portal Link</button>` : `<button class="hr-drop-item" onclick="sendEmployeeInvite(${e.id});closeHRDirDrop()">✉ Send Portal Invite</button>`}
                    ${e.status!=='terminated' ? `<div style="border-top:1px solid var(--border);margin:4px 0"></div><button class="hr-drop-item" style="color:var(--danger)" onclick="openTerminateEmployee(${e.id});closeHRDirDrop()">⛔ Terminate</button>` : ''}
                    <div style="border-top:1px solid var(--border);margin:4px 0"></div>
                    <button class="hr-drop-item" style="color:var(--danger)" onclick="deleteEmployee(${e.id});closeHRDirDrop()">🗑 Delete Employee</button>
                  </div>
                </div>
              </div>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>` : `<div style="text-align:center;padding:40px;color:var(--text-2);font-size:13px">No employees found.</div>`}
  </div>`;
}

function _renderHRTimeOff() {
  const el = document.getElementById('hr-tab-content'); if (!el) return;
  const timeOff  = state.hrTimeOff    || [];
  const emps     = state.hrEmployees  || [];
  const getEmp   = id => emps.find(e => e.id === id);
  const tf = state._tofFilter || {};
  let filtered = timeOff;
  if (tf.emp) { const q=tf.emp.toLowerCase(); filtered=filtered.filter(t=>{ const e=getEmp(t.employeeId); return e&&`${e.firstName} ${e.lastName}`.toLowerCase().includes(q); }); }
  if (tf.type)   filtered=filtered.filter(t=>t.type===tf.type);
  if (tf.status) filtered=filtered.filter(t=>t.status===tf.status);
  const pending  = filtered.filter(t => t.status === 'pending');
  const resolved = filtered.filter(t => t.status !== 'pending');
  const TYPE_COL = { annual:'#2563EB', sick:'#DC2626', emergency:'#D97706', unpaid:'#6B7280' };
  const fmtD     = iso => iso ? new Date(iso+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';

  const rowHTML = (t, showActions) => {
    const emp = getEmp(t.employeeId);
    const empName = emp ? `${emp.firstName} ${emp.lastName}` : `#${t.employeeId}`;
    const stBg  = { pending:'var(--warning-bg)', approved:'var(--success-bg)', rejected:'var(--danger-bg)' };
    const stCol = { pending:'var(--warning)',     approved:'var(--success)',     rejected:'var(--danger)'    };
    return `<tr style="border-top:1px solid var(--border)">
      <td style="padding:10px 14px;font-size:12px;font-weight:600;color:var(--text)">${empName}</td>
      <td style="padding:10px 14px"><span style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(${t.type==='annual'?'37,99,235':t.type==='sick'?'220,38,38':t.type==='emergency'?'217,119,6':'107,114,128'},.1);color:${TYPE_COL[t.type]||'var(--text-2)'};font-weight:600;text-transform:capitalize">${t.type}</span></td>
      <td style="padding:10px 14px;font-size:11px;color:var(--text-2)">${fmtD(t.startDate)} → ${fmtD(t.endDate)}</td>
      <td style="padding:10px 14px;font-size:12px;font-weight:600;color:var(--text)">${t.days}d</td>
      <td style="padding:10px 14px"><span style="font-size:11px;padding:2px 8px;border-radius:8px;background:${stBg[t.status]||'var(--surface-2)'};color:${stCol[t.status]||'var(--text-2)'};font-weight:600;text-transform:capitalize">${t.status}</span></td>
      <td style="padding:10px 14px">
        ${showActions ? `
          <div style="display:flex;gap:5px;justify-content:flex-end">
            <button class="btn btn-sm" style="font-size:11px;font-weight:600;color:var(--success);border-color:rgba(22,163,74,.3)" onclick="openHRAction('approve',${t.id})">✓ Approve</button>
            <button class="btn btn-sm" style="font-size:11px;font-weight:600;color:var(--danger);border-color:rgba(220,38,38,.3)" onclick="openHRAction('reject',${t.id})">✕ Reject</button>
            <button class="del-btn" onclick="deleteHRTimeOff(${t.id})">×</button>
          </div>` : `<div style="display:flex;gap:5px;justify-content:flex-end">
            <button class="del-btn" onclick="deleteHRTimeOff(${t.id})">×</button>
          </div>`}
      </td>
    </tr>`;
  };

  const tableWrap = (rows, showAct) => rows.length ? `
    <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">
      <table style="width:100%;border-collapse:collapse;background:var(--surface)">
        <thead><tr style="background:var(--surface-2)">
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase">Employee</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase">Type</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase">Period</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase">Days</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase">Status</th>
          <th style="padding:9px 14px"></th>
        </tr></thead>
        <tbody>${rows.map(t => rowHTML(t, showAct)).join('')}</tbody>
      </table>
    </div>` : `<div style="text-align:center;padding:28px;color:var(--text-2);font-size:12px">No requests here.</div>`;

  el.innerHTML = `
  <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
    <input class="input" style="font-size:11px;max-width:200px" placeholder="Search employee…" value="${(tf.emp||'').replace(/"/g,'&quot;')}" oninput="state._tofFilter.emp=this.value;_renderHRTimeOff()">
    <select class="input" style="font-size:11px;max-width:130px" onchange="state._tofFilter.type=this.value;_renderHRTimeOff()">
      <option value=""${!tf.type?' selected':''}>All Types</option>
      <option value="annual"${tf.type==='annual'?' selected':''}>Annual</option>
      <option value="sick"${tf.type==='sick'?' selected':''}>Sick</option>
      <option value="emergency"${tf.type==='emergency'?' selected':''}>Emergency</option>
      <option value="unpaid"${tf.type==='unpaid'?' selected':''}>Unpaid</option>
    </select>
    <select class="input" style="font-size:11px;max-width:130px" onchange="state._tofFilter.status=this.value;_renderHRTimeOff()">
      <option value=""${!tf.status?' selected':''}>All Statuses</option>
      <option value="pending"${tf.status==='pending'?' selected':''}>Pending</option>
      <option value="approved"${tf.status==='approved'?' selected':''}>Approved</option>
      <option value="rejected"${tf.status==='rejected'?' selected':''}>Rejected</option>
    </select>
    ${tf.emp||tf.type||tf.status?`<button class="btn btn-sm" style="font-size:10px" onclick="state._tofFilter={emp:'',type:'',status:''};_renderHRTimeOff()">✕ Clear</button>`:''}
    <button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="openHRTimeOff()">+ New Request</button>
  </div>
  ${pending.length ? `
  <div class="card" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--text)">Pending Approval <span style="background:var(--warning-bg);color:var(--warning);font-size:11px;padding:2px 8px;border-radius:8px;margin-left:6px">${pending.length}</span></div>
    </div>
    ${tableWrap(pending, true)}
  </div>` : `<div class="card" style="margin-bottom:14px;text-align:center;padding:24px">
    <div style="font-size:13px;color:var(--text-2);margin-bottom:10px">No pending leave requests</div>
    <button class="btn btn-primary btn-sm" onclick="openHRTimeOff()">+ Submit Leave Request</button>
  </div>`}
  ${resolved.length ? `
  <div class="card">
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px">History <span style="font-size:11px;color:var(--text-2);font-weight:400">(${resolved.length} resolved)</span></div>
    ${tableWrap(resolved, false)}
  </div>` : ''}`;
}

function _renderHROnboarding() {
  const el = document.getElementById('hr-tab-content'); if (!el) return;
  const active = (state.hrEmployees||[]).filter(e => e.onboarding && !e.onboarding.completedAt);
  const done   = (state.hrEmployees||[]).filter(e => e.onboarding?.completedAt);

  const boardCard = (e) => {
    const tasks   = e.onboarding.tasks || [];
    const doneN   = tasks.filter(t => t.done).length;
    const pct     = tasks.length ? Math.round((doneN/tasks.length)*100) : 0;
    const cats    = [...new Set(tasks.map(t => t.category))];
    return `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--primary),#FF8C4A);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;flex-shrink:0">${(e.firstName[0]||'?')}${(e.lastName[0]||'?')}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:var(--text)">${e.firstName} ${e.lastName}</div>
          <div style="font-size:11px;color:var(--text-2)">${e.position||''} · ${e.department||''} · Started ${e.startDate||'—'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:800;color:var(--primary)">${pct}%</div>
          <div style="font-size:10px;color:var(--text-2)">${doneN}/${tasks.length} tasks</div>
        </div>
      </div>
      <div style="background:var(--surface-2);border-radius:4px;height:6px;margin-bottom:14px;overflow:hidden">
        <div style="height:100%;background:linear-gradient(90deg,var(--primary),#FF8C4A);width:${pct}%;border-radius:4px;transition:width .3s"></div>
      </div>
      ${cats.map(cat => `
        <div style="margin-bottom:10px">
          <div style="font-size:10px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">${cat}</div>
          ${tasks.filter(t=>t.category===cat).map(t => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <div class="checkbox${t.done?' done':''}" onclick="toggleOnboardTask(${e.id},${t.id})" style="cursor:pointer;flex-shrink:0"></div>
              <div style="flex:1;font-size:12px;color:${t.done?'var(--text-3)':'var(--text)'};text-decoration:${t.done?'line-through':'none'}">${t.title}</div>
              <div style="font-size:11px;color:var(--text-3);flex-shrink:0">${t.owner}</div>
              <button onclick="removeEmpOnboardTask(${e.id},${t.id})" style="border:none;background:none;cursor:pointer;color:var(--text-3);font-size:14px;line-height:1;padding:0 2px;flex-shrink:0" title="Remove task">×</button>
            </div>`).join('')}
        </div>`).join('')}
      <!-- Add task row -->
      <div style="display:flex;gap:6px;margin-top:10px;align-items:center" id="ob-add-row-${e.id}">
        <input class="input" id="ob-task-title-${e.id}" placeholder="Add task…" style="font-size:11px;flex:1" onkeydown="if(event.key==='Enter')addEmpOnboardTask(${e.id})">
        <input class="input" id="ob-task-owner-${e.id}" placeholder="Owner" style="font-size:11px;width:80px">
        <select class="input" id="ob-task-cat-${e.id}" style="font-size:11px;width:90px">
          <option>Pre-Hire</option><option>Day 1</option><option>Week 1</option><option>Month 1</option><option>Month 3</option><option>General</option>
        </select>
        <button class="btn btn-sm btn-primary" style="font-size:11px;padding:4px 10px;flex-shrink:0" onclick="addEmpOnboardTask(${e.id})">+ Add</button>
      </div>
    </div>`;
  };

  el.innerHTML = `
  ${active.length ? active.map(boardCard).join('') : `
  <div class="card" style="text-align:center;padding:40px">
    <div style="font-size:32px;margin-bottom:12px">🎉</div>
    <div style="font-size:13px;color:var(--text-2)">No active onboardings. Click <strong>▶ Onboard</strong> on a new employee in the Directory to start one.</div>
  </div>`}
  ${done.length ? `<div class="card" style="margin-top:14px"><div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:8px">COMPLETED (${done.length})</div>${done.map(e=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)"><div style="width:28px;height:28px;border-radius:50%;background:var(--success-bg);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--success)">${(e.firstName[0]||'?')}${(e.lastName[0]||'?')}</div><span style="font-size:12px;color:var(--text)">${e.firstName} ${e.lastName}</span><span style="font-size:11px;color:var(--success);margin-left:auto">✓ Done</span></div>`).join('')}</div>` : ''}`;
}

function _renderHRReports() {
  const el   = document.getElementById('hr-tab-content'); if (!el) return;
  const emps = state.hrEmployees || [];
  const toff = state.hrTimeOff   || [];
  const cfg  = state.hrSettings  || {};
  const depts = cfg.departments || [...new Set(emps.map(e=>e.department).filter(Boolean))];
  const thisYear = new Date().getFullYear();

  const active    = emps.filter(e => e.status === 'active');
  const headByDept = depts.map(d => ({ dept: d, count: emps.filter(e => e.department === d && e.status !== 'terminated').length })).filter(x => x.count > 0);
  const totalSalary = active.reduce((s,e) => s + (e.salary||0), 0);
  // Dynamic employment types from settings + any used in employee records
  const allTypes = [...new Set([...(cfg.employmentTypes||['Full-time','Part-time','Contractor','Intern']).map(t=>t.toLowerCase().replace(/\s+/g,'-')), ...emps.map(e=>e.type).filter(Boolean)])];
  const typeBreak = allTypes.map(t=>({ type:t, count: emps.filter(e=>e.type===t&&e.status!=='terminated').length })).filter(x=>x.count>0);
  const leaveUsed = (cfg.leaveTypes||[]).map(lt => {
    const approved = toff.filter(t=>t.type===lt.id&&t.status==='approved').reduce((s,t)=>s+t.days,0);
    return { name:lt.name, days:approved, color:lt.color };
  });

  // Gender
  const males   = emps.filter(e => e.gender === 'Male'   && e.status !== 'terminated').length;
  const females = emps.filter(e => e.gender === 'Female' && e.status !== 'terminated').length;
  const other   = emps.filter(e => e.gender !== 'Male' && e.gender !== 'Female' && e.status !== 'terminated').length;
  const gTotal  = males + females + other || 1;

  // Hires this year
  const hiresThisYear = emps.filter(e => e.startDate && e.startDate.startsWith(String(thisYear))).length;
  // Departures this year
  const depsThisYear  = emps.filter(e => e.status === 'terminated' && e.terminationDate && e.terminationDate.startsWith(String(thisYear))).length;

  // Dept headcount max for bar scaling
  const maxDeptCount = headByDept.length ? Math.max(...headByDept.map(h=>h.count)) : 1;

  el.innerHTML = `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">

    <!-- Headcount by dept -->
    <div class="card">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:14px">Headcount by Department</div>
      ${headByDept.length ? headByDept.map(x=>`
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="font-size:12px;color:var(--text);min-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x.dept}</div>
          <div style="flex:1;background:var(--surface-2);border-radius:4px;height:8px;overflow:hidden">
            <div style="height:100%;background:var(--primary);width:${Math.round((x.count/maxDeptCount)*100)}%;border-radius:4px"></div>
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--text);min-width:24px;text-align:right">${x.count}</div>
        </div>`).join('') : '<div style="color:var(--text-2);font-size:12px">No departments configured — add them in Settings.</div>'}
    </div>

    <!-- Workforce Status + Payroll -->
    <div class="card">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:14px">Workforce Status</div>
      ${[{label:'Active',count:emps.filter(e=>e.status==='active').length,col:'var(--success)'},
         {label:'On Leave',count:emps.filter(e=>e.status==='on-leave').length,col:'var(--warning)'},
         {label:'Terminated / Resigned',count:emps.filter(e=>e.status==='terminated').length,col:'var(--danger)'}].map(x=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:12px;color:var(--text)">${x.label}</div>
          <div style="font-size:14px;font-weight:700;color:${x.col}">${x.count}</div>
        </div>`).join('')}
      <div style="margin-top:14px;padding:12px;background:var(--surface-2);border-radius:10px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:4px">Total Monthly Payroll (Active)</div>
        <div style="font-size:22px;font-weight:800;color:var(--primary)">${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(totalSalary)}</div>
      </div>
    </div>

    <!-- Gender distribution -->
    <div class="card">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:14px">Gender Distribution</div>
      <div style="display:flex;gap:0;border-radius:8px;overflow:hidden;height:16px;margin-bottom:16px">
        ${males   ? `<div style="flex:${males};background:#3B82F6" title="Male ${males}"></div>` : ''}
        ${females ? `<div style="flex:${females};background:#EC4899" title="Female ${females}"></div>` : ''}
        ${other   ? `<div style="flex:${other};background:#6B7280" title="Other ${other}"></div>` : ''}
      </div>
      ${[{label:'Male',count:males,col:'#3B82F6'},{label:'Female',count:females,col:'#EC4899'},{label:'Other / Not stated',count:other,col:'#6B7280'}].map(x=>`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="width:10px;height:10px;border-radius:50%;background:${x.col};flex-shrink:0"></div>
          <div style="font-size:12px;color:var(--text);flex:1">${x.label}</div>
          <div style="font-size:12px;font-weight:700;color:var(--text)">${x.count}</div>
          <div style="font-size:11px;color:var(--text-3)">${Math.round((x.count/gTotal)*100)}%</div>
        </div>`).join('')}
    </div>

    <!-- Hires & Departures -->
    <div class="card">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:14px">Movement ${thisYear}</div>
      <div style="display:flex;gap:12px;margin-bottom:16px">
        <div style="flex:1;padding:14px;background:var(--success-bg);border-radius:10px;text-align:center">
          <div style="font-size:28px;font-weight:800;color:var(--success)">${hiresThisYear}</div>
          <div style="font-size:11px;color:var(--success);margin-top:2px">Hired this year</div>
        </div>
        <div style="flex:1;padding:14px;background:var(--danger-bg);border-radius:10px;text-align:center">
          <div style="font-size:28px;font-weight:800;color:var(--danger)">${depsThisYear}</div>
          <div style="font-size:11px;color:var(--danger);margin-top:2px">Departed this year</div>
        </div>
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px">Employment Type</div>
      ${typeBreak.map(t=>`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="width:10px;height:10px;border-radius:50%;background:var(--primary);flex-shrink:0"></div>
          <div style="font-size:12px;color:var(--text);flex:1;text-transform:capitalize">${t.type}</div>
          <div style="font-size:12px;font-weight:700;color:var(--text)">${t.count}</div>
        </div>`).join('')}
    </div>

    <!-- Nationality breakdown -->
    ${(()=>{
      const natMap = {};
      emps.filter(e=>e.status!=='terminated'&&e.nationality).forEach(e=>{ natMap[e.nationality]=(natMap[e.nationality]||0)+1; });
      const natList = Object.entries(natMap).sort((a,b)=>b[1]-a[1]);
      const natMax  = natList[0]?.[1] || 1;
      return natList.length ? `
    <div class="card" style="grid-column:1/-1">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:14px">Nationality Breakdown</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
        ${natList.map(([nat,cnt])=>`
        <div style="display:flex;align-items:center;gap:8px">
          <div style="font-size:12px;color:var(--text);min-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nat}</div>
          <div style="flex:1;background:var(--surface-2);border-radius:4px;height:7px;overflow:hidden">
            <div style="height:100%;background:var(--primary);width:${Math.round((cnt/natMax)*100)}%;border-radius:4px"></div>
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--text);min-width:20px;text-align:right">${cnt}</div>
        </div>`).join('')}
      </div>
    </div>` : '';
    })()}

    <!-- Leave usage -->
    <div class="card" style="grid-column:1/-1">
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:14px">Leave Usage (Approved Days)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        ${leaveUsed.filter(l=>l.days>0).map(l=>`
          <div style="padding:12px;background:var(--surface-2);border-radius:10px;display:flex;align-items:center;gap:10px">
            <div style="width:12px;height:12px;border-radius:3px;background:${l.color||'var(--primary)'};flex-shrink:0"></div>
            <div style="flex:1;font-size:12px;color:var(--text)">${l.name}</div>
            <div style="font-size:14px;font-weight:700;color:var(--text)">${l.days}d</div>
          </div>`).join('') || '<div style="font-size:12px;color:var(--text-2)">No approved leave yet.</div>'}
      </div>
    </div>

  </div>`;
}

// ── HR Calendar ───────────────────────────────────────────────────────────────
function _renderHRCalendar() {
  const el = document.getElementById('hr-tab-content'); if (!el) return;

  const now = new Date();
  if (state._hrCalYear  == null) state._hrCalYear  = now.getFullYear();
  if (state._hrCalMonth == null) state._hrCalMonth = now.getMonth(); // 0-indexed

  const year  = state._hrCalYear;
  const month = state._hrCalMonth;

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Leave-type colour palette
  const TYPE_COLORS = {
    annual:    { bg:'#3B82F6', light:'#EFF6FF', text:'#1D4ED8' },
    sick:      { bg:'#EF4444', light:'#FEF2F2', text:'#B91C1C' },
    emergency: { bg:'#F59E0B', light:'#FFFBEB', text:'#B45309' },
    personal:  { bg:'#8B5CF6', light:'#F5F3FF', text:'#6D28D9' },
    maternity: { bg:'#EC4899', light:'#FDF2F8', text:'#BE185D' },
    paternity: { bg:'#06B6D4', light:'#ECFEFF', text:'#0E7490' },
    unpaid:    { bg:'#6B7280', light:'#F9FAFB', text:'#374151' },
  };
  function typeColor(t) { return TYPE_COLORS[t] || { bg:'#6B7280', light:'#F9FAFB', text:'#374151' }; }

  // Collect all non-rejected leave requests (both from employees and admin-created)
  const leaves = (state.hrTimeOff || []).filter(t => t.status !== 'rejected');

  // Build employees map
  const empMap = {};
  (state.hrEmployees || []).forEach(e => { empMap[e.id] = e; });

  // isoDate helper
  function isoD(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0');
  }

  // Build weeks array: each week is array of 7 Date objects (Sun–Sat)
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month+1, 0);

  // Week start: Sunday on or before firstDay
  const start = new Date(firstDay);
  start.setDate(start.getDate() - start.getDay());

  // Week end: Saturday on or after lastDay
  const end = new Date(lastDay);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const weeks = [];
  const cur = new Date(start);
  while (cur <= end) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  // Initials helper
  function initials(emp) {
    if (!emp) return '?';
    return ((emp.firstName||'')[0]||'').toUpperCase() + ((emp.lastName||'')[0]||'').toUpperCase();
  }

  // Build birthday/anniversary events for the calendar view
  const calEmps = (state.hrEmployees || []).filter(e => e.status !== 'terminated');
  const specialEvents = []; // { iso, empId, type:'birthday'|'anniversary', label, years }
  calEmps.forEach(emp => {
    if (emp.dob) {
      const iso = `${year}-${emp.dob.slice(5)}`;
      specialEvents.push({ iso, empId: emp.id, type: 'birthday', label: `🎂 ${emp.firstName}` });
    }
    if (emp.startDate && emp.startDate.slice(0,4) !== String(year)) {
      const iso   = `${year}-${emp.startDate.slice(5)}`;
      const years = year - parseInt(emp.startDate.slice(0,4), 10);
      if (years > 0) specialEvents.push({ iso, empId: emp.id, type: 'anniversary', label: `🏆 ${emp.firstName} (${years}yr)`, years });
    }
  });

  // Build bar rows for each week
  function barsForWeek(week) {
    const weekStart = isoD(week[0]);
    const weekEnd   = isoD(week[6]);

    // Find overlapping leaves
    const overlapping = leaves.filter(t => t.endDate >= weekStart && t.startDate <= weekEnd);

    // Special single-day events (birthdays / anniversaries) falling in this week
    const specials = specialEvents.filter(s => s.iso >= weekStart && s.iso <= weekEnd);

    const leaveBars = overlapping.map((t, idx) => {
      // Column start index within this week
      let colStart = 0;
      for (let i = 0; i < 7; i++) {
        if (isoD(week[i]) >= t.startDate) { colStart = i; break; }
      }
      // Column end index within this week
      let colEnd = 6;
      for (let i = 6; i >= 0; i--) {
        if (isoD(week[i]) <= t.endDate) { colEnd = i; break; }
      }

      const emp   = empMap[t.employeeId] || empMap[t.empId] || {};
      const name  = emp.firstName ? `${emp.firstName} ${emp.lastName}` : (t.employeeName || 'Employee');
      const col   = typeColor(t.type || t.leaveType);
      const leftPct  = (colStart / 7 * 100).toFixed(2);
      const widthPct = ((colEnd - colStart + 1) / 7 * 100).toFixed(2);
      const topPx    = 2 + idx * 22;
      const empId    = t.employeeId || t.empId || '';
      const reqId    = t.id || '';

      return `<div onclick="showHRCalPopup('${reqId}','${empId}',event)"
        style="position:absolute;left:${leftPct}%;width:${widthPct}%;top:${topPx}px;height:20px;
               background:${col.bg};border-radius:4px;cursor:pointer;
               display:flex;align-items:center;padding:0 6px;gap:4px;
               box-shadow:0 1px 3px rgba(0,0,0,.18);z-index:2;overflow:hidden;
               transition:filter .15s" onmouseenter="this.style.filter='brightness(1.12)'"
               onmouseleave="this.style.filter=''">
        <span style="width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,.35);
                     display:flex;align-items:center;justify-content:center;font-size:7px;
                     font-weight:700;color:#fff;flex-shrink:0">${initials(emp)}</span>
        <span style="font-size:10px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;
                     text-overflow:ellipsis">${name}</span>
      </div>`;
    });

    // Special event pills (single-day, stacked after leave bars)
    const specialBars = specials.map((s, si) => {
      const col     = s.type === 'birthday' ? '#DB2777' : '#0F766E';
      const colIdx  = week.findIndex(d => isoD(d) === s.iso);
      if (colIdx < 0) return '';
      const leftPct  = (colIdx / 7 * 100).toFixed(2);
      const topPx    = 2 + (overlapping.length + si) * 22;
      return `<div style="position:absolute;left:calc(${leftPct}% + 2px);width:calc(${(100/7).toFixed(2)}% - 4px);top:${topPx}px;height:18px;
                          background:${col};border-radius:4px;display:flex;align-items:center;padding:0 5px;gap:3px;overflow:hidden;z-index:2;
                          box-shadow:0 1px 3px rgba(0,0,0,.15)" title="${s.label}">
        <span style="font-size:10px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.label}</span>
      </div>`;
    });

    return [...leaveBars, ...specialBars].join('');
  }

  // Count max overlapping rows in any week (leaves + special events)
  function maxBarsInWeek(week) {
    const weekStart = isoD(week[0]);
    const weekEnd   = isoD(week[6]);
    return leaves.filter(t => t.endDate >= weekStart && t.startDate <= weekEnd).length
         + specialEvents.filter(s => s.iso >= weekStart && s.iso <= weekEnd).length;
  }

  // Today iso
  const todayIso = isoD(now);

  // Build week rows HTML
  const weeksHTML = weeks.map(week => {
    const maxBars = maxBarsInWeek(week);
    const barAreaH = Math.max(28, 2 + maxBars * 22 + 4);

    const dateCells = week.map(day => {
      const iso       = isoD(day);
      const inMonth   = day.getMonth() === month;
      const isToday   = iso === todayIso;
      const isSun     = day.getDay() === 0;
      const isSat     = day.getDay() === 6;
      const isWeekend = isSun || isSat;
      return `<td style="width:14.285%;padding:4px 6px 2px;vertical-align:top;
                         border-right:1px solid var(--border);
                         background:${isWeekend ? 'rgba(0,0,0,.018)' : 'transparent'}">
        <span style="display:inline-flex;align-items:center;justify-content:center;
                     width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:600;
                     ${isToday ? 'background:var(--primary);color:#fff;' :
                       inMonth ? 'color:var(--text);' : 'color:var(--text-3);'}">${day.getDate()}</span>
      </td>`;
    }).join('');

    const barRow = `<tr>
      <td colspan="7" style="padding:0;position:relative;height:${barAreaH}px;
                              border-bottom:1px solid var(--border)">
        <div style="position:relative;width:100%;height:${barAreaH}px">
          ${barsForWeek(week)}
        </div>
      </td>
    </tr>`;

    return `<tr style="border-bottom:1px solid var(--border)">${dateCells}</tr>${barRow}`;
  }).join('');

  // Legend: unique leave types in current view
  const typesInView = [...new Set(
    leaves.filter(t => t.endDate >= isoD(weeks[0][0]) && t.startDate <= isoD(weeks[weeks.length-1][6]))
          .map(t => t.type || t.leaveType || 'annual')
  )];
  const legendHTML = Object.keys(TYPE_COLORS).map(type => {
    const col = TYPE_COLORS[type];
    return `<div style="display:flex;align-items:center;gap:5px">
      <span style="width:10px;height:10px;border-radius:2px;background:${col.bg};flex-shrink:0"></span>
      <span style="font-size:11px;color:var(--text-2);text-transform:capitalize">${type}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
  <div class="card" style="padding:0;overflow:hidden">

    <!-- Calendar header -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn" style="padding:5px 10px;font-size:13px" onclick="hrCalNav(-1)">‹</button>
        <span style="font-size:16px;font-weight:700;color:var(--text);min-width:160px;text-align:center">${MONTH_NAMES[month]} ${year}</span>
        <button class="btn" style="padding:5px 10px;font-size:13px" onclick="hrCalNav(1)">›</button>
      </div>
      <button class="btn" style="font-size:12px;padding:5px 14px" onclick="hrCalToday()">Today</button>
    </div>

    <!-- Grid -->
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <thead>
          <tr style="background:var(--surface-2)">
            ${DAY_NAMES.map((d,i) => `<th style="width:14.285%;padding:8px 6px;font-size:11px;font-weight:600;
                color:${i===0||i===6?'var(--text-2)':'var(--text)'};text-align:left;border-right:1px solid var(--border)">${d}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${weeksHTML}</tbody>
      </table>
    </div>

    <!-- Legend -->
    <div style="display:flex;flex-wrap:wrap;gap:12px;padding:12px 20px;border-top:1px solid var(--border);align-items:center">
      <span style="font-size:11px;font-weight:600;color:var(--text-2);margin-right:4px">Leave:</span>
      ${legendHTML}
      <div style="width:1px;height:14px;background:var(--border)"></div>
      <div style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:#DB2777;flex-shrink:0"></span><span style="font-size:11px;color:var(--text-2)">🎂 Birthday</span></div>
      <div style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:#0F766E;flex-shrink:0"></span><span style="font-size:11px;color:var(--text-2)">🏆 Work Anniversary</span></div>
    </div>
  </div>

  <!-- Popup -->
  <div id="hr-cal-popup" style="display:none;position:fixed;z-index:9999;background:var(--surface);
       border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.18);
       padding:20px;min-width:280px;max-width:340px" onclick="event.stopPropagation()">
  </div>`;

  document.addEventListener('click', closeHRCalPopupOnOutside);
}

function hrCalNav(dir) {
  let m = (state._hrCalMonth || 0) + dir;
  let y = state._hrCalYear  || new Date().getFullYear();
  if (m > 11) { m = 0;  y++; }
  if (m < 0)  { m = 11; y--; }
  state._hrCalMonth = m;
  state._hrCalYear  = y;
  _renderHRCalendar();
}

function hrCalToday() {
  const now = new Date();
  state._hrCalMonth = now.getMonth();
  state._hrCalYear  = now.getFullYear();
  _renderHRCalendar();
}

function closeHRCalPopupOnOutside(e) {
  const popup = document.getElementById('hr-cal-popup');
  if (popup && popup.style.display !== 'none' && !popup.contains(e.target)) {
    popup.style.display = 'none';
    document.removeEventListener('click', closeHRCalPopupOnOutside);
  }
}

function closeHRCalPopup() {
  const popup = document.getElementById('hr-cal-popup');
  if (popup) popup.style.display = 'none';
  document.removeEventListener('click', closeHRCalPopupOnOutside);
}

function showHRCalPopup(reqId, empId, event) {
  event.stopPropagation();
  const popup = document.getElementById('hr-cal-popup');
  if (!popup) return;

  const leave = (state.hrTimeOff || []).find(t => (t.id || '') === reqId);
  const emp   = (state.hrEmployees || []).find(e => e.id === empId) || {};

  if (!leave) { popup.style.display = 'none'; return; }

  const TYPE_COLORS = {
    annual:    '#3B82F6', sick:'#EF4444', emergency:'#F59E0B',
    personal:  '#8B5CF6', maternity:'#EC4899', paternity:'#06B6D4', unpaid:'#6B7280',
  };
  const type   = leave.type || leave.leaveType || 'annual';
  const color  = TYPE_COLORS[type] || '#6B7280';
  const name   = emp.firstName ? `${emp.firstName} ${emp.lastName}` : (leave.employeeName || 'Employee');
  const inits  = ((emp.firstName||'')[0]||'?').toUpperCase() + ((emp.lastName||'')[0]||'').toUpperCase();
  const status = leave.status || 'pending';
  const STATUS_COLOR = { pending:'var(--warning)', approved:'var(--success)', rejected:'var(--danger)' };

  const days = leave.days || leave.workingDays || '?';

  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:38px;height:38px;border-radius:50%;background:${color};
                    display:flex;align-items:center;justify-content:center;font-size:14px;
                    font-weight:700;color:#fff">${inits}</div>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--text)">${name}</div>
          <div style="font-size:11px;color:var(--text-2)">${emp.position || emp.jobTitle || ''}</div>
        </div>
      </div>
      <button onclick="closeHRCalPopup()" style="background:none;border:none;cursor:pointer;
              font-size:16px;color:var(--text-2);padding:0 4px;line-height:1">✕</button>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:11px;color:var(--text-2)">Leave type</span>
        <span style="font-size:11px;font-weight:600;color:${color};text-transform:capitalize">${type}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:11px;color:var(--text-2)">Dates</span>
        <span style="font-size:11px;font-weight:600;color:var(--text)">${leave.startDate} → ${leave.endDate}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:11px;color:var(--text-2)">Working days</span>
        <span style="font-size:11px;font-weight:600;color:var(--text)">${days} day${days!==1?'s':''}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;color:var(--text-2)">Status</span>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;
                     color:${STATUS_COLOR[status]};background:${STATUS_COLOR[status]}22;
                     text-transform:capitalize">${status}</span>
      </div>
      ${leave.reason ? `<div style="padding:8px;background:var(--surface-2);border-radius:8px;
        font-size:11px;color:var(--text-2);font-style:italic">"${leave.reason}"</div>` : ''}
    </div>

    ${status === 'pending' ? `
    <div style="display:flex;gap:8px">
      <button class="btn" style="flex:1;font-size:12px;padding:7px;background:var(--success);color:#fff;border:none"
              onclick="closeHRCalPopup();openHRAction('approve','${reqId}')">✓ Approve</button>
      <button class="btn" style="flex:1;font-size:12px;padding:7px;background:var(--danger);color:#fff;border:none"
              onclick="closeHRCalPopup();openHRAction('reject','${reqId}')">✕ Reject</button>
    </div>` : ''}
  `;

  // Position popup near click
  const rect = { top: event.clientY, left: event.clientX };
  const pw = 340, ph = 280;
  let top  = rect.top + 12;
  let left = rect.left + 12;
  if (left + pw > window.innerWidth  - 20) left = rect.left - pw - 12;
  if (top  + ph > window.innerHeight - 20) top  = rect.top  - ph - 12;
  popup.style.top     = top  + 'px';
  popup.style.left    = left + 'px';
  popup.style.display = 'block';
}

// ── HR Policy Editor ──────────────────────────────────────────────────────────
function _renderHRPolicy() {
  const el  = document.getElementById('hr-tab-content'); if (!el) return;
  const cfg = state.hrSettings || {};
  const raw = (cfg.companyPolicy || '').replace(/</g,'&lt;');

  el.innerHTML = `
  <div class="card" style="padding:0;overflow:hidden">
    <!-- Toolbar -->
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface-2)">
      <button class="btn btn-sm" style="font-size:12px;min-width:28px;padding:4px 7px;font-weight:700" title="Bold" onclick="policyFmt('bold')"><b>B</b></button>
      <button class="btn btn-sm" style="font-size:12px;min-width:28px;padding:4px 7px;font-style:italic" title="Italic" onclick="policyFmt('italic')"><i>I</i></button>
      <button class="btn btn-sm" style="font-size:12px;min-width:28px;padding:4px 7px;text-decoration:underline" title="Underline" onclick="policyFmt('underline')">U</button>
      <div style="width:1px;height:20px;background:var(--border);margin:0 4px"></div>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Heading 1" onclick="policyFmt('formatBlock','h2')">H1</button>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Heading 2" onclick="policyFmt('formatBlock','h3')">H2</button>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Paragraph" onclick="policyFmt('formatBlock','p')">¶</button>
      <div style="width:1px;height:20px;background:var(--border);margin:0 4px"></div>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Bullet list" onclick="policyFmt('insertUnorderedList')">• List</button>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Numbered list" onclick="policyFmt('insertOrderedList')">1. List</button>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Horizontal rule" onclick="policyFmt('insertHorizontalRule')">─ Rule</button>
      <div style="width:1px;height:20px;background:var(--border);margin:0 4px"></div>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Align left" onclick="policyFmt('justifyLeft')">⬅</button>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Align center" onclick="policyFmt('justifyCenter')">☰</button>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Align right" onclick="policyFmt('justifyRight')">➡</button>
      <div style="width:1px;height:20px;background:var(--border);margin:0 4px"></div>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Undo" onclick="policyFmt('undo')">↩ Undo</button>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Redo" onclick="policyFmt('redo')">↪ Redo</button>
      <button class="btn btn-sm" style="font-size:12px;padding:4px 9px" title="Clear formatting" onclick="policyFmt('removeFormat')">✕ Clear</button>
      <div style="flex:1"></div>
      <button class="btn btn-primary" style="font-size:12px;padding:5px 16px;font-weight:600" onclick="savePolicyEditor()">💾 Save Policy</button>
    </div>
    <!-- Style overrides for rich editor -->
    <style>
      #hr-policy-editor { outline:none; min-height:520px; padding:28px 36px; font-size:13px; line-height:1.85; color:var(--text); font-family:'Barlow','Segoe UI',sans-serif; }
      #hr-policy-editor h2 { font-size:18px; font-weight:700; margin:20px 0 8px; color:var(--text); }
      #hr-policy-editor h3 { font-size:14px; font-weight:700; margin:16px 0 6px; color:var(--text); }
      #hr-policy-editor p  { margin:0 0 10px; }
      #hr-policy-editor ul,#hr-policy-editor ol { padding-left:22px; margin:8px 0; }
      #hr-policy-editor li { margin-bottom:4px; }
      #hr-policy-editor hr { border:none; border-top:1px solid var(--border); margin:16px 0; }
      #hr-policy-editor strong { font-weight:700; }
      #hr-policy-editor em { font-style:italic; }
    </style>
    <div id="hr-policy-editor" contenteditable="true" spellcheck="true">${
      // Convert plain text with \n to simple HTML if no tags present
      (cfg.companyPolicy||'').includes('<') ? (cfg.companyPolicy||'') :
      (cfg.companyPolicy||'').split('\n\n').map(para =>
        para.trim() ? `<p>${para.replace(/\n/g,'<br>')}</p>` : '<p><br></p>'
      ).join('')
    }</div>
    <div style="padding:10px 36px;border-top:1px solid var(--border);background:var(--surface-2);display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:11px;color:var(--text-3)" id="hr-policy-status">Unsaved changes will be lost if you navigate away.</span>
      <button class="btn btn-primary" style="font-size:12px;padding:5px 16px;font-weight:600" onclick="savePolicyEditor()">💾 Save Policy</button>
    </div>
  </div>`;
}

function policyFmt(cmd, val) {
  document.getElementById('hr-policy-editor')?.focus();
  document.execCommand(cmd, false, val || null);
}

async function savePolicyEditor() {
  const editor = document.getElementById('hr-policy-editor');
  if (!editor) return;
  const html = editor.innerHTML;
  const cfg  = state.hrSettings || {};
  cfg.companyPolicy = html;
  try {
    await apiCall('/hr/settings', { method:'PUT', body:JSON.stringify(cfg) });
    state.hrSettings = cfg;
    const st = document.getElementById('hr-policy-status');
    if (st) { st.textContent = '✓ Saved'; st.style.color = 'var(--success)'; setTimeout(()=>{ st.textContent='Unsaved changes will be lost if you navigate away.'; st.style.color=''; },2500); }
    toast('Policy saved');
  } catch(e) { toast('Error: '+e.message); }
}

// ── Termination ───────────────────────────────────────────────────────────────
let _hrTermEmpId = null;

function openTerminateEmployee(id) {
  const emp = (state.hrEmployees||[]).find(e => e.id === id);
  if (!emp) return;
  _hrTermEmpId = id;
  const inits = ((emp.firstName||'')[0]||'').toUpperCase() + ((emp.lastName||'')[0]||'').toUpperCase();
  document.getElementById('hr-term-avatar').textContent = inits;
  document.getElementById('hr-term-name').textContent   = `${emp.firstName} ${emp.lastName}`;
  document.getElementById('hr-term-role').textContent   = [emp.position, emp.department].filter(Boolean).join(' · ') || 'Employee';
  document.getElementById('hr-term-reason').value  = '';
  document.getElementById('hr-term-notice').value  = '';
  document.getElementById('hr-term-rehire').checked = true;
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('hr-term-date').value     = today;
  document.getElementById('hr-term-last-day').value = today;
  setSelectValue(document.getElementById('hr-term-type'), emp.terminationType || 'terminated');
  openModal('modal-hr-terminate');
}

async function saveTermination() {
  const id = _hrTermEmpId;
  if (!id) return;
  const type         = document.getElementById('hr-term-type').value;
  const date         = document.getElementById('hr-term-date').value;
  const lastWorkDay  = document.getElementById('hr-term-last-day').value;
  const reason       = document.getElementById('hr-term-reason').value.trim();
  const noticePeriod = document.getElementById('hr-term-notice').value.trim();
  const rehire       = document.getElementById('hr-term-rehire').checked;
  if (!reason) { toast('Please enter a reason'); return; }
  try {
    const r = await apiCall(`/hr/${id}/terminate`, { method:'POST', body: JSON.stringify({ type, date, lastWorkingDay: lastWorkDay, reason, noticePeriod, rehireEligible: rehire }) });
    const i = state.hrEmployees.findIndex(e => e.id === id);
    if (i > -1) state.hrEmployees[i] = r.employee;
    closeModal('modal-hr-terminate');
    renderHR(document.getElementById('main-content'));
    toast('Employee status updated');
  } catch(e) { toast('Error: '+e.message); }
}

// ── Onboarding task management ────────────────────────────────────────────────
async function addEmpOnboardTask(empId) {
  const title = document.getElementById(`ob-task-title-${empId}`)?.value.trim();
  const owner = document.getElementById(`ob-task-owner-${empId}`)?.value.trim() || 'HR';
  const cat   = document.getElementById(`ob-task-cat-${empId}`)?.value || 'General';
  if (!title) { toast('Enter a task title'); return; }
  try {
    const r = await apiCall(`/hr/${empId}/onboarding/task`, { method:'POST', body: JSON.stringify({ title, owner, category: cat }) });
    const i = state.hrEmployees.findIndex(e => e.id === empId);
    if (i > -1) state.hrEmployees[i].onboarding = r.onboarding;
    _renderHROnboarding();
  } catch(e) { toast('Error: '+e.message); }
}

async function removeEmpOnboardTask(empId, taskId) {
  try {
    await apiCall(`/hr/${empId}/onboarding/${taskId}`, { method:'DELETE' });
    const i = state.hrEmployees.findIndex(e => e.id === empId);
    if (i > -1 && state.hrEmployees[i].onboarding) {
      state.hrEmployees[i].onboarding.tasks = state.hrEmployees[i].onboarding.tasks.filter(t => t.id !== taskId);
    }
    _renderHROnboarding();
  } catch(e) { toast('Error: '+e.message); }
}

// ── HR Settings ───────────────────────────────────────────────────────────────
function _renderHRSettings() {
  const el  = document.getElementById('hr-tab-content'); if (!el) return;
  const cfg = state.hrSettings || {};
  const depts   = cfg.departments    || [];
  const pos     = cfg.positions      || [];
  const tasks   = cfg.defaultOnboardingTasks || [];
  const ltypes  = cfg.leaveTypes     || [];
  const empTypes= cfg.employmentTypes|| ['Full-time','Part-time','Contractor','Intern'];

  el.innerHTML = `
  <!-- Sticky save bar -->
  <div style="position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;
              padding:10px 16px;margin-bottom:16px;border-radius:12px;
              background:var(--surface);border:1px solid var(--border);
              box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="font-size:13px;font-weight:700;color:var(--text)">⚙ HR Settings</div>
    <button class="btn btn-primary" onclick="saveHRSettings()" style="font-size:12px;padding:7px 18px;font-weight:600">
      💾 Save Settings
    </button>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start">

    <!-- Left column -->
    <div style="display:flex;flex-direction:column;gap:18px">

      <!-- HR & Finance emails -->
      <div class="card">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:16px">📧 Notification Emails</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">HR Email (receives leave & request alerts)</label>
            <input type="email" class="input" id="hrs-hr-email" value="${(cfg.hrEmail||'').replace(/"/g,'&quot;')}" placeholder="hr@company.com">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Finance Email (receives finance requests)</label>
            <input type="email" class="input" id="hrs-fin-email" value="${(cfg.financeEmail||'').replace(/"/g,'&quot;')}" placeholder="finance@company.com">
          </div>
        </div>
      </div>

      <!-- Departments -->
      <div class="card">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px">🏢 Departments</div>
        <div id="hrs-dept-chips" style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px">
          ${depts.map((d,i)=>`<span style="display:inline-flex;align-items:center;gap:5px;background:var(--surface-2);border:1px solid var(--border);padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500">
            ${d}<button onclick="hrRemoveItem('departments',${i})" style="border:none;background:none;cursor:pointer;color:var(--text-2);font-size:13px;line-height:1;padding:0">×</button>
          </span>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <input class="input" id="hrs-dept-new" placeholder="New department…" style="font-size:12px" onkeydown="if(event.key==='Enter')hrAddItem('departments','hrs-dept-new')">
          <button class="btn btn-sm btn-primary" onclick="hrAddItem('departments','hrs-dept-new')">Add</button>
        </div>
      </div>

      <!-- Positions -->
      <div class="card">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px">👤 Positions</div>
        <div id="hrs-pos-chips" style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px">
          ${pos.map((p,i)=>`<span style="display:inline-flex;align-items:center;gap:5px;background:var(--surface-2);border:1px solid var(--border);padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500">
            ${p}<button onclick="hrRemoveItem('positions',${i})" style="border:none;background:none;cursor:pointer;color:var(--text-2);font-size:13px;line-height:1;padding:0">×</button>
          </span>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <input class="input" id="hrs-pos-new" placeholder="New position…" style="font-size:12px" onkeydown="if(event.key==='Enter')hrAddItem('positions','hrs-pos-new')">
          <button class="btn btn-sm btn-primary" onclick="hrAddItem('positions','hrs-pos-new')">Add</button>
        </div>
      </div>

      <!-- Employment Types -->
      <div class="card">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px">💼 Employment Types</div>
        <div id="hrs-emptype-chips" style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px">
          ${empTypes.map((t,i)=>`<span style="display:inline-flex;align-items:center;gap:5px;background:var(--surface-2);border:1px solid var(--border);padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500">
            ${t}<button onclick="hrRemoveItem('employmentTypes',${i})" style="border:none;background:none;cursor:pointer;color:var(--text-2);font-size:13px;line-height:1;padding:0">×</button>
          </span>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <input class="input" id="hrs-emptype-new" placeholder="New type (e.g. Milestone)…" style="font-size:12px" onkeydown="if(event.key==='Enter')hrAddItem('employmentTypes','hrs-emptype-new')">
          <button class="btn btn-sm btn-primary" onclick="hrAddItem('employmentTypes','hrs-emptype-new')">Add</button>
        </div>
      </div>

    </div>

    <!-- Right column -->
    <div style="display:flex;flex-direction:column;gap:18px">

      <!-- Company Policy link -->
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:13px;font-weight:700;color:var(--text)">📄 Company Policy</div>
          <button class="btn btn-sm btn-primary" onclick="state.hrTab='policy';renderHR(document.getElementById('main-content'))">Open Editor →</button>
        </div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.6">Edit and format the company policy document that employees see in the portal. Use the dedicated policy editor for full text tools.</div>
      </div>

    </div>
  </div>

  `;
}

function hrAddItem(field, inputId) {
  const el  = document.getElementById(inputId);
  const val = el?.value.trim();
  if (!val) return;
  const cfg = state.hrSettings || {};
  cfg[field] = [...(cfg[field]||[]), val];
  state.hrSettings = cfg;
  el.value = '';
  _renderHRSettings();
}

function hrRemoveItem(field, idx) {
  const cfg = state.hrSettings || {};
  cfg[field] = (cfg[field]||[]).filter((_,i) => i !== idx);
  state.hrSettings = cfg;
  _renderHRSettings();
}

function hrAddOnboardTask() {
  const title = document.getElementById('hrs-task-title')?.value.trim();
  const cat   = document.getElementById('hrs-task-cat')?.value  || 'Day 1';
  const owner = document.getElementById('hrs-task-owner')?.value.trim() || 'HR';
  if (!title) { toast('Task title required'); return; }
  const cfg = state.hrSettings || {};
  cfg.defaultOnboardingTasks = [...(cfg.defaultOnboardingTasks||[]), { title, category: cat, owner }];
  state.hrSettings = cfg;
  document.getElementById('hrs-task-title').value = '';
  _renderHRSettings();
}

function hrRemoveOnboardTask(idx) {
  const cfg = state.hrSettings || {};
  cfg.defaultOnboardingTasks = (cfg.defaultOnboardingTasks||[]).filter((_,i) => i !== idx);
  state.hrSettings = cfg;
  _renderHRSettings();
}

async function saveHRSettings() {
  const cfg = state.hrSettings || {};
  cfg.hrEmail      = document.getElementById('hrs-hr-email')?.value.trim()  || '';
  cfg.financeEmail = document.getElementById('hrs-fin-email')?.value.trim() || '';
  try {
    await apiCall('/hr/settings', { method:'PUT', body:JSON.stringify(cfg) });
    state.hrSettings = cfg;
    toast('HR settings saved');
  } catch(e) { toast('Error: ' + e.message); }
}

// ── Employee CRUD ─────────────────────────────────────────────────────────────
function _populateHREmpModal() {
  const settings = state.hrSettings || {};
  const deptEl   = document.getElementById('hr-emp-dept');
  const posEl    = document.getElementById('hr-emp-pos');
  const mgrEl    = document.getElementById('hr-emp-manager');
  const typeEl   = document.getElementById('hr-emp-type');
  if (deptEl) {
    deptEl.innerHTML = '<option value="">Select…</option>' + (settings.departments||[]).map(d=>`<option value="${d}">${d}</option>`).join('');
  }
  if (posEl) {
    posEl.innerHTML = '<option value="">Select…</option>' + (settings.positions||[]).map(p=>`<option value="${p}">${p}</option>`).join('');
  }
  if (mgrEl) {
    mgrEl.innerHTML = '<option value="">No manager</option>' + (state.hrEmployees||[]).map(e=>`<option value="${e.id}">${e.firstName} ${e.lastName}</option>`).join('');
  }
  if (typeEl) {
    const types = settings.employmentTypes || ['Full-time','Part-time','Contractor','Intern'];
    typeEl.innerHTML = types.map(t => `<option value="${t.toLowerCase().replace(/\s+/g,'-')}">${t}</option>`).join('');
  }
  // Leave balance fields
  const leaveEl = document.getElementById('hr-emp-leave-fields');
  if (leaveEl) {
    leaveEl.innerHTML = (settings.leaveTypes||[]).map(lt=>`
      <div class="form-row" style="margin:0">
        <label>${lt.name} <span style="font-size:10px;color:var(--text-2)">(days)</span></label>
        <input type="number" class="input" id="hr-emp-bal-${lt.id}" min="0" value="${lt.defaultDays}">
      </div>`).join('');
  }
}

function switchHrEmpTab(tab) {
  state.hrEmpTab = tab;
  ['personal','job','leave'].forEach(t => {
    const panel = document.getElementById(`hr-emp-panel-${t}`);
    const btn   = document.getElementById(`hr-emp-tab-${t}`);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (btn) {
      btn.style.borderBottomColor = t === tab ? 'var(--primary)' : 'transparent';
      btn.style.color = t === tab ? 'var(--primary)' : 'var(--text-2)';
    }
  });
}

function hrCalcSalary() {
  const hours  = parseFloat(document.getElementById('hr-emp-hours')?.value)  || 0;
  const salary = parseFloat(document.getElementById('hr-emp-salary')?.value) || 0;
  const rateEl = document.getElementById('hr-emp-rate');
  if (hours > 0 && salary > 0 && rateEl) {
    rateEl.value = (salary / hours).toFixed(2);
  } else if (rateEl) {
    rateEl.value = '';
  }
}

function openAddEmployee() {
  ['hr-emp-first','hr-emp-last','hr-emp-email','hr-emp-phone','hr-emp-nationality',
   'hr-emp-dob','hr-emp-empid','hr-emp-salary','hr-emp-hours','hr-emp-rate','hr-emp-notes'].forEach(id => { const el=document.getElementById(id); if(el) { el.value=''; el.readOnly = id==='hr-emp-rate'; } });
  document.getElementById('hr-emp-gender').value  = '';
  document.getElementById('hr-emp-type').value    = 'full-time';
  document.getElementById('hr-emp-status').value  = 'active';
  document.getElementById('hr-emp-currency').value= 'AED';
  document.getElementById('hr-emp-start').value   = '';
  document.getElementById('hr-emp-modal-title').textContent = 'Add Employee';
  document.getElementById('hr-emp-save-btn').textContent    = 'Add Employee';
  delete document.getElementById('modal-hr-emp').dataset.editId;
  _populateHREmpModal();
  switchHrEmpTab('personal');
  openModal('modal-hr-emp');
}

function openEditEmployee(id) {
  const e = (state.hrEmployees||[]).find(x => x.id === id); if (!e) return;
  document.getElementById('hr-emp-first').value       = e.firstName     || '';
  document.getElementById('hr-emp-last').value        = e.lastName      || '';
  document.getElementById('hr-emp-email').value       = e.email         || '';
  document.getElementById('hr-emp-phone').value       = e.phone         || '';
  document.getElementById('hr-emp-nationality').value = e.nationality   || '';
  document.getElementById('hr-emp-dob').value         = e.dob           || '';
  document.getElementById('hr-emp-empid').value       = e.employeeId    || '';
  document.getElementById('hr-emp-start').value       = e.startDate     || '';
  document.getElementById('hr-emp-salary').value      = e.salary        || 0;
  document.getElementById('hr-emp-hours').value       = e.hoursPerMonth || e.hoursPerWeek || '';
  document.getElementById('hr-emp-rate').value        = e.ratePerHour   || '';
  hrCalcSalary();
  document.getElementById('hr-emp-notes').value       = e.notes         || '';
  setSelectValue(document.getElementById('hr-emp-gender'),   e.gender         || '');
  setSelectValue(document.getElementById('hr-emp-type'),     e.type           || 'full-time');
  setSelectValue(document.getElementById('hr-emp-status'),   e.status         || 'active');
  setSelectValue(document.getElementById('hr-emp-currency'), e.currency       || 'AED');
  document.getElementById('hr-emp-modal-title').textContent = 'Edit Employee';
  document.getElementById('hr-emp-save-btn').textContent    = 'Save Changes';
  document.getElementById('modal-hr-emp').dataset.editId    = id;
  _populateHREmpModal();
  setSelectValue(document.getElementById('hr-emp-dept'),    e.department || '');
  setSelectValue(document.getElementById('hr-emp-pos'),     e.position   || '');
  if (e.managerId) setSelectValue(document.getElementById('hr-emp-manager'), String(e.managerId));
  // Leave balances
  (state.hrSettings?.leaveTypes||[]).forEach(lt => {
    const el = document.getElementById(`hr-emp-bal-${lt.id}`);
    if (el) el.value = e.leaveBalances?.[lt.id] ?? lt.defaultDays;
  });
  switchHrEmpTab('personal');
  openModal('modal-hr-emp');
}

async function saveEmployee() {
  const first = document.getElementById('hr-emp-first')?.value.trim();
  const last  = document.getElementById('hr-emp-last')?.value.trim();
  if (!first || !last) { toast('First and last name required'); return; }
  const leaveBalances = {};
  (state.hrSettings?.leaveTypes||[]).forEach(lt => {
    const el = document.getElementById(`hr-emp-bal-${lt.id}`);
    leaveBalances[lt.id] = el ? Number(el.value) : lt.defaultDays;
  });
  const payload = {
    firstName:   first,
    lastName:    last,
    email:       document.getElementById('hr-emp-email')?.value.trim()       || '',
    phone:       document.getElementById('hr-emp-phone')?.value.trim()       || '',
    nationality: document.getElementById('hr-emp-nationality')?.value.trim() || '',
    dob:         document.getElementById('hr-emp-dob')?.value                || '',
    gender:      document.getElementById('hr-emp-gender')?.value             || '',
    employeeId:  document.getElementById('hr-emp-empid')?.value.trim()       || '',
    startDate:   document.getElementById('hr-emp-start')?.value              || '',
    department:  document.getElementById('hr-emp-dept')?.value               || '',
    position:    document.getElementById('hr-emp-pos')?.value                || '',
    type:        document.getElementById('hr-emp-type')?.value               || 'full-time',
    status:      document.getElementById('hr-emp-status')?.value             || 'active',
    salary:          Number(document.getElementById('hr-emp-salary')?.value)    || 0,
    currency:        document.getElementById('hr-emp-currency')?.value          || 'USD',
    hoursPerMonth:   Number(document.getElementById('hr-emp-hours')?.value)     || 0,
    ratePerHour:     Number(document.getElementById('hr-emp-rate')?.value)      || 0,
    managerId:       document.getElementById('hr-emp-manager')?.value           || null,
    notes:           document.getElementById('hr-emp-notes')?.value             || '',
    leaveBalances
  };
  const editId = document.getElementById('modal-hr-emp').dataset.editId;
  try {
    if (editId) {
      const r = await apiCall(`/hr/${editId}`, { method:'PUT', body:JSON.stringify(payload) });
      const i = state.hrEmployees.findIndex(e => e.id === Number(editId));
      if (i > -1) state.hrEmployees[i] = r.employee;
      closeModal('modal-hr-emp'); renderHR(document.getElementById('main-content')); toast('Employee updated');
    } else {
      const r = await apiCall('/hr', { method:'POST', body:JSON.stringify(payload) });
      state.hrEmployees.push(r.employee);
      closeModal('modal-hr-emp'); renderHR(document.getElementById('main-content')); toast('Employee added');
    }
  } catch(e) { toast('Error: '+e.message); }
}

async function deleteEmployee(id) {
  if (!confirm('Delete this employee?')) return;
  await apiCall(`/hr/${id}`, { method:'DELETE' });
  state.hrEmployees = state.hrEmployees.filter(e => e.id !== id);
  renderHR(document.getElementById('main-content'));
}

let _hrInviteEmpId = null;

function sendEmployeeInvite(id) {
  const emp = (state.hrEmployees||[]).find(e => e.id === id);
  if (!emp) return;
  if (!emp.email) { toast('Employee has no email address'); return; }
  _hrInviteEmpId = id;

  const inits = ((emp.firstName||'')[0]||'').toUpperCase() + ((emp.lastName||'')[0]||'').toUpperCase();
  const avatarEl = document.getElementById('hr-invite-avatar');
  if (avatarEl) avatarEl.textContent = inits;
  const nameEl  = document.getElementById('hr-invite-name');
  if (nameEl)   nameEl.textContent  = `${emp.firstName} ${emp.lastName}`;
  const roleEl  = document.getElementById('hr-invite-role');
  if (roleEl)   roleEl.textContent  = [emp.position, emp.department].filter(Boolean).join(' · ') || 'Employee';
  const emailEl = document.getElementById('hr-invite-email');
  if (emailEl)  emailEl.textContent = emp.email;

  openModal('modal-hr-portal-invite');
}

async function confirmSendPortalInvite() {
  const id  = _hrInviteEmpId;
  const emp = (state.hrEmployees||[]).find(e => e.id === id);
  if (!emp) return;
  const btn = document.getElementById('hr-invite-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const r = await apiCall(`/hr/${id}/send-invite`, { method:'POST' });
    const i = state.hrEmployees.findIndex(e => e.id === id);
    if (i > -1) state.hrEmployees[i].portalToken = r.token;
    closeModal('modal-hr-portal-invite');
    renderHR(document.getElementById('main-content'));
    toast(`Portal invite sent to ${emp.email}`);
  } catch(e) {
    toast('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '✉ Send Invite'; }
  }
}

// ── Directory three-dot dropdown ──────────────────────────────────────────────
let _hrDirDropId = null;

function toggleHRDirDrop(event, id) {
  event.stopPropagation();
  const panel = document.getElementById(`hr-dir-drop-${id}`);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  closeHRDirDrop();
  if (!isOpen) {
    panel.style.display = 'block';
    _hrDirDropId = id;
    requestAnimationFrame(() => document.addEventListener('click', _onHRDirDropOutside));
  }
}

function closeHRDirDrop() {
  if (_hrDirDropId !== null) {
    const p = document.getElementById(`hr-dir-drop-${_hrDirDropId}`);
    if (p) p.style.display = 'none';
    _hrDirDropId = null;
  }
  document.removeEventListener('click', _onHRDirDropOutside);
}

function _onHRDirDropOutside(e) {
  if (_hrDirDropId !== null) {
    const panel = document.getElementById(`hr-dir-drop-${_hrDirDropId}`);
    if (panel && !panel.contains(e.target)) closeHRDirDrop();
  }
}

function sendWelcomeEmail(id) {
  const emp = (state.hrEmployees||[]).find(e => e.id === id);
  if (!emp) return;
  if (!emp.email) { toast('Employee has no email address'); return; }
  document.getElementById('welcome-to').value = `${emp.firstName} ${emp.lastName} <${emp.email}>`;
  document.getElementById('welcome-subject').value = `Welcome to Aladdin Finance, ${emp.firstName}!`;
  document.getElementById('welcome-note').value = '';
  document.getElementById('modal-welcome-email').dataset.empId = id;
  openModal('modal-welcome-email');
}

async function doSendWelcomeEmail() {
  const id = Number(document.getElementById('modal-welcome-email').dataset.empId);
  const emp = (state.hrEmployees||[]).find(e => e.id === id);
  if (!emp) return;
  const subject = document.getElementById('welcome-subject').value.trim() || `Welcome to Aladdin Finance, ${emp.firstName}!`;
  const note    = document.getElementById('welcome-note').value.trim();
  closeModal('modal-welcome-email');
  try {
    await apiCall(`/hr/${id}/welcome-email`, { method:'POST', body: JSON.stringify({ type: emp.type, subject, note }) });
    await apiCall(`/hr/${id}`, { method:'PUT', body: JSON.stringify({ welcomeEmailSent: true }) });
    const i = state.hrEmployees.findIndex(e => e.id === id);
    if (i > -1) state.hrEmployees[i].welcomeEmailSent = true;
    _renderHRDirectory();
    toast(`Welcome email sent to ${emp.email}`);
  } catch(e) { toast('Error: ' + e.message); }
}

async function checkHRReminders() {
  try {
    const r = await apiCall('/hr/check-reminders');
    if (r.sent && r.sent.length) {
      toast(`${r.sent.length} reminder email${r.sent.length>1?'s':''} sent`);
    } else {
      toast('No upcoming birthdays or anniversaries in the next 7 days');
    }
  } catch(e) { toast('Error: ' + e.message); }
}

function copyPortalLink(id) {
  const emp = (state.hrEmployees||[]).find(e => e.id === id);
  if (!emp?.portalToken) return;
  const url = `${location.origin}/employee-portal/${emp.portalToken}`;
  navigator.clipboard?.writeText(url).then(() => toast('Portal link copied!')).catch(() => {
    prompt('Copy this portal link:', url);
  });
}

// ── Time Off ──────────────────────────────────────────────────────────────────
function openHRTimeOff(empId) {
  const empEl = document.getElementById('hr-tof-emp');
  if (empEl) {
    empEl.innerHTML = '<option value="">Select employee…</option>' +
      (state.hrEmployees||[]).map(e=>`<option value="${e.id}">${e.firstName} ${e.lastName}</option>`).join('');
    if (empId) setSelectValue(empEl, String(empId));
  }
  ['hr-tof-start','hr-tof-end','hr-tof-reason'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('hr-tof-days').value = 1;
  document.getElementById('hr-tof-type').value = 'annual';
  openModal('modal-hr-timeoff');
}

async function saveHRTimeOff() {
  const empId    = document.getElementById('hr-tof-emp')?.value;
  const type     = document.getElementById('hr-tof-type')?.value;
  const startDate= document.getElementById('hr-tof-start')?.value;
  const endDate  = document.getElementById('hr-tof-end')?.value;
  const days     = document.getElementById('hr-tof-days')?.value;
  const reason   = document.getElementById('hr-tof-reason')?.value.trim();
  if (!empId)    { toast('Select an employee'); return; }
  if (!startDate){ toast('Start date required'); return; }
  if (!endDate)  { toast('End date required');   return; }
  try {
    const r = await apiCall('/hr/time-off', { method:'POST', body:JSON.stringify({ employeeId:Number(empId), type, startDate, endDate, days:Number(days)||1, reason }) });
    state.hrTimeOff.push(r.request);
    closeModal('modal-hr-timeoff');
    state.hrTab = 'timeoff';
    renderHR(document.getElementById('main-content'));
    toast('Leave request submitted');
  } catch(e) { toast('Error: '+e.message); }
}

async function deleteHRTimeOff(id) {
  await apiCall(`/hr/time-off/${id}`, { method:'DELETE' });
  state.hrTimeOff = state.hrTimeOff.filter(x => x.id !== id);
  _renderHRTimeOff();
}

// ── Approve / Reject compose modal ────────────────────────────────────────────
let _hrActionId = null;

function openHRAction(type, id) {
  _hrActionId = id;
  const req  = (state.hrTimeOff||[]).find(x => x.id === id); if (!req) return;
  const emp  = (state.hrEmployees||[]).find(e => e.id === req.employeeId);
  const name = emp ? `${emp.firstName} ${emp.lastName}` : 'Employee';
  const isApprove = type === 'approve';
  const TYPE_COL = { annual:'#2563EB', sick:'#DC2626', emergency:'#D97706', unpaid:'#6B7280' };
  const startFmt = req.startDate ? new Date(req.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
  const endFmt   = req.endDate   ? new Date(req.endDate  +'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
  const defMsg   = isApprove
    ? `Hi ${emp?.firstName||''},\n\nYour ${req.type} leave request has been approved. Enjoy your time off and please ensure your handover is complete before you leave.\n\nBest regards,\nHR Department`
    : `Hi ${emp?.firstName||''},\n\nThank you for submitting your leave request. Unfortunately we are unable to approve it at this time. Please contact HR to discuss alternative dates.\n\nBest regards,\nHR Department`;
  const defSubject = isApprove ? `Leave Approved: ${req.type} leave (${startFmt})` : `Leave Request Update: ${req.type} leave`;

  // Header color
  const hdr = document.getElementById('modal-hr-action-hdr');
  if (hdr) hdr.style.background = isApprove ? 'linear-gradient(135deg,#14532D,#16A34A)' : 'linear-gradient(135deg,#1F2937,#374151)';
  document.getElementById('hr-action-title').textContent  = isApprove ? '✓ Approve Leave' : '✕ Reject Leave';
  document.getElementById('hr-action-title').style.color  = '#fff';
  const closeBtn = document.querySelector('#modal-hr-action-hdr .modal-close');
  if (closeBtn) closeBtn.style.color = '#fff';

  document.getElementById('hr-action-body').innerHTML = `
  <div style="display:grid;grid-template-columns:1fr 1fr;min-height:480px">
    <!-- Left: compose -->
    <div style="padding:22px 20px 18px;border-right:1px solid var(--border);display:flex;flex-direction:column;gap:12px">
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:4px">To</div>
        <div style="font-size:12px;color:var(--text);font-weight:600">${name}${emp?.email?` <span style="font-size:11px;color:var(--text-2);font-weight:400">&lt;${emp.email}&gt;</span>`:' <em style="font-size:11px;color:var(--warning);font-weight:400">⚠ No email</em>'}</div>
      </div>
      <div style="background:var(--surface-2);border-radius:8px;padding:10px 12px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:4px">Leave Details</div>
        <div style="font-size:12px;color:var(--text);font-weight:600;text-transform:capitalize">${req.type} Leave · ${req.days} day${req.days!==1?'s':''}</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:2px">📅 ${startFmt} → ${endFmt}</div>
        ${req.reason?`<div style="font-size:11px;color:var(--text-2);margin-top:2px;font-style:italic">"${req.reason}"</div>`:''}
      </div>
      <div>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-2);margin-bottom:5px">Subject</div>
        <input class="input" id="hr-action-subject" value="${defSubject.replace(/"/g,'&quot;')}" oninput="updateHRActionPreview('${type}')" style="font-size:12px">
      </div>
      <div style="flex:1;display:flex;flex-direction:column">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-2);margin-bottom:5px">${isApprove?'Message':'Rejection Reason'}</div>
        <textarea id="hr-action-message" oninput="updateHRActionPreview('${type}')" style="font-size:12px;resize:vertical;flex:1;min-height:130px" class="input">${defMsg}</textarea>
      </div>
      <div id="hr-action-status" style="font-size:11px;min-height:16px"></div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="closeModal('modal-hr-action')" style="font-size:12px">Cancel</button>
        <button class="btn btn-primary" onclick="confirmHRAction('${type}')" style="font-size:12px;font-weight:700;background:${isApprove?'var(--success)':'var(--danger)'};box-shadow:none;flex:1">
          ${emp?.email ? (isApprove?'✓ Approve & Send Email':'✕ Reject & Send Email') : (isApprove?'✓ Approve (no email)':'✕ Reject (no email)')}
        </button>
      </div>
    </div>
    <!-- Right: preview -->
    <div style="padding:16px;background:var(--surface-2);overflow-y:auto">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-2);margin-bottom:10px">Live Email Preview</div>
      <div id="hr-action-preview" style="border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1);font-family:-apple-system,'Segoe UI',Arial,sans-serif"></div>
    </div>
  </div>`;

  updateHRActionPreview(type);
  openModal('modal-hr-action');
}

function updateHRActionPreview(type) {
  const req  = (state.hrTimeOff||[]).find(x => x.id === _hrActionId); if (!req) return;
  const emp  = (state.hrEmployees||[]).find(e => e.id === req.employeeId);
  const name = emp ? `${emp.firstName} ${emp.lastName}` : 'Employee';
  const msg  = document.getElementById('hr-action-message')?.value || '';
  const el   = document.getElementById('hr-action-preview'); if (!el) return;
  const startFmt = req.startDate ? new Date(req.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
  const endFmt   = req.endDate   ? new Date(req.endDate  +'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
  const TYPE_COL = { annual:'#2563EB', sick:'#DC2626', emergency:'#D97706', unpaid:'#6B7280' };
  const col = TYPE_COL[req.type]||'#2563EB';
  const isApprove = type === 'approve';
  const msgHtml = msg.split('\n').filter(Boolean).map(l=>`<div style="margin-bottom:4px">${l.replace(/</g,'&lt;')}</div>`).join('') || '<div>No message entered.</div>';

  el.innerHTML = isApprove ? `
    <div style="background:linear-gradient(135deg,#14532D,#16A34A);padding:24px 22px;text-align:center">
      <div style="width:48px;height:48px;background:rgba(255,255,255,.15);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px;font-size:22px;line-height:48px">✅</div>
      <div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:3px">Leave Approved</div>
      <div style="font-size:10px;color:rgba(255,255,255,.65)">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
    </div>
    <div style="background:#fff;padding:20px 22px">
      <div style="font-size:12px;color:#374151;line-height:1.75;margin-bottom:16px">Dear <strong>${name}</strong>,</div>
      <div style="font-size:12px;color:#374151;line-height:1.75;margin-bottom:16px">${msgHtml}</div>
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:8px;color:#15803D;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:8px">Leave Details</div>
        <div style="font-size:12px;font-weight:700;color:${col};text-transform:capitalize;margin-bottom:4px">${req.type} Leave · ${req.days}d</div>
        <div style="font-size:11px;color:#1F2937">📅 ${startFmt} → ${endFmt}</div>
      </div>
    </div>
    <div style="background:#0F1B2D;padding:12px 22px;text-align:center"><div style="font-size:11px;font-weight:800;color:#FF681A">Aladdin Finance · HR</div></div>
  ` : `
    <div style="background:linear-gradient(135deg,#1F2937,#374151);padding:24px 22px;text-align:center">
      <div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:3px">Leave Request Update</div>
      <div style="font-size:10px;color:rgba(255,255,255,.55)">${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
    </div>
    <div style="background:#fff;padding:20px 22px">
      <div style="font-size:12px;color:#374151;line-height:1.75;margin-bottom:16px">Dear <strong>${name}</strong>,</div>
      <div style="font-size:12px;color:#374151;line-height:1.75;margin-bottom:16px">${msgHtml}</div>
      <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:8px;color:#DC2626;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin-bottom:8px">Request</div>
        <div style="font-size:12px;font-weight:700;color:#7F1D1D;text-transform:capitalize;margin-bottom:4px">${req.type} Leave · ${req.days}d</div>
        <div style="font-size:11px;color:#991B1B">📅 ${startFmt} → ${endFmt}</div>
      </div>
    </div>
    <div style="background:#0F1B2D;padding:12px 22px;text-align:center"><div style="font-size:11px;font-weight:800;color:#FF681A">Aladdin Finance · HR</div></div>
  `;
}

async function confirmHRAction(type) {
  const req      = (state.hrTimeOff||[]).find(x => x.id === _hrActionId); if (!req) return;
  const subject  = document.getElementById('hr-action-subject')?.value.trim()  || '';
  const message  = document.getElementById('hr-action-message')?.value.trim()  || '';
  const statusEl = document.getElementById('hr-action-status');
  if (statusEl) statusEl.textContent = 'Sending…';
  try {
    const endpoint = `/hr/time-off/${_hrActionId}/${type}`;
    const body = type === 'approve'
      ? { note: message, customSubject: subject }
      : { reason: message, customSubject: subject };
    await apiCall(endpoint, { method:'PUT', body:JSON.stringify(body) });
    // Update local state
    const i = state.hrTimeOff.findIndex(x => x.id === _hrActionId);
    if (i > -1) {
      state.hrTimeOff[i].status = type === 'approve' ? 'approved' : 'rejected';
      if (type === 'approve') state.hrTimeOff[i].approvalNote = message;
      else state.hrTimeOff[i].rejectionReason = message;
      // Update employee balance locally
      if (type === 'approve') {
        const empI = state.hrEmployees.findIndex(e => e.id === req.employeeId);
        if (empI > -1) {
          const bal = state.hrEmployees[empI].leaveBalances || {};
          if (bal[req.type] !== undefined) bal[req.type] = Math.max(0, bal[req.type] - req.days);
        }
      }
    }
    closeModal('modal-hr-action');
    renderHR(document.getElementById('main-content'));
    const emp = (state.hrEmployees||[]).find(e=>e.id===req.employeeId);
    toast(type==='approve'
      ? `Leave approved${emp?.email?' — email sent':''}`
      : `Leave rejected${emp?.email?' — email sent':''}`);
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`;
  }
}

// ── Onboarding ────────────────────────────────────────────────────────────────
async function startOnboarding(empId) {
  try {
    const r = await apiCall(`/hr/${empId}/start-onboarding`, { method:'POST', body:'{}' });
    const i = state.hrEmployees.findIndex(e => e.id === empId);
    if (i > -1) state.hrEmployees[i].onboarding = r.onboarding;
    state.hrTab = 'onboarding';
    renderHR(document.getElementById('main-content'));
    toast('Onboarding started');
  } catch(e) { toast('Error: '+e.message); }
}

async function toggleOnboardTask(empId, taskId) {
  const emp  = state.hrEmployees.find(e => e.id === empId); if (!emp?.onboarding) return;
  const task = emp.onboarding.tasks.find(t => t.id === taskId);           if (!task) return;
  task.done  = !task.done;
  _renderHROnboarding(); // optimistic
  try {
    await apiCall(`/hr/${empId}/onboarding/${taskId}`, { method:'PATCH', body:JSON.stringify({ done: task.done }) });
    const allDone = emp.onboarding.tasks.every(t => t.done);
    if (allDone) { emp.onboarding.completedAt = new Date().toISOString(); _renderHROnboarding(); }
  } catch(e) { task.done = !task.done; _renderHROnboarding(); toast('Error: '+e.message); }
}

function openOnboarding(empId) {
  state.hrTab = 'onboarding';
  renderHR(document.getElementById('main-content'));
}

// ── Sync helpers ──────────────────────────────────────────────────────────────
async function syncSource(endpoint, label) {
  const dot=document.getElementById('sync-dot'), lbl=document.getElementById('sync-label');
  if(dot){dot.classList.add('spin');lbl.textContent='Syncing...';}
  if(window.LottieUI) LottieUI.showLoading(`Syncing ${label}…`);
  try {
    await apiCall(endpoint,{method:'POST'}); await loadAll(); render();
    if(window.LottieUI) LottieUI.showAlert(label+' Synced', 'Data is up to date.', 'success');
    else toast(label+' — sync complete');
  }
  catch(e){
    if(window.LottieUI) LottieUI.showAlert('Sync Failed', e.message, 'error');
    else toast('Sync error: '+e.message);
  }
  finally { if(dot){dot.classList.remove('spin');lbl.textContent='Updated';} if(window.LottieUI) LottieUI.hideLoading(); }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('click', e=>{
  // Close open custom select on outside click
  if (_cselOpen && !_cselOpen.panel?.contains(e.target) && !_cselOpen.trigger?.contains(e.target)) {
    _cselOpen.close();
  }
  const ni=e.target.closest('.nav-item');
  if (ni?.dataset?.section) showSection(ni.dataset.section);
  if (e.target.classList.contains('modal-backdrop')) closeModal(e.target.id);
  // Close notification panel when clicking outside
  const panel=document.getElementById('notif-panel');
  if (panel?.classList.contains('open') && !panel.contains(e.target) && !e.target.closest('.notif-btn')) {
    panel.classList.remove('open');
  }
});

document.addEventListener('keydown', e=>{
  if (e.key==='Enter'&&document.getElementById('l-pass')===document.activeElement) doLogin();
});

async function init() {
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) {
    ['login-form','register-form','forgot-form'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
    const rf = document.getElementById('reset-form');
    if (rf) rf.style.display = 'block';
    return;
  }
  const isInvite=await checkInviteToken();
  if (!isInvite&&state.token) {
    try {
      const r=await fetch('/api/auth/me',{headers:{'Authorization':'Bearer '+state.token}});
      if (r.ok){state.user=await r.json(); await showApp(); return;}
    } catch {}
    logout();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── SUBSCRIPTIONS MODULE ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const SUB_STATUS_LABEL = { active:'Active', trial:'Trial', paused:'Paused', churned:'Churned', cancelled:'Cancelled' };
const SUB_BILLING_LABEL = { monthly:'Monthly', quarterly:'Quarterly', yearly:'Yearly' };

function subStatusBadge(st) {
  return `<span class="sub-status-${st||'active'}">${SUB_STATUS_LABEL[st]||st||'Active'}</span>`;
}

function subToMRR(sub) {
  const a = Number(sub.amount)||0;
  if (sub.billing==='monthly')   return a;
  if (sub.billing==='quarterly') return a/3;
  if (sub.billing==='yearly')    return a/12;
  return 0;
}

function renderSubscriptions(c) {
  const tabs = [
    { id:'overview',      label:'📊 Overview'     },
    { id:'list',          label:'📋 Subscriptions' },
    { id:'reports',       label:'📈 Reports & KPIs'},
    { id:'reminders',     label:'🔔 Reminders'     },
    { id:'sub-settings',  label:'⚙ Settings'       }
  ];
  c.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-size:20px;font-weight:800;font-family:'Montserrat',sans-serif">Enterprise Subscriptions</div>
        <div style="font-size:12px;color:var(--text-2);margin-top:2px">SaaS recurring revenue — tracking, reminders & reporting</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" style="color:var(--primary);border-color:var(--primary-bg)" onclick="openAI('subscriptions')">✦ Ask Ayla</button>
        <button class="btn btn-primary btn-sm" onclick="openAddSub()">+ New Subscription</button>
        <button class="btn btn-sm" onclick="checkSubRenewals()" title="Check & send renewal reminders">🔔 Check Renewals</button>
      </div>
    </div>
    <div class="view-tabs" style="width:fit-content">
      ${tabs.map(t=>`<button class="view-tab${state.subTab===t.id?' active':''}" onclick="switchSubTab('${t.id}')">${t.label}</button>`).join('')}
    </div>
    <div id="sub-tab-content"></div>
  </div>`;
  _renderSubTab();
}

function switchSubTab(id) {
  state.subTab = id;
  document.querySelectorAll('.view-tab').forEach(b => b.classList.toggle('active', b.textContent.trim()===document.querySelector(`.view-tab[onclick*="${id}"]`)?.textContent.trim()));
  // re-activate correct tab button
  document.querySelectorAll('.view-tab').forEach(b => {
    const onclick = b.getAttribute('onclick')||'';
    b.classList.toggle('active', onclick.includes(`'${id}'`));
  });
  _renderSubTab();
}

function _renderSubTab() {
  const el = document.getElementById('sub-tab-content'); if (!el) return;
  if (state.subTab==='overview')     _renderSubOverview(el);
  else if (state.subTab==='list')    _renderSubList(el);
  else if (state.subTab==='reports') _renderSubReports(el);
  else if (state.subTab==='reminders') _renderSubReminders(el);
  else if (state.subTab==='sub-settings') _renderSubSettings(el);
}

// ── Overview ─────────────────────────────────────────────────────────────────
function _renderSubOverview(el) {
  const subs   = state.subscriptions||[];
  const active = subs.filter(s=>s.status==='active');
  const mrr    = active.reduce((s,x)=>s+subToMRR(x), 0);
  const arr    = mrr*12;
  const now    = new Date();
  const in30   = new Date(now); in30.setDate(now.getDate()+30);
  const renewalsDue = active.filter(s=>{ if(!s.renewalDate) return false; const d=new Date(s.renewalDate+'T00:00:00'); return d>=now&&d<=in30; });
  const churned = subs.filter(s=>s.status==='churned'||s.status==='cancelled');
  const churnRate = (active.length+churned.length) ? (churned.length/(active.length+churned.length)*100).toFixed(1) : 0;

  const fmtD = iso => iso ? new Date(iso+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
  const daysUntil = iso => Math.round((new Date(iso+'T00:00:00')-now)/86400000);

  el.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">
    <div class="sub-kpi" style="border-top:3px solid #FF6600">
      <div class="sub-kpi-label">MRR</div>
      <div class="sub-kpi-value">${fmt(Math.round(mrr))}</div>
      <div class="sub-kpi-sub">Monthly Recurring Revenue</div>
    </div>
    <div class="sub-kpi" style="border-top:3px solid #2563EB">
      <div class="sub-kpi-label">ARR</div>
      <div class="sub-kpi-value">${fmt(Math.round(arr))}</div>
      <div class="sub-kpi-sub">Annual Recurring Revenue</div>
    </div>
    <div class="sub-kpi" style="border-top:3px solid #16A34A">
      <div class="sub-kpi-label">Active</div>
      <div class="sub-kpi-value" style="color:#16A34A">${active.length}</div>
      <div class="sub-kpi-sub">${subs.filter(s=>s.status==='trial').length} on trial</div>
    </div>
    <div class="sub-kpi" style="border-top:3px solid ${churnRate>10?'var(--danger)':churnRate>5?'var(--warning)':'#16A34A'}">
      <div class="sub-kpi-label">Churn Rate</div>
      <div class="sub-kpi-value" style="color:${churnRate>10?'var(--danger)':churnRate>5?'var(--warning)':'inherit'}">${churnRate}%</div>
      <div class="sub-kpi-sub">${churned.length} churned total</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:14px">
    <div class="card">
      <div class="card-header"><div class="card-title">MRR Trend — Last 6 Months</div></div>
      <div class="chart-wrap"><canvas id="ch-sub-mrr"></canvas></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Status Breakdown</div></div>
      <div class="chart-wrap"><canvas id="ch-sub-status"></canvas></div>
    </div>
  </div>

  ${renewalsDue.length ? `
  <div class="card">
    <div class="card-header">
      <div class="card-title">⏰ Renewals Due — Next 30 Days</div>
      <span style="font-size:11px;background:#FEF3C7;color:#D97706;padding:2px 9px;border-radius:20px;font-weight:700">${renewalsDue.length} upcoming</span>
    </div>
    <div style="overflow-x:auto">
      <table class="table">
        <thead><tr><th>Client</th><th>Billing</th><th>Amount</th><th>Renewal Date</th><th>Days Left</th><th></th></tr></thead>
        <tbody>
          ${renewalsDue.sort((a,b)=>a.renewalDate.localeCompare(b.renewalDate)).map(s=>{
            const d = daysUntil(s.renewalDate);
            const col = d<=7?'var(--danger)':d<=14?'var(--warning)':'var(--text)';
            return `<tr style="border-top:1px solid var(--border)">
              <td style="padding:9px 12px;font-weight:600">${s.clientName}</td>
              <td style="padding:9px 12px;font-size:11px;color:var(--text-2);text-transform:capitalize">${s.billing||'—'}</td>
              <td style="padding:9px 12px;font-weight:600">${fmt(s.amount)}</td>
              <td style="padding:9px 12px;font-size:12px">${fmtD(s.renewalDate)}</td>
              <td style="padding:9px 12px"><span style="font-weight:700;color:${col}">${d}d</span></td>
              <td style="padding:9px 12px"><button class="btn btn-sm" style="font-size:10px" onclick="openEditSub(${s.id})">Edit</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>` : `<div class="card" style="text-align:center;padding:24px;color:var(--text-2);font-size:13px">✅ No renewals due in the next 30 days</div>`}`;

  // Draw charts
  setTimeout(() => {
    // MRR trend
    const mrrData = _subMrrTrend(subs);
    if (document.getElementById('ch-sub-mrr')) {
      mkChart('ch-sub-mrr','line',{
        labels: mrrData.map(m=>m.label),
        datasets:[{ data:mrrData.map(m=>m.mrr), borderColor:'#FF6600', backgroundColor:'rgba(255,102,0,.08)', fill:true, borderWidth:2, pointRadius:3, tension:.35 }]
      });
    }
    // Status donut
    if (document.getElementById('ch-sub-status')) {
      const st = { Active:active.length, Trial:subs.filter(s=>s.status==='trial').length, Paused:subs.filter(s=>s.status==='paused').length, Churned:churned.length };
      const stFiltered = Object.entries(st).filter(([,v])=>v>0);
      mkDoughnut('ch-sub-status', stFiltered.map(([k])=>k), stFiltered.map(([,v])=>v), ['#16A34A','#2563EB','#D97706','#DC2626']);
    }
  }, 60);
}

function _subMrrTrend(subs) {
  const now = new Date();
  const trend = [];
  for (let i=5; i>=0; i--) {
    const d    = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const mEnd = new Date(d.getFullYear(), d.getMonth()+1, 0);
    const label = d.toLocaleString('en-US',{month:'short'});
    const subsActive = subs.filter(s => {
      const start = s.startDate ? new Date(s.startDate+'T00:00:00') : null;
      const lost  = s.lostAt   ? new Date(s.lostAt)               : null;
      if (!start||start>mEnd) return false;
      if (lost&&lost<d)       return false;
      return true;
    });
    trend.push({ label, mrr: Math.round(subsActive.reduce((s,x)=>s+subToMRR({...x,status:'active'}),0)) });
  }
  return trend;
}

// ── List ─────────────────────────────────────────────────────────────────────
function _renderSubList(el) {
  const subs = state.subscriptions||[];
  const fmtD = iso => iso ? new Date(iso+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
  const now  = new Date();
  const daysUntil = iso => Math.round((new Date(iso+'T00:00:00')-now)/86400000);

  el.innerHTML = subs.length ? `
  <div class="card" style="padding:0;overflow:hidden">
    <div style="overflow-x:auto">
      <table class="table">
        <thead><tr>
          <th>Client</th><th>Billing</th><th>Amount</th><th>MRR</th><th>Seats</th>
          <th>Status</th><th>Start</th><th>Renewal</th><th></th>
        </tr></thead>
        <tbody>
          ${subs.map(s=>{
            const mrr   = subToMRR(s);
            const d     = s.renewalDate ? daysUntil(s.renewalDate) : null;
            const renCol= d!==null&&s.status==='active' ? (d<=7?'var(--danger)':d<=30?'var(--warning)':'var(--text-2)') : 'var(--text-2)';
            return `<tr style="border-top:1px solid var(--border)">
              <td style="padding:10px 12px;font-weight:600">${s.clientName}</td>
              <td style="padding:10px 12px;font-size:11px;color:var(--text-2);text-transform:capitalize">${s.billing||'—'}</td>
              <td style="padding:10px 12px;font-weight:600">${fmt(s.amount)}</td>
              <td style="padding:10px 12px;font-size:11px;color:var(--text-2)">${fmt(Math.round(mrr))}/mo</td>
              <td style="padding:10px 12px;font-size:11px;color:var(--text-2)">${s.seats||'—'}</td>
              <td style="padding:10px 12px">${subStatusBadge(s.status)}</td>
              <td style="padding:10px 12px;font-size:11px;color:var(--text-2)">${fmtD(s.startDate)}</td>
              <td style="padding:10px 12px;font-size:11px;color:${renCol};font-weight:${d!==null&&d<=30?'700':'400'}">${s.renewalDate?fmtD(s.renewalDate):'—'}${d!==null&&s.status==='active'&&d<=30?` <span style="font-size:10px">(${d}d)</span>`:''}</td>
              <td style="padding:10px 12px">
                <div style="display:flex;gap:5px">
                  <button class="btn btn-sm" style="font-size:10px" onclick="openEditSub(${s.id})">✏ Edit</button>
                  <button class="btn btn-sm" style="font-size:10px;color:var(--danger);border-color:rgba(220,38,38,.2)" onclick="deleteSub(${s.id})">🗑</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>` : `<div class="card" style="text-align:center;padding:40px;color:var(--text-2);font-size:13px">No subscriptions yet. Click <strong>+ New Subscription</strong> to add one.</div>`;
}

// ── Reports & KPIs ────────────────────────────────────────────────────────────
function _renderSubReports(el) {
  const subs   = state.subscriptions||[];
  const active = subs.filter(s=>s.status==='active');
  const churned= subs.filter(s=>s.status==='churned'||s.status==='cancelled');
  const mrr    = active.reduce((s,x)=>s+subToMRR(x),0);
  const arr    = mrr*12;
  const acv    = active.length ? arr/active.length : 0;

  // Revenue from AR invoices tagged Enterprise/SaaS (legacy KPIs from revenue section)
  const linkedAR   = state._linked?.ar || state.ar;
  const paidInv    = linkedAR.filter(x=>x.status==='paid');
  const paidSaasInv= paidInv.filter(x=>x.revenueType==='Enterprise'||x.revenueType==='SaaS');
  const arrInv     = paidSaasInv.reduce((s,x)=>s+x.amount,0);
  const mrrInv     = Math.round(arrInv/12);
  const paidTotal  = paidInv.reduce((s,x)=>s+x.amount,0);
  const saasRatio  = paidTotal ? Math.round((arrInv/paidTotal)*100) : 0;
  const saasClientNames = [...new Set(paidSaasInv.map(x=>x.client?.toLowerCase()).filter(Boolean))];
  const arpaInv    = saasClientNames.length ? Math.round(arrInv/saasClientNames.length) : 0;
  const ytdRevKpi  = (state.revenue||[]).filter(r=>r.revenue>0).reduce((s,r)=>s+r.revenue,0);
  const ytdExpKpi  = (state.revenue||[]).filter(r=>r.revenue>0).reduce((s,r)=>s+r.expenses,0);
  const grossMargin= ytdRevKpi ? Math.round(((ytdRevKpi-ytdExpKpi)/ytdRevKpi)*100) : 0;
  const totalAR    = (state.ar||[]).filter(x=>x.status!=='paid').reduce((s,x)=>s+(x.amount||0),0);
  const dso        = ytdRevKpi ? Math.round((totalAR/(ytdRevKpi/6))*30) : 0;
  const ltv        = arpaInv&&dso ? Math.round(arpaInv*(12/Math.max(dso/30,1))) : 0;
  const saasTgt    = state.appSettings?.saasRatioTarget || 0;

  // Billing breakdown
  const byBill = {
    monthly:   { count:0, rev:0 },
    quarterly: { count:0, rev:0 },
    yearly:    { count:0, rev:0 }
  };
  active.forEach(s => {
    const k = s.billing||'monthly';
    if (byBill[k]) { byBill[k].count++; byBill[k].rev+=Number(s.amount||0); }
  });

  // Plan/tier breakdown
  const PLAN_ORDER = ['Free','Pro','Premium','Enterprise','Custom'];
  const PLAN_COLORS = { Free:'#64748B', Pro:'#2563EB', Premium:'#7C3AED', Enterprise:'#FF6600', Custom:'#16A34A' };
  const allPlanKeys = [...new Set([...PLAN_ORDER, ...subs.map(s=>s.plan||'Unspecified')])];
  const byPlan = {};
  allPlanKeys.forEach(p => { byPlan[p] = { active:0, churned:0, mrrActive:0 }; });
  subs.forEach(s => {
    const p = s.plan||'Unspecified';
    if (!byPlan[p]) byPlan[p] = { active:0, churned:0, mrrActive:0 };
    if (s.status==='active') { byPlan[p].active++; byPlan[p].mrrActive+=subToMRR(s); }
    else if (s.status==='churned'||s.status==='cancelled') byPlan[p].churned++;
  });
  const planEntries = Object.entries(byPlan).filter(([,d])=>d.active+d.churned>0)
    .sort((a,b)=>(PLAN_ORDER.indexOf(a[0])<0?99:PLAN_ORDER.indexOf(a[0]))-(PLAN_ORDER.indexOf(b[0])<0?99:PLAN_ORDER.indexOf(b[0])));

  el.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px">

    <!-- Subscription KPIs from live data -->
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">Subscription KPIs</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">Computed from active subscription records</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid #FF6600">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">MRR</div>
          <div style="font-size:22px;font-weight:700">${fmt(Math.round(mrr))}</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">Monthly Recurring Revenue</div>
        </div>
        <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid #2563EB">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">ARR</div>
          <div style="font-size:22px;font-weight:700">${fmt(Math.round(arr))}</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">Annual Recurring Revenue</div>
        </div>
        <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid #7C3AED">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">ACV</div>
          <div style="font-size:22px;font-weight:700">${fmt(Math.round(acv))}</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">Avg Contract Value</div>
        </div>
        <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid ${churned.length>active.length*0.1?'var(--danger)':'#16A34A'}">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Churn Rate</div>
          <div style="font-size:22px;font-weight:700;color:${churned.length>active.length*0.1?'var(--danger)':'inherit'}">${(active.length+churned.length)?+(churned.length/(active.length+churned.length)*100).toFixed(1):0}%</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">${churned.length} churned total</div>
        </div>
      </div>
    </div>

    <!-- Plan / Tier Analysis -->
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">Plan & Tier Analysis</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">Breakdown by subscription plan — Pro, Premium, Enterprise, Custom & more</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:14px">
        ${planEntries.map(([plan,d])=>{
          const col = PLAN_COLORS[plan]||'#94A3B8';
          const churnRate = (d.active+d.churned) ? +((d.churned/(d.active+d.churned))*100).toFixed(1) : 0;
          const mrrPct    = mrr ? Math.round((d.mrrActive/mrr)*100) : 0;
          return `<div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid ${col}">
            <div style="font-size:11px;font-weight:700;color:${col};margin-bottom:6px">${plan}</div>
            <div style="font-size:18px;font-weight:800;margin-bottom:2px">${d.active}</div>
            <div style="font-size:10px;color:var(--text-2);margin-bottom:6px">${d.active===1?'client':'clients'} active${d.churned?` · ${d.churned} churned`:''}</div>
            <div style="font-size:11px;font-weight:600;margin-bottom:2px">${fmt(Math.round(d.mrrActive))}<span style="font-size:9px;color:var(--text-3);font-weight:400"> MRR</span></div>
            <div style="font-size:9px;color:var(--text-3);margin-bottom:6px">${mrrPct}% of total MRR</div>
            <div style="height:4px;background:var(--surface-1);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${mrrPct}%;background:${col};border-radius:2px"></div>
            </div>
            ${churnRate>0?`<div style="font-size:9px;margin-top:5px;color:${churnRate>20?'var(--danger)':churnRate>10?'var(--warning)':'var(--text-2)'}">Churn: ${churnRate}%</div>`:''}
          </div>`;
        }).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="chart-wrap" style="height:180px"><canvas id="ch-sub-plan-mrr"></canvas></div>
        <div class="chart-wrap" style="height:180px"><canvas id="ch-sub-plan-count"></canvas></div>
      </div>
    </div>

    <!-- Billing plan breakdown -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card">
        <div class="card-header"><div class="card-title">Revenue by Billing Cycle</div></div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
          ${['monthly','quarterly','yearly'].map(b=>{
            const d = byBill[b];
            const pct = active.length ? Math.round((d.count/active.length)*100) : 0;
            const col = b==='monthly'?'#2563EB':b==='quarterly'?'#7C3AED':'#FF6600';
            return `<div>
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
                <span style="font-weight:600;text-transform:capitalize;color:${col}">${b}</span>
                <span style="color:var(--text-2)">${d.count} client${d.count!==1?'s':''} · ${fmt(d.rev)}</span>
              </div>
              <div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${col};border-radius:3px"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div class="chart-wrap" style="height:160px"><canvas id="ch-sub-billing"></canvas></div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">MRR Trend</div></div>
        <div class="chart-wrap"><canvas id="ch-sub-mrr2"></canvas></div>
      </div>
    </div>

    <!-- Legacy SaaS KPIs from invoicing -->
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">Financial & SaaS KPIs</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">Computed from Enterprise invoice data</div></div>
        ${saasTgt?`<div style="font-size:11px;color:var(--text-2)">SaaS% target: <strong>${saasTgt}%</strong></div>`:''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">
        <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid #FF6600">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">ARR (Invoiced)</div>
          <div style="font-size:18px;font-weight:700">${fmt(arrInv)}</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">From paid Enterprise invoices</div>
        </div>
        <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid #2563EB">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">MRR (Invoiced)</div>
          <div style="font-size:18px;font-weight:700">${fmt(mrrInv)}</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">ARR ÷ 12</div>
        </div>
        <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid ${!saasTgt||saasRatio>=saasTgt?'#16A34A':'var(--warning)'}">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">SaaS%${saasTgt?` (target ${saasTgt}%)`:''}</div>
          <div style="font-size:18px;font-weight:700;color:${!saasTgt||saasRatio>=saasTgt?'inherit':'var(--warning)'}">${saasRatio}%</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">of total client revenue</div>
        </div>
        <div style="background:var(--surface-2);border-radius:9px;padding:12px;border-top:3px solid #7C3AED">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">ARPA</div>
          <div style="font-size:18px;font-weight:700">${fmt(arpaInv)}</div>
          <div style="font-size:10px;color:var(--text-2);margin-top:3px">Avg Revenue Per Account</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div style="background:var(--bg);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:${grossMargin>20?'var(--success)':grossMargin>10?'var(--warning)':'var(--danger)'}">${grossMargin}%</div>
          <div style="font-size:10px;color:var(--text-3);margin-top:3px">Gross Margin</div>
        </div>
        <div style="background:var(--bg);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:${dso<30?'var(--success)':dso<60?'var(--warning)':'var(--danger)'}">${dso}d</div>
          <div style="font-size:10px;color:var(--text-3);margin-top:3px">Days Sales Outstanding</div>
        </div>
        <div style="background:var(--bg);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:var(--primary)">${saasClientNames.length}</div>
          <div style="font-size:10px;color:var(--text-3);margin-top:3px">Enterprise Clients</div>
        </div>
        <div style="background:var(--bg);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:18px;font-weight:700">${fmt(ltv)}</div>
          <div style="font-size:10px;color:var(--text-3);margin-top:3px">Est. LTV</div>
        </div>
      </div>
    </div>
  </div>`;

  setTimeout(() => {
    if (document.getElementById('ch-sub-plan-mrr') && planEntries.length) {
      mkDoughnut('ch-sub-plan-mrr',
        planEntries.map(([p])=>p),
        planEntries.map(([,d])=>Math.round(d.mrrActive)),
        planEntries.map(([p])=>PLAN_COLORS[p]||'#94A3B8')
      );
    }
    if (document.getElementById('ch-sub-plan-count') && planEntries.length) {
      mkDoughnut('ch-sub-plan-count',
        planEntries.map(([p])=>p),
        planEntries.map(([,d])=>d.active),
        planEntries.map(([p])=>PLAN_COLORS[p]||'#94A3B8')
      );
    }
    if (document.getElementById('ch-sub-billing')) {
      const labels = ['Monthly','Quarterly','Yearly'];
      const data   = [byBill.monthly.count, byBill.quarterly.count, byBill.yearly.count];
      mkDoughnut('ch-sub-billing', labels, data, ['#2563EB','#7C3AED','#FF6600']);
    }
    if (document.getElementById('ch-sub-mrr2')) {
      const mrrData = _subMrrTrend(state.subscriptions||[]);
      mkChart('ch-sub-mrr2','line',{
        labels: mrrData.map(m=>m.label),
        datasets:[{ data:mrrData.map(m=>m.mrr), borderColor:'#FF6600', backgroundColor:'rgba(255,102,0,.08)', fill:true, borderWidth:2, pointRadius:3, tension:.35 }]
      });
    }
  }, 60);
}

// ── Reminders ────────────────────────────────────────────────────────────────
function _renderSubReminders(el) {
  const cfg  = state.subSettings||{};
  const days = (cfg.reminderDays||[7,30,60]).join(', ');
  const rcpt = (cfg.recipients||[]).join(', ');

  el.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div class="card-header"><div class="card-title">Renewal Reminder Configuration</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="form-row">
          <label>Remind Before Renewal (days, comma-separated)</label>
          <input type="text" id="sub-rem-days" value="${days}" placeholder="7, 30, 60">
        </div>
        <div class="form-row">
          <label>Email Recipients</label>
          <input type="text" id="sub-rem-rcpt" value="${rcpt}" placeholder="email@company.com, another@company.com">
        </div>
      </div>
      <div class="save-bar" style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-primary btn-sm" onclick="saveSubReminderSettings()">Save Settings</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">Email Templates Preview</div></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px;background:var(--surface-2);border-radius:10px;padding:16px;border:1px solid var(--border)">
          <div style="font-size:13px;font-weight:700;margin-bottom:4px">⏰ Renewal Reminder</div>
          <div style="font-size:11px;color:var(--text-2);margin-bottom:10px">Sent when renewal is 7, 30, or 60 days away</div>
          <button class="btn btn-sm" onclick="window.open('/api/subscriptions/preview/reminder','_blank')">👁 Preview</button>
        </div>
        <div style="flex:1;min-width:200px;background:#F0FDF4;border-radius:10px;padding:16px;border:1px solid #BBF7D0">
          <div style="font-size:13px;font-weight:700;margin-bottom:4px;color:#16A34A">🎉 Subscription Won</div>
          <div style="font-size:11px;color:var(--text-2);margin-bottom:10px">Sent when a subscription is activated or renewed</div>
          <button class="btn btn-sm" onclick="window.open('/api/subscriptions/preview/won','_blank')">👁 Preview</button>
        </div>
        <div style="flex:1;min-width:200px;background:#FEF2F2;border-radius:10px;padding:16px;border:1px solid #FECACA">
          <div style="font-size:13px;font-weight:700;margin-bottom:4px;color:#DC2626">⛔ Subscription Lost</div>
          <div style="font-size:11px;color:var(--text-2);margin-bottom:10px">Sent when a subscription churns or is cancelled</div>
          <button class="btn btn-sm" onclick="window.open('/api/subscriptions/preview/lost','_blank')">👁 Preview</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">Manual Check</div></div>
      <div style="font-size:12px;color:var(--text-2);margin-bottom:12px">
        Manually trigger a renewal check — sends reminder emails for any active subscriptions whose renewal date matches a configured reminder window today.
      </div>
      <button class="btn btn-primary btn-sm" onclick="checkSubRenewals()">🔔 Check Renewals Now</button>
      <div id="sub-renewal-status" style="margin-top:8px;font-size:11px;color:var(--text-2)"></div>
    </div>
  </div>`;
}

// ── Settings ─────────────────────────────────────────────────────────────────
function _renderSubSettings(el) {
  const cfg = state.subSettings||{};
  const saasTgt = state.appSettings?.saasRatioTarget || 0;
  el.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div class="card-header"><div class="card-title">SaaS Ratio Target</div></div>
      <div class="form-row" style="max-width:240px">
        <label>Target SaaS % of Total Revenue</label>
        <input type="number" id="sub-saas-tgt" value="${saasTgt}" min="0" max="100" placeholder="e.g. 20">
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveSubSaasTarget()">Save</button>
    </div>
  </div>`;
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────
function openAddSub() {
  state._subEditId = null;
  document.getElementById('sub-modal-title').textContent = 'New Subscription';
  ['sub-clientName','sub-amount','sub-seats','sub-startDate','sub-renewalDate','sub-notes','sub-lostReason'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const billingEl = document.getElementById('sub-billing');   if (billingEl) billingEl.value = 'yearly';
  const statusEl  = document.getElementById('sub-status');    if (statusEl)  statusEl.value  = 'active';
  const planEl    = document.getElementById('sub-plan');      if (planEl)    planEl.value    = '';
  _subToggleLostReason('active');
  openModal('modal-sub');
}

function openEditSub(id) {
  const sub = (state.subscriptions||[]).find(s=>s.id===id); if (!sub) return;
  state._subEditId = id;
  document.getElementById('sub-modal-title').textContent = 'Edit Subscription';
  document.getElementById('sub-clientName').value  = sub.clientName||'';
  document.getElementById('sub-billing').value     = sub.billing||'yearly';
  document.getElementById('sub-plan').value        = sub.plan||'';
  document.getElementById('sub-amount').value      = sub.amount||'';
  document.getElementById('sub-seats').value       = sub.seats||'';
  document.getElementById('sub-startDate').value   = sub.startDate||'';
  document.getElementById('sub-renewalDate').value = sub.renewalDate||'';
  document.getElementById('sub-status').value      = sub.status||'active';
  document.getElementById('sub-lostReason').value  = sub.lostReason||'';
  document.getElementById('sub-notes').value       = sub.notes||'';
  _subToggleLostReason(sub.status||'active');
  openModal('modal-sub');
}

function _subToggleLostReason(status) {
  const row = document.getElementById('sub-lostReason-row');
  if (row) row.style.display = (status==='churned'||status==='cancelled') ? '' : 'none';
}

document.addEventListener('change', e => {
  if (e.target?.id === 'sub-status') _subToggleLostReason(e.target.value);
});

async function saveSub() {
  const clientName  = document.getElementById('sub-clientName')?.value.trim();
  const billing     = document.getElementById('sub-billing')?.value;
  const amount      = document.getElementById('sub-amount')?.value;
  const seats       = document.getElementById('sub-seats')?.value;
  const startDate   = document.getElementById('sub-startDate')?.value;
  const renewalDate = document.getElementById('sub-renewalDate')?.value;
  const status      = document.getElementById('sub-status')?.value;
  const plan        = document.getElementById('sub-plan')?.value;
  const lostReason  = document.getElementById('sub-lostReason')?.value.trim();
  const notes       = document.getElementById('sub-notes')?.value.trim();

  if (!clientName) { toast('Client name is required'); return; }
  if (!amount)     { toast('Amount is required'); return; }

  const body = { clientName, billing, plan:plan||null, amount:Number(amount), seats:seats?Number(seats):null, startDate:startDate||null, renewalDate:renewalDate||null, status, lostReason:lostReason||null, notes:notes||null };

  try {
    if (state._subEditId) {
      const r = await apiCall(`/subscriptions/${state._subEditId}`, { method:'PUT', body:JSON.stringify(body) });
      const i = state.subscriptions.findIndex(s=>s.id===state._subEditId);
      if (i>-1) state.subscriptions[i] = r;
      toast('Subscription updated');
    } else {
      const r = await apiCall('/subscriptions', { method:'POST', body:JSON.stringify(body) });
      state.subscriptions.push(r);
      toast('Subscription added');
    }
    closeModal('modal-sub');
    renderSubscriptions(document.getElementById('main-content'));
  } catch(e) { toast('Error: '+e.message); }
}

async function deleteSub(id) {
  const sub = (state.subscriptions||[]).find(s=>s.id===id); if (!sub) return;
  if (!confirm(`Delete subscription for "${sub.clientName}"? This cannot be undone.`)) return;
  try {
    await apiCall(`/subscriptions/${id}`, { method:'DELETE' });
    state.subscriptions = state.subscriptions.filter(s=>s.id!==id);
    renderSubscriptions(document.getElementById('main-content'));
    toast('Subscription deleted');
  } catch(e) { toast('Error: '+e.message); }
}

async function checkSubRenewals() {
  const statusEl = document.getElementById('sub-renewal-status');
  if (statusEl) statusEl.textContent = 'Checking…';
  try {
    const r = await apiCall('/subscriptions/check-renewals', { method:'POST' });
    const msg = r.sent?.length ? `${r.sent.length} reminder email${r.sent.length>1?'s':''} sent` : (r.message||'No renewals due today');
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ ${msg}</span>`;
    toast(msg);
  } catch(e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">✗ ${e.message}</span>`;
    toast('Error: '+e.message);
  }
}

async function saveSubReminderSettings() {
  const daysRaw = document.getElementById('sub-rem-days')?.value||'';
  const rcptRaw = document.getElementById('sub-rem-rcpt')?.value||'';
  const reminderDays = daysRaw.split(',').map(d=>parseInt(d.trim())).filter(d=>!isNaN(d)&&d>0);
  const recipients   = rcptRaw.split(',').map(e=>e.trim()).filter(Boolean);
  try {
    const r = await apiCall('/subscriptions/settings', { method:'PUT', body:JSON.stringify({ reminderDays, recipients }) });
    state.subSettings = r.settings;
    toast('Reminder settings saved');
  } catch(e) { toast('Error: '+e.message); }
}

async function saveSubSaasTarget() {
  const tgt = Number(document.getElementById('sub-saas-tgt')?.value)||0;
  try {
    await apiCall('/app-settings', { method:'PUT', body:JSON.stringify({ saasRatioTarget:tgt }) });
    state.appSettings.saasRatioTarget = tgt;
    toast('SaaS target saved');
  } catch(e) { toast('Error: '+e.message); }
}

// ── Dashboard widget ──────────────────────────────────────────────────────────
function subDashWidget() {
  const subs   = state.subscriptions||[];
  const active = subs.filter(s=>s.status==='active');
  const mrr    = active.reduce((s,x)=>s+subToMRR(x),0);
  const arr    = mrr*12;
  const now    = new Date();
  const in30   = new Date(now); in30.setDate(now.getDate()+30);
  const renewalsDue = active.filter(s=>{ if(!s.renewalDate) return false; const d=new Date(s.renewalDate+'T00:00:00'); return d>=now&&d<=in30; }).length;
  const churned = subs.filter(s=>s.status==='churned'||s.status==='cancelled').length;
  // Plan mini-breakdown
  const planColors = { Free:'#64748B', Pro:'#2563EB', Premium:'#7C3AED', Enterprise:'#FF6600', Custom:'#16A34A' };
  const planMap = {};
  active.forEach(s=>{ const p=s.plan||'Other'; planMap[p]=(planMap[p]||0)+1; });
  const planChips = Object.entries(planMap).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([p,c])=>`<span style="display:inline-flex;align-items:center;gap:3px;background:var(--surface-1);border-radius:4px;padding:2px 6px;font-size:10px"><span style="width:6px;height:6px;border-radius:50%;background:${planColors[p]||'#94A3B8'};display:inline-block"></span>${p} <strong>${c}</strong></span>`).join('');
  return `
  <div class="card dash-section" data-dash-id="subscriptions" style="cursor:pointer" onclick="showSection('subscriptions')">
    <div class="card-header" style="margin-bottom:10px">
      <div class="card-title">📊 Enterprise Subscriptions</div>
      <span style="font-size:11px;color:var(--text-2)">${active.length} active</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div style="background:var(--surface-2);border-radius:8px;padding:10px;border-top:3px solid #FF6600">
        <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em">MRR</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px">${fmt(Math.round(mrr))}</div>
      </div>
      <div style="background:var(--surface-2);border-radius:8px;padding:10px;border-top:3px solid #2563EB">
        <div style="font-size:9px;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em">ARR</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px">${fmt(Math.round(arr))}</div>
      </div>
    </div>
    ${planChips ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${planChips}</div>` : ''}
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-2)">
      <span>${churned} churned</span>
      ${renewalsDue ? `<span style="color:var(--warning);font-weight:700">⏰ ${renewalsDue} renewal${renewalsDue>1?'s':''} due</span>` : '<span style="color:var(--success)">✅ No renewals due</span>'}
    </div>
  </div>`;
}

init();
