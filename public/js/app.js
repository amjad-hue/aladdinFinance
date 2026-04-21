const API = '/api';
const state = {
  section: 'dashboard',
  banks: [], reserves: [], cashflow: [], budget: [],
  revenue: [], clients: [], events: [], tasks: [], files: [], sync: [],
  selectedClientId: null, calYear: 2026, calMonth: 3,
  showDone: false, fileFilter: 'all',
  charts: {}
};
const TODAY = new Date(2026, 3, 21);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const fmt = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
const fmtK = v => (v<0?'-':'')+'$'+Math.round(Math.abs(v)/1000)+'k';
const daysTo = d => Math.ceil((new Date(d+'T00:00:00')-TODAY)/864e5);
const fmtDate = d => { const x=new Date(d+'T00:00:00'); return x.getDate()+' '+MONTHS[x.getMonth()].slice(0,3); };

async function api(path, opts = {}) {
  const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

async function loadAll() {
  try {
    const [banks, reserves, cashflow, budget, revenue, clients, events, tasks, files, sync] = await Promise.all([
      api('/cash'), api('/reserves'), api('/cashflow'), api('/budget'),
      api('/revenue'), api('/clients'), api('/events'), api('/tasks'),
      api('/files'), api('/sync/status')
    ]);
    Object.assign(state, { banks, reserves, cashflow, budget, revenue, clients, events, tasks, files, sync });
    setSyncStatus('Connected — all data loaded');
    recalcCashflow();
  } catch (err) {
    setSyncStatus('Connection error', true);
    console.error(err);
  }
}

function setSyncStatus(msg, error = false) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  lbl.textContent = msg;
  dot.style.background = error ? 'var(--danger)' : 'var(--success)';
}

function showSection(name) {
  state.section = name;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  render();
}

function recalcCashflow() {
  let prev = state.cashflow[0]?.opening || 0;
  state.cashflow.forEach((r, i) => {
    if (i > 0) r.opening = prev;
    prev = r.opening + r.inflow - r.outflow;
  });
}

function render() {
  const c = document.getElementById('main-content');
  document.getElementById('today-date').textContent = 'Tuesday, April 21 2026';
  const ytdRev = state.revenue.reduce((a, r) => a + r.revenue, 0);
  const ytdTgt = state.revenue.reduce((a, r) => a + r.target, 0);
  const pct = ytdTgt ? ((ytdRev/ytdTgt)*100).toFixed(1) : '0';
  document.getElementById('rev-pill').textContent = `Revenue ${pct}% of target`;

  if (state.section === 'dashboard') renderDashboard(c);
  else if (state.section === 'cash') renderCash(c);
  else if (state.section === 'cashflow') renderCashflow(c);
  else if (state.section === 'budget') renderBudget(c);
  else if (state.section === 'revenue') renderRevenue(c);
  else if (state.section === 'clients') renderClients(c);
  else if (state.section === 'calendar') renderCalendar(c);
  else if (state.section === 'files') renderFiles(c);
  else if (state.section === 'update') renderUpdate(c);
}

function renderDashboard(c) {
  const totalCash = state.banks.reduce((a, b) => a + b.total, 0);
  const reserved = state.reserves.reduce((a, r) => a + r.amount, 0);
  const available = totalCash - reserved;
  const ytdRev = state.revenue.reduce((a, r) => a + r.revenue, 0);
  const ytdTgt = state.revenue.reduce((a, r) => a + r.target, 0);
  const burnRate = state.budget.reduce((a, b) => a + b.actualMo, 0);
  const runway = burnRate ? Math.round(available / burnRate) : 0;
  const cloud = state.budget.find(b => b.cat === 'Cloud');
  const cloudPct = cloud ? Math.round((cloud.actualMo / (cloud.annual/12)) * 100) : 0;
  const closingCash = state.cashflow[state.cashflow.length - 1];
  const closing = closingCash ? closingCash.opening + closingCash.inflow - closingCash.outflow : 0;

  let alerts = '';
  if (cloudPct > 100) alerts += `<div class="alert alert-r"><svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1l6 11H1L7 1z"/></svg><span><strong>Cloud over budget</strong> — ${cloudPct}% of monthly budget used</span></div>`;
  if (available < 600000) alerts += `<div class="alert alert-a"><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="6"/><path d="M7 4v3.5M7 9.5v.5"/></svg><span>Available cash ${fmt(available)} — monitor reserves</span></div>`;
  if (ytdRev > ytdTgt) alerts += `<div class="alert alert-g"><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 7l3 3 5-5"/></svg><span><strong>Revenue ahead of target</strong> — +${fmt(ytdRev-ytdTgt)} YTD</span></div>`;

  c.innerHTML = `
    <div class="section active">
      ${alerts}
      <div class="grid-5">
        <div class="metric"><div class="metric-label">Total cash</div><div class="metric-value">${fmtK(totalCash)}</div><div class="metric-sub"><span class="dot" style="background:var(--success)"></span>${state.banks.length} accounts</div></div>
        <div class="metric"><div class="metric-label">Available cash</div><div class="metric-value" style="color:var(--success)">${fmtK(available)}</div><div class="metric-sub">After ${fmt(reserved)} reserved</div></div>
        <div class="metric"><div class="metric-label">Cash runway</div><div class="metric-value">${runway} mo</div><div class="metric-sub"><span class="dot" style="background:${runway>6?'var(--success)':runway>3?'var(--warning)':'var(--danger)'}"></span>At current burn</div></div>
        <div class="metric"><div class="metric-label">Revenue YTD</div><div class="metric-value">${fmtK(ytdRev)}</div><div class="metric-sub"><span class="dot" style="background:var(--success)"></span>${ytdTgt ? ((ytdRev/ytdTgt)*100).toFixed(1) : 0}% target</div></div>
        <div class="metric"><div class="metric-label">Forecast Dec</div><div class="metric-value" style="color:var(--success)">${fmtK(closing)}</div><div class="metric-sub">6-month view</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">Revenue vs target — H1 2026</div></div><div class="chart-wrap"><canvas id="chart-rev"></canvas></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Cash flow forecast</div></div><div class="chart-wrap"><canvas id="chart-cf"></canvas></div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">Budget utilisation</div></div><div class="chart-wrap"><canvas id="chart-bud"></canvas></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Top clients by revenue</div></div><div class="chart-wrap"><canvas id="chart-cli"></canvas></div></div>
      </div>
    </div>`;

  setTimeout(() => {
    mkChart('chart-rev', 'bar', {
      labels: state.revenue.map(r => r.month),
      datasets: [
        { label: 'Revenue', data: state.revenue.map(r => r.revenue), backgroundColor: '#0f172a', borderRadius: 4 },
        { label: 'Target', data: state.revenue.map(r => r.target), backgroundColor: '#f97316', borderRadius: 4 }
      ]
    });
    mkChart('chart-cf', 'line', {
      labels: state.cashflow.map(d => d.month.split(' ')[0]),
      datasets: [{ data: state.cashflow.map(d => d.opening + d.inflow - d.outflow), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,.08)', fill: true, borderWidth: 2, pointRadius: 0, tension: .3 }]
    });
    mkChart('chart-bud', 'bar', {
      labels: state.budget.map(d => d.cat),
      datasets: [
        { label: 'Budget', data: state.budget.map(d => Math.round(d.annual/12)), backgroundColor: '#94a3b8', borderRadius: 4 },
        { label: 'Actual', data: state.budget.map(d => d.actualMo), backgroundColor: '#f97316', borderRadius: 4 }
      ]
    }, { indexAxis: 'y' });
    mkChart('chart-cli', 'bar', {
      labels: state.clients.map(c => c.name.split(' ')[0]),
      datasets: [{ data: state.clients.map(c => c.revenue), backgroundColor: '#f97316', borderRadius: 4 }]
    });
  }, 50);
}

function mkChart(id, type, data, extraOpts = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(ctx, {
    type, data,
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { callback: fmtK, font: { size: 10 } }, grid: { color: 'rgba(128,128,128,0.1)' } }
      },
      ...extraOpts
    }
  });
}

function renderCash(c) {
  const totalCash = state.banks.reduce((a, b) => a + b.total, 0);
  const reserved = state.reserves.reduce((a, r) => a + r.amount, 0);
  const available = totalCash - reserved;

  c.innerHTML = `
    <div class="section active">
      <div class="view-tabs">
        <button class="view-tab active" onclick="switchView(this,'cash-charts')">Charts</button>
        <button class="view-tab" onclick="switchView(this,'cash-edit')">Reserves & edit</button>
      </div>
      <div class="view-panel active" id="cash-charts">
        <div class="card">
          <div class="card-header"><div class="card-title">Cash by bank — available vs reserved</div><button class="btn btn-sm" onclick="syncSource('/cash/sync','QuickBooks cash')"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a6 6 0 00-10 4M2 11a6 6 0 0010-4"/><path d="M12 3v3h-3M2 11v-3h3"/></svg>Update</button></div>
          <div class="grid-4" style="margin-bottom:12px">${state.banks.map(b => {
            const bRes = state.reserves.filter(r => r.bank === b.name).reduce((a,r)=>a+r.amount,0);
            return `<div class="metric"><div class="metric-label">${b.name}</div><div class="metric-value">${fmtK(b.total)}</div><div style="font-size:10px;margin-top:3px;color:var(--text-2)">Avail <span style="color:var(--success);font-weight:600">${fmtK(b.total-bRes)}</span></div></div>`;
          }).join('')}</div>
          <div class="chart-wrap chart-wrap-lg"><canvas id="chart-cash"></canvas></div>
        </div>
      </div>
      <div class="view-panel" id="cash-edit">
        <div class="card">
          <div class="card-header"><div><div class="card-title">Cash reserves</div><div class="card-desc">Manual entry — deducted from available cash</div></div><button class="btn btn-primary btn-sm" onclick="openAddReserve()">+ Add reserve</button></div>
          <div id="reserves-list">${state.reserves.length ? state.reserves.map(r => `<div class="reserve-row"><div style="display:flex;gap:10px;min-width:0"><strong style="color:var(--text)">${r.bank}</strong><span style="color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</span></div><div style="display:flex;align-items:center;gap:10px"><strong style="color:var(--danger)">${fmt(r.amount)}</strong><button class="del-btn" onclick="deleteReserve(${r.id})">×</button></div></div>`).join('') : '<div style="font-size:11px;color:var(--text-3);padding:12px 0;text-align:center">No reserves added yet</div>'}</div>
          <div style="background:var(--surface-2);border-radius:7px;padding:11px 13px;margin-top:10px;display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:10px;color:var(--text-2)">Total available</div><div style="font-size:22px;font-weight:600;color:var(--success);margin-top:3px">${fmt(available)}</div></div>
            <div style="text-align:right"><div style="font-size:10px;color:var(--text-2)">Reserved</div><div style="font-size:15px;font-weight:600;color:var(--danger);margin-top:3px">${fmt(reserved)}</div></div>
          </div>
        </div>
      </div>
    </div>`;

  setTimeout(() => {
    const resMap = {}; state.banks.forEach(b => resMap[b.name] = 0);
    state.reserves.forEach(r => { resMap[r.bank] = (resMap[r.bank]||0) + r.amount; });
    mkChart('chart-cash', 'bar', {
      labels: state.banks.map(b => b.name),
      datasets: [
        { label: 'Available', data: state.banks.map(b => b.total - (resMap[b.name]||0)), backgroundColor: '#22c55e', borderRadius: 4 },
        { label: 'Reserved', data: state.banks.map(b => resMap[b.name]||0), backgroundColor: '#f97316', borderRadius: 4 }
      ]
    }, { scales: { x: { stacked: true, ticks: { font: { size: 11 } }, grid: { display: false } }, y: { stacked: true, ticks: { callback: fmtK, font: { size: 10 } }, grid: { color: 'rgba(128,128,128,0.1)' } } } });
  }, 50);
}

function renderCashflow(c) {
  recalcCashflow();
  const ti = state.cashflow.reduce((a,r)=>a+r.inflow,0);
  const to = state.cashflow.reduce((a,r)=>a+r.outflow,0);
  const closing = (state.cashflow[0]?.opening||0) + ti - to;

  c.innerHTML = `
    <div class="section active">
      <div class="view-tabs">
        <button class="view-tab active" onclick="switchView(this,'cf-charts')">Charts</button>
        <button class="view-tab" onclick="switchView(this,'cf-edit')">Edit</button>
      </div>
      <div class="view-panel active" id="cf-charts">
        <div class="card">
          <div class="card-header"><div class="card-title">Cash flow forecast — Jul to Dec 2026</div><button class="btn btn-sm" onclick="syncSource('/cashflow/sync','QuickBooks cash flow')"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a6 6 0 00-10 4M2 11a6 6 0 0010-4"/><path d="M12 3v3h-3M2 11v-3h3"/></svg>Update</button></div>
          <div style="margin-bottom:10px;display:flex;gap:14px;font-size:11px;color:var(--text-2)">
            <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#f97316;border-radius:2px"></span>Inflow</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#94a3b8;border-radius:2px"></span>Outflow</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:22px;height:2px;background:#16a34a"></span>Closing</span>
          </div>
          <div class="chart-wrap chart-wrap-lg"><canvas id="chart-cf-detail"></canvas></div>
          <div class="grid-4" style="margin-top:12px">
            <div class="metric"><div class="metric-label">Opening</div><div class="metric-value">${fmtK(state.cashflow[0]?.opening||0)}</div></div>
            <div class="metric"><div class="metric-label">Total inflow</div><div class="metric-value">${fmtK(ti)}</div></div>
            <div class="metric"><div class="metric-label">Total outflow</div><div class="metric-value">${fmtK(to)}</div></div>
            <div class="metric" style="background:var(--success-bg)"><div class="metric-label" style="color:var(--success-text)">Dec closing</div><div class="metric-value" style="color:var(--success)">${fmtK(closing)}</div></div>
          </div>
        </div>
      </div>
      <div class="view-panel" id="cf-edit">
        <div class="card">
          <div class="card-header"><div class="card-title">Direct input</div><div style="display:flex;gap:6px"><label class="btn btn-sm" style="cursor:pointer"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1v9M4 7l3 3 3-3"/><path d="M1 11h12"/></svg>Upload Excel<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="toast('Excel uploaded: '+this.files[0].name)"></label><button class="btn btn-sm" onclick="syncSource('/cashflow/sync','QuickBooks')"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a6 6 0 00-10 4M2 11a6 6 0 0010-4"/><path d="M12 3v3h-3M2 11v-3h3"/></svg>Update</button></div></div>
          <div style="overflow-x:auto">
            <table class="table">
              <thead><tr><th>Month</th><th>Opening <span class="badge-qbo">QBO</span></th><th>Inflow <span class="badge-manual">manual</span></th><th>Outflow <span class="badge-manual">manual</span></th><th>Net <span class="badge-auto">auto</span></th><th>Closing <span class="badge-auto">auto</span></th></tr></thead>
              <tbody>${state.cashflow.map((r,i) => {
                const net = r.inflow - r.outflow;
                const cl = r.opening + net;
                return `<tr><td><strong>${r.month}</strong></td><td style="color:var(--text-2)">${fmt(r.opening)}</td><td><input class="input input-cell" type="text" value="${fmt(r.inflow)}" onchange="updateCashflow(${i},'inflow',this.value)" oninput="this.classList.add('modified');showCfSave()"></td><td><input class="input input-cell" type="text" value="${fmt(r.outflow)}" onchange="updateCashflow(${i},'outflow',this.value)" oninput="this.classList.add('modified');showCfSave()"></td><td class="${net>=0?'val-pos':'val-neg'}">${net>=0?'+':''}${fmt(net)}</td><td style="color:var(--success);font-weight:600">${fmt(cl)}</td></tr>`;
              }).join('')}</tbody>
            </table>
          </div>
          <div class="save-bar" id="cf-savebar"><span class="save-hint">Unsaved changes</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="discardCashflow()">Discard</button><button class="btn btn-primary btn-sm" onclick="saveCashflow()">Save</button></div></div>
        </div>
      </div>
    </div>`;

  setTimeout(() => {
    mkChart('chart-cf-detail', 'bar', {
      labels: state.cashflow.map(d => d.month.split(' ')[0]),
      datasets: [
        { label: 'Inflow', type: 'bar', data: state.cashflow.map(d => d.inflow), backgroundColor: '#f97316', borderRadius: 4 },
        { label: 'Outflow', type: 'bar', data: state.cashflow.map(d => d.outflow), backgroundColor: '#94a3b8', borderRadius: 4 },
        { label: 'Closing', type: 'line', data: state.cashflow.map(d => d.opening + d.inflow - d.outflow), borderColor: '#16a34a', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 3, tension: .3 }
      ]
    });
  }, 50);
}

function updateCashflow(i, field, val) {
  const n = parseInt(String(val).replace(/[^0-9-]/g, ''));
  if (!isNaN(n)) state.cashflow[i][field] = n;
  recalcCashflow();
}
function showCfSave() { document.getElementById('cf-savebar').classList.add('visible'); }
async function saveCashflow() {
  try {
    await api('/cashflow', { method: 'PUT', body: JSON.stringify({ cashflow: state.cashflow }) });
    toast('Cash flow saved');
    render();
  } catch (e) { toast('Error saving'); }
}
function discardCashflow() { loadAll().then(render); }

function renderBudget(c) {
  c.innerHTML = `
    <div class="section active">
      <div class="view-tabs">
        <button class="view-tab active" onclick="switchView(this,'bud-charts')">Charts</button>
        <button class="view-tab" onclick="switchView(this,'bud-edit')">Edit targets</button>
      </div>
      <div class="view-panel active" id="bud-charts">
        <div class="card"><div class="card-header"><div class="card-title">Budget vs actual — this month</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-bud-detail"></canvas></div></div>
      </div>
      <div class="view-panel" id="bud-edit">
        <div class="card">
          <div class="card-header"><div class="card-title">Budget targets — FY 2026</div><div style="display:flex;gap:6px"><label class="btn btn-sm" style="cursor:pointer"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1v9M4 7l3 3 3-3"/><path d="M1 11h12"/></svg>Upload Excel<input type="file" style="display:none" onchange="toast('Budget imported')"></label><button class="btn btn-sm" onclick="syncSource('/budget/sync','QuickBooks budget')"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a6 6 0 00-10 4M2 11a6 6 0 0010-4"/><path d="M12 3v3h-3M2 11v-3h3"/></svg>Update</button></div></div>
          <div style="overflow-x:auto">
            <table class="table">
              <thead><tr><th>Category</th><th>Annual <span class="badge-manual">edit</span></th><th>Monthly <span class="badge-auto">auto</span></th><th>Actual/mo <span class="badge-qbo">QBO</span></th><th>vs budget</th><th>Status</th><th>Notes</th></tr></thead>
              <tbody>${state.budget.map((r,i) => {
                const mo = Math.round(r.annual/12);
                const pct = mo ? Math.round((r.actualMo/mo)*100) : 0;
                const over = pct > 100;
                return `<tr><td><strong>${r.cat}</strong></td><td><input class="input input-cell" type="text" value="${fmt(r.annual)}" onchange="updateBudget(${i},'annual',this.value)" oninput="this.classList.add('modified');showBudSave()"></td><td style="color:var(--text-2)">${fmt(mo)}</td><td style="color:var(--text-2)">${fmt(r.actualMo)}</td><td class="${over?'val-neg':'val-pos'}">${over?'+':'-'}${fmt(Math.abs(r.actualMo-mo))}</td><td><div style="display:flex;align-items:center;gap:5px"><div class="progress-track"><div class="progress-fill${over?' over':''}" style="width:${Math.min(pct,100)}%"></div></div><span style="font-size:10px;${over?'color:var(--danger)':'color:var(--success)'}">${pct}%</span></div></td><td><input class="input" style="width:120px" type="text" value="${r.note||''}" placeholder="Notes..." onchange="updateBudget(${i},'note',this.value)" oninput="this.classList.add('modified');showBudSave()"></td></tr>`;
              }).join('')}</tbody>
            </table>
          </div>
          <div class="save-bar" id="bud-savebar"><span class="save-hint">Unsaved changes</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="discardBudget()">Discard</button><button class="btn btn-primary btn-sm" onclick="saveBudget()">Save</button></div></div>
        </div>
      </div>
    </div>`;

  setTimeout(() => {
    mkChart('chart-bud-detail', 'bar', {
      labels: state.budget.map(d => d.cat),
      datasets: [
        { label: 'Budget/mo', data: state.budget.map(d => Math.round(d.annual/12)), backgroundColor: '#94a3b8', borderRadius: 4 },
        { label: 'Actual', data: state.budget.map(d => d.actualMo), backgroundColor: state.budget.map(d => d.actualMo > Math.round(d.annual/12) ? '#ef4444' : '#f97316'), borderRadius: 4 }
      ]
    }, { indexAxis: 'y' });
  }, 50);
}
function updateBudget(i, field, val) {
  if (field === 'annual') { const n = parseInt(String(val).replace(/[^0-9]/g,'')); if (!isNaN(n)) state.budget[i][field] = n; }
  else state.budget[i][field] = val;
}
function showBudSave() { document.getElementById('bud-savebar').classList.add('visible'); }
async function saveBudget() {
  try { await api('/budget', { method: 'PUT', body: JSON.stringify({ budget: state.budget }) }); toast('Budget saved'); render(); }
  catch (e) { toast('Error saving'); }
}
function discardBudget() { loadAll().then(render); }

function renderRevenue(c) {
  const ytdRev = state.revenue.reduce((a,r)=>a+r.revenue,0);
  const ytdTgt = state.revenue.reduce((a,r)=>a+r.target,0);
  const pct = ytdTgt ? ((ytdRev/ytdTgt)*100).toFixed(1) : 0;
  c.innerHTML = `
    <div class="section active">
      <div class="view-tabs">
        <button class="view-tab active" onclick="switchView(this,'rev-charts')">Charts</button>
        <button class="view-tab" onclick="switchView(this,'rev-edit')">Edit targets</button>
      </div>
      <div class="view-panel active" id="rev-charts">
        <div class="card">
          <div class="card-header"><div class="card-title">Revenue vs target — H1 2026</div><button class="btn btn-sm" onclick="syncSource('/revenue/sync','QuickBooks + HubSpot')"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a6 6 0 00-10 4M2 11a6 6 0 0010-4"/><path d="M12 3v3h-3M2 11v-3h3"/></svg>Update</button></div>
          <div class="chart-wrap chart-wrap-lg"><canvas id="chart-rev-detail"></canvas></div>
          <div class="grid-3" style="margin-top:12px"><div class="metric"><div class="metric-label">YTD revenue</div><div class="metric-value">${fmtK(ytdRev)}</div></div><div class="metric"><div class="metric-label">Achievement</div><div class="metric-value">${pct}%</div></div><div class="metric"><div class="metric-label">vs target</div><div class="metric-value" style="color:var(--success)">+${fmtK(ytdRev-ytdTgt)}</div></div></div>
        </div>
      </div>
      <div class="view-panel" id="rev-edit">
        <div class="card">
          <div class="card-header"><div class="card-title">Revenue — edit per month</div><button class="btn btn-sm" onclick="syncSource('/revenue/sync','QuickBooks')"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a6 6 0 00-10 4M2 11a6 6 0 0010-4"/><path d="M12 3v3h-3M2 11v-3h3"/></svg>Update</button></div>
          <div style="overflow-x:auto">
            <table class="table">
              <thead><tr><th>Month</th><th>Actual <span class="badge-qbo">QBO</span></th><th>Target <span class="badge-manual">edit</span></th><th>Variance</th><th>Expenses <span class="badge-qbo">QBO</span></th><th>Margin</th></tr></thead>
              <tbody>${state.revenue.map((r,i) => {
                const v = r.revenue - r.target;
                const mg = r.revenue ? Math.round(((r.revenue-r.expenses)/r.revenue)*100) : 0;
                return `<tr><td><strong>${r.month}</strong></td><td style="color:var(--text-2)">${fmt(r.revenue)}</td><td><input class="input input-cell" type="text" value="${fmt(r.target)}" onchange="updateRevenue(${i},'target',this.value)" oninput="this.classList.add('modified');showRevSave()"></td><td class="${v>=0?'val-pos':'val-neg'}">${v>=0?'+':''}${fmt(v)}</td><td style="color:var(--text-2)">${fmt(r.expenses)}</td><td>${mg}%</td></tr>`;
              }).join('')}</tbody>
            </table>
          </div>
          <div class="save-bar" id="rev-savebar"><span class="save-hint">Unsaved changes</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="discardRevenue()">Discard</button><button class="btn btn-primary btn-sm" onclick="saveRevenue()">Save</button></div></div>
        </div>
      </div>
    </div>`;

  setTimeout(() => {
    mkChart('chart-rev-detail', 'bar', {
      labels: state.revenue.map(r => r.month),
      datasets: [
        { label: 'Revenue', data: state.revenue.map(r => r.revenue), backgroundColor: '#0f172a', borderRadius: 4 },
        { label: 'Target', data: state.revenue.map(r => r.target), backgroundColor: '#f97316', borderRadius: 4 }
      ]
    });
  }, 50);
}
function updateRevenue(i, field, val) { const n = parseInt(String(val).replace(/[^0-9]/g,'')); if (!isNaN(n)) state.revenue[i][field] = n; }
function showRevSave() { document.getElementById('rev-savebar').classList.add('visible'); }
async function saveRevenue() {
  try { await api('/revenue', { method: 'PUT', body: JSON.stringify({ revenue: state.revenue }) }); toast('Revenue saved'); render(); }
  catch (e) { toast('Error saving'); }
}
function discardRevenue() { loadAll().then(render); }

function renderClients(c) {
  const colors = [['#f97316','#ffedd5'],['#3b82f6','#dbeafe'],['#22c55e','#dcfce7'],['#8b5cf6','#ede9fe'],['#ef4444','#fee2e2']];
  c.innerHTML = `
    <div class="section active">
      <div class="clients-grid">
        <div class="card" style="max-height:640px;overflow-y:auto">
          <div class="card-header" style="flex-direction:column;align-items:stretch;gap:10px">
            <div style="display:flex;justify-content:space-between;align-items:center"><div class="card-title">Clients</div><span class="qbo-source">From QuickBooks</span></div>
            <div style="display:flex;gap:6px"><button class="btn btn-sm" style="flex:1" onclick="syncSource('/clients/sync','QuickBooks customers')"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a6 6 0 00-10 4M2 11a6 6 0 0010-4"/><path d="M12 3v3h-3M2 11v-3h3"/></svg>Sync</button><button class="btn btn-primary btn-sm" onclick="openAddClient()">+ Add</button></div>
          </div>
          <input type="text" class="search-input" id="client-search" placeholder="Search clients..." oninput="filterClients(this.value)">
          <div id="clients-list"></div>
        </div>
        <div id="client-detail-wrap"><div class="card" style="display:flex;align-items:center;justify-content:center;min-height:220px;color:var(--text-3);font-size:12px">Select a client to view details</div></div>
      </div>
    </div>`;
  renderClientsList();
  if (state.selectedClientId) showClient(state.selectedClientId);
}

function renderClientsList(filter = '') {
  const colors = [['#f97316','#ffedd5'],['#3b82f6','#dbeafe'],['#22c55e','#dcfce7'],['#8b5cf6','#ede9fe'],['#ef4444','#fee2e2']];
  const list = state.clients.filter(c => !filter ||
    c.name.toLowerCase().includes(filter.toLowerCase()) ||
    c.type.toLowerCase().includes(filter.toLowerCase()) ||
    c.country.toLowerCase().includes(filter.toLowerCase()));
  const el = document.getElementById('clients-list');
  if (!el) return;
  el.innerHTML = list.length ? list.map((c, i) => {
    const init = c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const saasP = c.revenue ? Math.round((c.saas/c.revenue)*100) : 0;
    const col = colors[i % colors.length];
    return `<div class="client-item${state.selectedClientId===c.id?' selected':''}" onclick="showClient(${c.id})">
      <div class="client-avatar" style="background:${col[1]};color:${col[0]}">${init}</div>
      <div style="flex:1;min-width:0"><div class="client-name">${c.name}</div><div class="client-sub">${c.type} · ${c.country} · SaaS ${saasP}%</div></div>
      <div class="client-amount">${fmtK(c.revenue)}</div>
    </div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:12px 0;text-align:center">No results</div>';
}
function filterClients(v) { renderClientsList(v); }

function showClient(id) {
  state.selectedClientId = id;
  const c = state.clients.find(x => x.id === id);
  if (!c) return;
  renderClientsList(document.getElementById('client-search')?.value || '');
  const saasP = c.revenue ? Math.round((c.saas/c.revenue)*100) : 0;
  const renewDays = Math.ceil((new Date(c.renewal+'T00:00:00') - TODAY) / 864e5);
  const init = c.name.split(' ').map(w => w[0]).join('').slice(0, 2);
  const wrap = document.getElementById('client-detail-wrap');
  wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
    <div class="card">
      <div style="display:flex;align-items:center;gap:11px;margin-bottom:11px">
        <div style="width:42px;height:42px;border-radius:50%;background:#f97316;display:flex;align-items:center;justify-content:center;font-weight:600;color:#fff;font-size:14px;flex-shrink:0">${init}</div>
        <div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:600">${c.name}</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">${c.type} · ${c.country}${c.fromQBO?' <span class="qbo-source" style="margin-left:4px;font-size:9px;padding:2px 7px">QuickBooks</span>':''}</div></div>
        <button class="btn btn-sm" onclick="editClient(${c.id})">Edit</button>
      </div>
      <div class="grid-2" style="gap:8px">
        <div class="metric"><div class="metric-label">Total revenue</div><div class="metric-value">${fmt(c.revenue)}</div></div>
        <div class="metric"><div class="metric-label">SaaS ratio</div><div class="metric-value">${saasP}%</div></div>
        <div class="metric"><div class="metric-label">SaaS</div><div class="metric-value">${fmt(c.saas)}</div></div>
        <div class="metric"><div class="metric-label">Services</div><div class="metric-value">${fmt(c.services)}</div></div>
      </div>
    </div>
    <div class="card"><div class="card-title" style="margin-bottom:10px">Revenue trend — last 6 months</div><div class="chart-wrap chart-wrap-sm"><canvas id="chart-client-trend"></canvas></div></div>
    <div class="card">
      <div class="grid-2" style="gap:12px">
        <div><div class="card-title" style="margin-bottom:8px">SaaS vs services</div><div style="height:140px;position:relative"><canvas id="chart-client-split"></canvas></div></div>
        <div>
          <div class="card-title" style="margin-bottom:8px">Contract details</div>
          <div class="detail-row"><span class="detail-label">Renewal</span><span class="detail-value ${renewDays<90?'val-neg':''}">${fmtDate(c.renewal)}${renewDays>=0?` <span class="tag tag-neutral" style="font-size:9px">${renewDays}d</span>`:''}</span></div>
          <div class="detail-row"><span class="detail-label">Annual value</span><span class="detail-value">${fmt(c.revenue)}</span></div>
          <div class="detail-row"><span class="detail-label">Country</span><span class="detail-value">${c.country}</span></div>
          <div class="detail-row"><span class="detail-label">Segment</span><span class="detail-value">${c.type}</span></div>
          ${c.qbId?`<div class="detail-row"><span class="detail-label">QBO ID</span><span class="detail-value" style="font-family:monospace;font-size:10px">${c.qbId}</span></div>`:''}
        </div>
      </div>
    </div>
    <div class="card"><div class="card-title" style="margin-bottom:7px">CFO notes</div><div style="font-size:12px;color:var(--text-2);line-height:1.6">${c.notes||'No notes added.'}</div></div>
  </div>`;
  setTimeout(() => {
    mkChart('chart-client-trend', 'line', {
      labels: ['Nov','Dec','Jan','Feb','Mar','Apr'],
      datasets: [{ data: c.trend, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,.08)', fill: true, borderWidth: 2, pointRadius: 3, tension: .3 }]
    });
    const ctx = document.getElementById('chart-client-split');
    if (state.charts['chart-client-split']) state.charts['chart-client-split'].destroy();
    state.charts['chart-client-split'] = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['SaaS', 'Services'], datasets: [{ data: [c.saas, c.services], backgroundColor: ['#0f172a','#f97316'], borderWidth: 0, hoverOffset: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10, padding: 8 } } } }
    });
  }, 50);
}

function openAddClient() {
  document.getElementById('client-modal-title').textContent = 'Add client';
  ['cl-name','cl-country','cl-revenue','cl-saas','cl-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cl-type').value = 'Enterprise';
  document.getElementById('cl-renewal').value = '2027-01-01';
  delete document.getElementById('modal-client').dataset.editId;
  openModal('modal-client');
}
function editClient(id) {
  const c = state.clients.find(x => x.id === id); if (!c) return;
  document.getElementById('client-modal-title').textContent = 'Edit — ' + c.name;
  document.getElementById('cl-name').value = c.name;
  document.getElementById('cl-type').value = c.type;
  document.getElementById('cl-country').value = c.country;
  document.getElementById('cl-revenue').value = c.revenue;
  document.getElementById('cl-saas').value = c.saas;
  document.getElementById('cl-renewal').value = c.renewal;
  document.getElementById('cl-notes').value = c.notes;
  document.getElementById('modal-client').dataset.editId = id;
  openModal('modal-client');
}
async function saveClient() {
  const name = document.getElementById('cl-name').value.trim();
  if (!name) { toast('Please enter a client name'); return; }
  const data = {
    name, type: document.getElementById('cl-type').value, country: document.getElementById('cl-country').value || '—',
    revenue: parseInt(document.getElementById('cl-revenue').value) || 0,
    saas: parseInt(document.getElementById('cl-saas').value) || 0,
    renewal: document.getElementById('cl-renewal').value || '2027-01-01',
    notes: document.getElementById('cl-notes').value
  };
  const eid = document.getElementById('modal-client').dataset.editId;
  try {
    if (eid) {
      const r = await api(`/clients/${eid}`, { method: 'PUT', body: JSON.stringify(data) });
      const i = state.clients.findIndex(c => c.id === Number(eid));
      if (i > -1) state.clients[i] = r.client;
      state.selectedClientId = Number(eid);
    } else {
      const r = await api('/clients', { method: 'POST', body: JSON.stringify(data) });
      state.clients.push(r.client);
      state.selectedClientId = r.client.id;
    }
    closeModal('modal-client');
    render();
    toast('Client saved');
  } catch (e) { toast('Error saving client'); }
}

function renderCalendar(c) {
  c.innerHTML = `
    <div class="section active">
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">Calendar</div><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="toast('Google Calendar — OAuth in production')"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="2" width="12" height="11" rx="1.5"/><path d="M1 6h12M4 1v2M10 1v2"/></svg>Google</button><button class="btn btn-primary btn-sm" onclick="openAddEvent()">+ Add</button></div></div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><button class="btn btn-sm" style="padding:2px 8px" onclick="calMove(-1)">‹</button><strong id="cal-label">${MONTHS[state.calMonth]} ${state.calYear}</strong><button class="btn btn-sm" style="padding:2px 8px" onclick="calMove(1)">›</button></div>
          <div class="cal-grid">${DAYS.map(d => `<div class="cal-hd">${d}</div>`).join('')}</div>
          <div class="cal-grid" style="margin-top:3px" id="cal-days"></div>
          <div style="margin-top:12px;font-size:12px;font-weight:600;margin-bottom:8px">Upcoming events</div>
          <div id="events-list"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="card">
            <div class="card-header"><div class="card-title">Tasks</div><button class="btn btn-sm" onclick="toggleDone()">Show done</button></div>
            <div id="tasks-list"></div>
            <div style="display:flex;gap:6px;margin-top:10px"><input type="text" id="new-task" class="input" style="flex:1;padding:7px 9px" placeholder="Add task..." onkeydown="if(event.key==='Enter')addTask()"><button class="btn btn-sm" onclick="addTask()">+</button></div>
          </div>
          <div class="card"><div class="card-title" style="margin-bottom:9px">Month summary</div><div id="month-summary"></div></div>
        </div>
      </div>
    </div>`;
  renderCalDays();
  renderEventsList();
  renderTasksList();
  renderMonthSummary();
}

function renderCalDays() {
  const el = document.getElementById('cal-days'); if (!el) return;
  const first = new Date(state.calYear, state.calMonth, 1).getDay();
  const dim = new Date(state.calYear, state.calMonth+1, 0).getDate();
  const prev = new Date(state.calYear, state.calMonth, 0).getDate();
  const eD = {}, tD = {};
  state.events.forEach(e => {
    const d = new Date(e.date+'T00:00:00');
    if (d.getFullYear()===state.calYear && d.getMonth()===state.calMonth) {
      eD[d.getDate()] = true; if (e.type==='tax') tD[d.getDate()] = true;
    }
  });
  let html = '';
  for (let i=0; i<first; i++) html += `<div class="cal-day dim">${prev-first+1+i}</div>`;
  for (let d=1; d<=dim; d++) {
    const isTd = state.calYear===TODAY.getFullYear() && state.calMonth===TODAY.getMonth() && d===TODAY.getDate();
    const hasTax = tD[d], hasE = eD[d];
    const cls = 'cal-day' + (isTd ? ' today' : '');
    const dot = hasTax ? `<div class="cal-dot" style="background:${isTd?'#fca5a5':'#ef4444'}"></div>` : hasE ? `<div class="cal-dot" style="background:${isTd?'#fff':'#f97316'}"></div>` : '';
    html += `<div class="${cls}">${d}${dot}</div>`;
  }
  el.innerHTML = html;
}

function calMove(dir) {
  state.calMonth += dir;
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
  document.getElementById('cal-label').textContent = MONTHS[state.calMonth] + ' ' + state.calYear;
  renderCalDays();
}

function cdBadge(d) {
  const n = daysTo(d);
  if (n < 0) return '';
  if (n === 0) return '<span class="countdown cd-urgent">Today</span>';
  if (n <= 3) return `<span class="countdown cd-urgent">${n}d</span>`;
  if (n <= 14) return `<span class="countdown cd-soon">${n}d</span>`;
  return `<span class="countdown cd-ok">${n}d</span>`;
}

function renderEventsList() {
  const colors = { tax:'#ef4444', meeting:'#3b82f6', deadline:'#f59e0b', task:'#22c55e', planning:'#8b5cf6' };
  const tags = { tax:'Tax', meeting:'Meeting', deadline:'Deadline', task:'Task', planning:'Planning' };
  const list = state.events.filter(e => daysTo(e.date) >= 0).sort((a,b) => new Date(a.date)-new Date(b.date)).slice(0, 6);
  const el = document.getElementById('events-list'); if (!el) return;
  el.innerHTML = list.length ? list.map(e => `<div class="event-item"><div class="event-bar" style="background:${colors[e.type]}"></div><div style="flex:1;min-width:0"><div class="event-title">${e.title}</div><div class="event-meta"><span class="tag" style="background:${colors[e.type]}22;color:${colors[e.type]};font-size:10px">${tags[e.type]}</span><span>${fmtDate(e.date)}</span>${e.amount?`<strong>${fmt(e.amount)}</strong>`:''} ${cdBadge(e.date)}</div></div></div>`).join('') : '<div style="font-size:11px;color:var(--text-3);padding:10px 0">No events</div>';
}

function openAddEvent() {
  ['evt-title','evt-note'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('evt-date').value = '2026-04-21';
  openModal('modal-event');
}
async function saveEvent() {
  const title = document.getElementById('evt-title').value.trim();
  const date = document.getElementById('evt-date').value;
  if (!title || !date) { toast('Please fill title and date'); return; }
  try {
    const r = await api('/events', { method: 'POST', body: JSON.stringify({
      type: document.getElementById('evt-type').value, title, date,
      note: document.getElementById('evt-note').value,
      recur: document.getElementById('evt-recur').value
    })});
    state.events.push(r.event);
    closeModal('modal-event');
    renderCalDays(); renderEventsList(); renderMonthSummary();
    toast('Event saved');
  } catch (e) { toast('Error saving event'); }
}

function renderTasksList() {
  const el = document.getElementById('tasks-list'); if (!el) return;
  const vis = state.tasks.filter(t => state.showDone || !t.done);
  el.innerHTML = vis.length ? vis.map(t => `<div class="task-row"><div class="checkbox${t.done?' done':''}" onclick="toggleTask(${t.id})"></div><div><div class="task-title${t.done?' done':''}">${t.title}</div><div class="task-due">${t.due}</div></div></div>`).join('') : '<div style="font-size:11px;color:var(--text-3);padding:10px 0">No tasks</div>';
}

async function toggleTask(id) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  t.done = !t.done;
  await api(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done: t.done }) });
  renderTasksList(); renderMonthSummary();
}
function toggleDone() { state.showDone = !state.showDone; renderTasksList(); }
async function addTask() {
  const inp = document.getElementById('new-task');
  const v = inp.value.trim(); if (!v) return;
  try {
    const r = await api('/tasks', { method: 'POST', body: JSON.stringify({ title: v }) });
    state.tasks.unshift(r.task);
    inp.value = '';
    renderTasksList(); renderMonthSummary();
  } catch (e) { toast('Error adding task'); }
}

function renderMonthSummary() {
  const el = document.getElementById('month-summary'); if (!el) return;
  const tax90 = state.events.filter(e => e.type==='tax' && daysTo(e.date)>=0 && daysTo(e.date)<=90).reduce((a,e)=>a+(e.amount||0),0);
  const mo30 = state.events.filter(e => daysTo(e.date)>=0 && daysTo(e.date)<=30).length;
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">
    <div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:0.5px solid var(--border)"><span style="color:var(--text-2)">Events this month</span><strong>${mo30}</strong></div>
    <div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:0.5px solid var(--border)"><span style="color:var(--text-2)">Tax due (90d)</span><strong style="color:var(--danger)">${fmt(tax90)}</strong></div>
    <div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0"><span style="color:var(--text-2)">Open tasks</span><strong>${state.tasks.filter(t=>!t.done).length}</strong></div>
  </div>`;
}

function renderFiles(c) {
  c.innerHTML = `
    <div class="section active">
      <div class="card">
        <div class="card-header"><div class="card-title">Government papers & official documents</div><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="toast('Drive sync — OAuth in production')"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 11l3-6h5l3 6H2zM5 5L7 2h-1L4 5M8 5l2-3h1L9 5"/></svg>Drive</button><label class="btn btn-primary btn-sm" style="cursor:pointer"><svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 1v9M4 7l3 3 3-3"/><path d="M1 11h12"/></svg>Upload<input type="file" style="display:none" onchange="uploadFile(this)"></label></div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          ${['all','license','contract','tax','report'].map(f => `<button class="btn btn-sm" style="${state.fileFilter===f?'background:#0f172a;color:#fff;border-color:#0f172a':''}" onclick="setFileFilter('${f}')">${f.charAt(0).toUpperCase()+f.slice(1)}</button>`).join('')}
        </div>
        <div id="files-list"></div>
      </div>
    </div>`;
  renderFilesList();
}

function renderFilesList() {
  const icons = { p: 'fi-pdf', x: 'fi-xls', d: 'fi-doc' };
  const labels = { p: 'PDF', x: 'XLS', d: 'DOC' };
  const list = state.fileFilter === 'all' ? state.files : state.files.filter(f => f.type === state.fileFilter);
  const el = document.getElementById('files-list'); if (!el) return;
  el.innerHTML = list.length ? list.map(f => `<div class="file-row"><div class="file-icon ${icons[f.cat]||'fi-doc'}">${labels[f.cat]||'DOC'}</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</div><div style="font-size:10px;color:var(--text-2)">${f.size} · ${f.date}${f.drive?' · <span style="color:var(--info)">Drive</span>':''}</div></div><div style="display:flex;gap:5px">${f.storedAs?`<a href="/api/files/${f.id}/download" class="file-action" style="text-decoration:none">Download</a>`:`<button class="file-action" onclick="toast('Downloading: ${f.name}')">Download</button>`}<button class="file-action" style="color:var(--danger)" onclick="deleteFile(${f.id})">Delete</button></div></div>`).join('') : '<div style="font-size:11px;color:var(--text-3);padding:20px 0;text-align:center">No files</div>';
}

function setFileFilter(f) { state.fileFilter = f; render(); }
async function uploadFile(inp) {
  if (!inp.files[0]) return;
  const formData = new FormData();
  formData.append('file', inp.files[0]);
  formData.append('type', 'report');
  try {
    const res = await fetch(API + '/files/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.file) state.files.unshift(data.file);
    inp.value = '';
    renderFilesList();
    toast('Uploaded: ' + data.file.name);
  } catch (e) { toast('Upload failed'); }
}
async function deleteFile(id) {
  if (!confirm('Delete this file?')) return;
  await api(`/files/${id}`, { method: 'DELETE' });
  state.files = state.files.filter(f => f.id !== id);
  renderFilesList();
}

function renderUpdate(c) {
  c.innerHTML = `
    <div class="section active">
      <div class="card">
        <div class="card-header"><div><div class="card-title">Update — API sources</div><div class="card-desc">Manage connections and trigger manual updates</div></div><button class="btn" onclick="syncAll()"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3a6 6 0 00-10 4M2 11a6 6 0 0010-4"/><path d="M12 3v3h-3M2 11v-3h3"/></svg>Update all</button></div>
        ${state.sync.map(s => `<div style="background:var(--surface-2);border-radius:8px;padding:11px 13px;margin-bottom:9px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><div style="display:flex;align-items:center;gap:8px"><div class="sync-dot" style="${!s.connected?'background:#94a3b8':''}"></div><strong>${s.name}</strong><span class="tag tag-neutral" style="font-size:10px">${s.connected?'Connected':'Setup needed'}</span></div><div style="display:flex;align-items:center;gap:8px"><span style="font-size:10px;color:var(--text-3)">${s.lastSync?new Date(s.lastSync).toLocaleTimeString():'—'}</span><button class="btn btn-sm" onclick="toast('${s.name} — update triggered')">Update</button></div></div>
          ${s.items.map(it => `<div style="font-size:11px;color:var(--text-2);padding:3px 0;display:flex;align-items:center;gap:6px"><div class="dot" style="background:${s.connected?'var(--success)':'#94a3b8'}"></div>${it}</div>`).join('')}
        </div>`).join('')}
      </div>
    </div>`;
}

function switchView(btn, panelId) {
  btn.parentElement.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
  btn.closest('.section').querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(panelId).classList.add('active');
}

function openAddReserve() {
  ['rs-name','rs-amount'].forEach(id => document.getElementById(id).value = '');
  openModal('modal-reserve');
}
async function saveReserve() {
  const bank = document.getElementById('rs-bank').value;
  const name = document.getElementById('rs-name').value.trim();
  const amount = parseInt(document.getElementById('rs-amount').value) || 0;
  if (!name || !amount) { toast('Please fill name and amount'); return; }
  try {
    const r = await api('/reserves', { method: 'POST', body: JSON.stringify({ bank, name, amount }) });
    state.reserves.push({ id: r.id, bank, name, amount });
    closeModal('modal-reserve');
    render();
    toast('Reserve added');
  } catch (e) { toast('Error adding reserve'); }
}
async function deleteReserve(id) {
  await api(`/reserves/${id}`, { method: 'DELETE' });
  state.reserves = state.reserves.filter(r => r.id !== id);
  render();
}

async function syncSource(endpoint, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  dot.classList.add('spin'); lbl.textContent = 'Syncing...';
  try {
    await api(endpoint, { method: 'POST' });
    await loadAll();
    render();
    toast(label + ' — update complete');
  } catch (e) { toast('Sync failed'); }
  finally { dot.classList.remove('spin'); lbl.textContent = 'Updated now'; }
}
async function syncAll() {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  dot.classList.add('spin'); lbl.textContent = 'Syncing all...';
  try {
    await api('/sync/all', { method: 'POST' });
    await loadAll();
    render();
    toast('All sources updated');
  } catch (e) { toast('Sync failed'); }
  finally { dot.classList.remove('spin'); lbl.textContent = 'Updated now'; }
}

document.addEventListener('click', e => {
  if (e.target.closest('.nav-item')) {
    const sec = e.target.closest('.nav-item').dataset.section;
    if (sec) showSection(sec);
  }
  if (e.target.classList.contains('modal-backdrop')) closeModal(e.target.id);
});
document.getElementById('sync-all-btn').addEventListener('click', syncAll);

loadAll().then(render);
