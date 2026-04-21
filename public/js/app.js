// ── State ────────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('af_token'),
  user: null,
  section: 'dashboard',
  banks: [], reserves: [], cashflow: [], budget: [], revenue: [],
  clients: [], events: [], tasks: [], files: [], sync: [],
  pipeline: [], statements: null, users: [], invitations: [],
  selectedClientId: null, calYear: 2026, calMonth: 3,
  showDone: false, fileFilter: 'all',
  charts: {}, cfYear: 2026
};
const TODAY = new Date(2026, 3, 21);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const fmt  = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
const fmtK = v => (v<0?'-':'')+'$'+Math.round(Math.abs(v)/1000)+'k';
const daysTo = d => Math.ceil((new Date(d+'T00:00:00')-TODAY)/864e5);
const fmtDate = d => { const x=new Date(d+'T00:00:00'); return x.getDate()+' '+MONTHS[x.getMonth()].slice(0,3); };
const quarter = () => { const m = TODAY.getMonth(); return 'Q'+(Math.floor(m/3)+1)+' '+TODAY.getFullYear(); };

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
  try {
    const r = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({token, name, password: pass}) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error||'Registration failed'; err.classList.add('show'); return; }
    state.token = d.token; state.user = d.user;
    localStorage.setItem('af_token', d.token);
    history.replaceState(null,'','/');
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
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('reg-link').innerHTML = '';
}

function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('af_token');
  document.getElementById('app-screen').classList.remove('visible');
  document.getElementById('login-screen').classList.remove('hidden');
}

async function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.add('visible');
  document.getElementById('quarter-badge').textContent = quarter();
  document.getElementById('today-date').textContent = TODAY.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  updateUserUI();
  await loadAll();
  render();
}

function updateUserUI() {
  if (!state.user) return;
  const init = state.user.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('ua-init').textContent = init;
  document.getElementById('ua-name').textContent = state.user.name;
  document.getElementById('ua-role').textContent = state.user.role.charAt(0).toUpperCase()+state.user.role.slice(1);
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [banks,reserves,cashflow,budget,revenue,clients,events,tasks,files,sync,pipeline] = await Promise.all([
      apiCall('/cash'), apiCall('/reserves'), apiCall('/cashflow'), apiCall('/budget'),
      apiCall('/revenue'), apiCall('/clients'), apiCall('/events'), apiCall('/tasks'),
      apiCall('/files'), apiCall('/sync/status'), apiCall('/pipeline')
    ]);
    Object.assign(state, {banks,reserves,cashflow,budget,revenue,clients,events,tasks,files,sync,pipeline});
    setSyncStatus('Connected');
    recalcCashflow();
  } catch(e) { setSyncStatus('Connection error', true); }
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

// ── Toast / Modal ─────────────────────────────────────────────────────────────
function toast(msg) {
  const t=document.getElementById('toast'); if(!t) return;
  t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500);
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Navigation ────────────────────────────────────────────────────────────────
function showSection(name) {
  state.section = name;
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.section===name));
  render();
}

function render() {
  const c = document.getElementById('main-content'); if(!c) return;
  const s = state.section;
  if (s==='dashboard')   renderDashboard(c);
  else if (s==='cash')      renderCash(c);
  else if (s==='cashflow')  renderCashflow(c);
  else if (s==='budget')    renderBudget(c);
  else if (s==='revenue')   renderRevenue(c);
  else if (s==='pipeline')  renderPipeline(c);
  else if (s==='clients')   renderClients(c);
  else if (s==='statements')renderStatements(c);
  else if (s==='calendar')  renderCalendar(c);
  else if (s==='tasks')     renderTasks(c);
  else if (s==='files')     renderFiles(c);
  else if (s==='settings')  renderSettings(c);
}

function switchView(btn, panelId) {
  btn.parentElement.querySelectorAll('.view-tab').forEach(b=>b.classList.remove('active'));
  btn.closest('.section,.card')?.querySelectorAll('.view-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(panelId)?.classList.add('active');
}

function mkChart(id, type, data, extraOpts={}) {
  const ctx=document.getElementById(id); if(!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  const defaults = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: ctx=>fmtK(ctx.raw) } } },
    scales:{ x:{ ticks:{font:{size:10},color:'#475569'}, grid:{display:false} }, y:{ ticks:{callback:fmtK,font:{size:10},color:'#475569'}, grid:{color:'rgba(255,255,255,0.04)'} } }
  };
  state.charts[id] = new Chart(ctx, { type, data, options: mergeDeep(defaults, extraOpts) });
}

function mkDoughnut(id, labels, data, colors) {
  const ctx=document.getElementById(id); if(!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(ctx, {
    type:'doughnut', data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:0, hoverOffset:4 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'60%', plugins:{ legend:{ position:'right', labels:{ font:{size:10}, color:'#94a3b8', boxWidth:10, padding:8 } }, tooltip:{ callbacks:{ label:c=>c.label+': '+fmtK(c.raw) } } } }
  });
}

function mergeDeep(a, b) {
  const r={...a}; for(const k in b) { if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])) r[k]=mergeDeep(a[k]||{},b[k]); else r[k]=b[k]; }
  return r;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard(c) {
  const totalCash = state.banks.reduce((a,b)=>a+b.total,0);
  const reserved  = state.reserves.reduce((a,r)=>a+r.amount,0);
  const available = totalCash - reserved;
  const ytdRev    = state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.revenue,0);
  const ytdTgt    = state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.target,0);
  const ytdExp    = state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.expenses,0);
  const lastCF    = state.cashflow[state.cashflow.length-1];
  const decClose  = lastCF ? lastCF.opening+lastCF.inflow-lastCF.outflow : 0;
  const liabilities = 300000;
  const burnRate  = state.budget.reduce((a,b)=>{ const mo=b.months; const cur=mo&&mo['Apr']?mo['Apr'].actual:b.actualMo||0; return a+cur; },0);
  const runway    = burnRate ? Math.round(available/burnRate) : 0;

  const pipeWtd = state.pipeline.reduce((a,d)=>a+d.value*(d.probability/100),0);

  let alerts = '';
  const cloud = state.budget.find(b=>b.cat==='Cloud');
  if (cloud) { const mo=Math.round(cloud.annual/12),act=cloud.months?.Apr?.actual||0; if(act>mo) alerts+=`<div class="alert alert-r">⚠ <span><strong>Cloud over budget</strong> — ${Math.round(act/mo*100)}% of monthly target used</span></div>`; }
  if (available<500000) alerts+=`<div class="alert alert-a">ℹ <span>Available cash ${fmt(available)} — monitor reserves</span></div>`;
  if (ytdRev>ytdTgt) alerts+=`<div class="alert alert-g">✓ <span><strong>Revenue ahead of target</strong> — +${fmt(ytdRev-ytdTgt)} YTD</span></div>`;

  c.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px">
    ${alerts}
    <div class="card" style="padding:12px 18px">
      <div style="font-size:11px;color:var(--text-2);margin-bottom:10px">Easy reading flow — from cash position to forecast</div>
      <div class="flow-bar">
        ${[['Cash Position','dashboard'],['Cash Free','cash'],['Liabilities','statements'],['Revenue & Pipeline','revenue'],['Budget & Clients','budget']].map(([l,s],i)=>`
        <div class="flow-step">
          <div class="flow-node${state.section===s?' active':''}" onclick="showSection('${s}')">
            <div class="flow-num">${i+1}</div>
            <div class="flow-label">${l}</div>
          </div>${i<4?'<div class="flow-arrow">→</div>':''}
        </div>`).join('')}
      </div>
    </div>
    <div class="grid-5">
      <div class="metric"><div class="metric-label">Total Cash</div><div class="metric-value">${fmtK(totalCash)}</div><div class="metric-sub"><span class="dot" style="background:var(--success)"></span>${state.banks.length} bank accounts</div></div>
      <div class="metric"><div class="metric-label">Revenue YTD</div><div class="metric-value">${fmtK(ytdRev)}</div><div class="metric-sub"><span class="dot" style="background:var(--success)"></span>${ytdTgt?((ytdRev/ytdTgt)*100).toFixed(0):0}% of target</div></div>
      <div class="metric"><div class="metric-label">Sales Pipeline</div><div class="metric-value" style="color:var(--primary)">${fmtK(pipeWtd)}</div><div class="metric-sub">weighted value</div></div>
      <div class="metric"><div class="metric-label">Expense YTD</div><div class="metric-value">${fmtK(ytdExp)}</div><div class="metric-sub">Regular operating spend</div></div>
      <div class="metric"><div class="metric-label">Forecast Dec</div><div class="metric-value" style="color:var(--success)">${fmtK(decClose)}</div><div class="metric-sub">12-month view</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><div class="card-title">Cash by Bank</div><span style="font-size:10px;color:var(--text-2)">Available vs reserved</span></div><div class="chart-wrap chart-wrap-lg"><canvas id="ch-banks"></canvas></div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${state.banks.map(b=>`<div style="font-size:11px;flex:1;min-width:80px;background:var(--surface-2);border-radius:6px;padding:7px 10px"><div style="color:var(--text-2)">${b.name}</div><div style="font-weight:600;margin-top:2px">${fmt(b.total)}</div></div>`).join('')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="card"><div class="card-header"><div class="card-title">Revenue vs Target</div></div><div class="chart-wrap"><canvas id="ch-rev"></canvas></div></div>
        <div class="card">
          <div class="card-title" style="margin-bottom:10px">Security & Access</div>
          ${[['Individual accounts only','Each user gets separate sign-in access','var(--success)'],['Multi-factor authentication','MFA required for Finance and Senior roles','var(--warning)'],['Role-based permissions','CFO, Finance, Sales, Admin, Department heads','var(--info)'],['Audit trail','Track all exports, deletes, entries and expenses','var(--primary)']].map(([t,d,c])=>`<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px"><div style="width:7px;height:7px;border-radius:50%;background:${c};flex-shrink:0;margin-top:4px"></div><div><div style="font-size:11px;font-weight:500">${t}</div><div style="font-size:10px;color:var(--text-2)">${d}</div></div></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><div class="card-title">Cash Flow Forecast</div></div><div class="chart-wrap"><canvas id="ch-cf"></canvas></div></div>
      <div class="card"><div class="card-header"><div class="card-title">Expense Distribution</div></div><div class="chart-wrap"><canvas id="ch-bud-pie"></canvas></div></div>
    </div>
  </div>`;

  setTimeout(()=>{
    const resMap={}; state.banks.forEach(b=>resMap[b.name]=0);
    state.reserves.forEach(r=>{resMap[r.bank]=(resMap[r.bank]||0)+r.amount;});
    mkChart('ch-banks','bar',{
      labels:state.banks.map(b=>b.name),
      datasets:[
        {label:'Available',data:state.banks.map(b=>b.total-(resMap[b.name]||0)),backgroundColor:'#f97316',borderRadius:5},
        {label:'Reserved',data:state.banks.map(b=>resMap[b.name]||0),backgroundColor:'rgba(249,115,22,0.3)',borderRadius:5}
      ]
    },{scales:{x:{stacked:true,ticks:{font:{size:11},color:'#8898aa'},grid:{display:false}},y:{stacked:true,ticks:{callback:fmtK,font:{size:10},color:'#8898aa'},grid:{color:'rgba(255,255,255,0.04)'}}}});
    mkChart('ch-rev','bar',{
      labels:state.revenue.map(r=>r.month),
      datasets:[
        {label:'Revenue',data:state.revenue.map(r=>r.revenue),backgroundColor:'rgba(249,115,22,0.85)',borderRadius:3},
        {label:'Target',data:state.revenue.map(r=>r.target),backgroundColor:'rgba(255,255,255,0.1)',borderRadius:3}
      ]
    });
    mkChart('ch-cf','line',{
      labels:state.cashflow.map(d=>d.month.split(' ')[0]),
      datasets:[{data:state.cashflow.map(d=>d.opening+d.inflow-d.outflow),borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,0.06)',fill:true,borderWidth:2,pointRadius:0,tension:.3}]
    });
    const budLabels=state.budget.map(b=>b.cat);
    const budData=state.budget.map(b=>{ const mo=b.months; const v=Object.values(mo||{}).reduce((a,m)=>a+(m.actual||0),0); return v||b.actualMo||0; });
    const budColors=['#f97316','#fb923c','#fdba74','#22c55e','#3b82f6','#a855f7'];
    mkDoughnut('ch-bud-pie',budLabels,budData,budColors);
  },50);
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
      <div class="grid-4" style="margin-bottom:12px">
        ${state.banks.map(b=>{ const bRes=state.reserves.filter(r=>r.bank===b.name).reduce((a,r)=>a+r.amount,0);
          return `<div class="metric"><div class="metric-label">${b.name}</div><div class="metric-value">${fmtK(b.total)}</div><div class="metric-sub"><span style="color:var(--success)">Avail ${fmtK(b.total-bRes)}</span> · ${b.type}</div></div>`; }).join('')}
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
      datasets:[{label:'Available',data:state.banks.map(b=>b.total-(resMap[b.name]||0)),backgroundColor:'#f97316',borderRadius:5},{label:'Reserved',data:state.banks.map(b=>resMap[b.name]||0),backgroundColor:'rgba(249,115,22,0.3)',borderRadius:5}]
    },{scales:{x:{stacked:true,grid:{display:false},ticks:{color:'#8898aa'}},y:{stacked:true,ticks:{callback:fmtK,color:'#8898aa'},grid:{color:'rgba(255,255,255,0.04)'}}}});
  },50);
}

function renderReservesList() {
  const el=document.getElementById('reserves-list'); if(!el) return;
  el.innerHTML=state.reserves.length ? state.reserves.map(r=>`
    <div class="reserve-row">
      <div style="display:flex;gap:10px;min-width:0"><strong style="color:var(--primary)">${r.bank}</strong><span style="color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</span></div>
      <div style="display:flex;align-items:center;gap:10px"><strong style="color:var(--danger-text)">${fmt(r.amount)}</strong><button class="del-btn" onclick="deleteReserve(${r.id})">×</button></div>
    </div>`).join('') : '<div style="font-size:11px;color:var(--text-3);padding:14px 0;text-align:center">No reserves added yet</div>';
}

function openAddReserve() { ['rs-name','rs-amount'].forEach(id=>document.getElementById(id).value=''); openModal('modal-reserve'); }
async function saveReserve() {
  const bank=document.getElementById('rs-bank').value, name=document.getElementById('rs-name').value.trim(), amount=parseInt(document.getElementById('rs-amount').value)||0;
  if (!name||!amount) { toast('Please fill name and amount'); return; }
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
      <button class="view-tab active" onclick="switchView(this,'cf-charts')">Charts</button>
      <button class="view-tab" onclick="switchView(this,'cf-edit')">Edit — Direct Input</button>
    </div>
    <div class="view-panel active" id="cf-charts">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Cash Flow Forecast — FY ${state.cfYear}</div><div class="card-desc">12-month view from January to December</div></div>
          <div style="display:flex;gap:6px;align-items:center">
            <select class="input" style="padding:4px 8px" onchange="changeCfYear(this.value)">${[2025,2026,2027,2028].map(y=>`<option value="${y}"${y===state.cfYear?' selected':''}>${y}</option>`).join('')}</select>
            <button class="btn btn-sm" onclick="syncSource('/cashflow/sync','QuickBooks')">↻ Sync</button>
          </div>
        </div>
        <div style="margin-bottom:10px;display:flex;gap:14px;font-size:11px;color:var(--text-2)">
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:#f97316;border-radius:2px;display:inline-block"></span>Inflow</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;background:rgba(255,255,255,0.2);border-radius:2px;display:inline-block"></span>Outflow</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:22px;height:2px;background:#22c55e;display:inline-block"></span>Closing Balance</span>
        </div>
        <div class="chart-wrap chart-wrap-lg"><canvas id="chart-cf-detail"></canvas></div>
        <div class="grid-4" style="margin-top:12px">
          <div class="metric"><div class="metric-label">Opening Jan</div><div class="metric-value">${fmtK(firstRow?.opening||0)}</div></div>
          <div class="metric"><div class="metric-label">Total Inflow</div><div class="metric-value" style="color:var(--success)">${fmtK(ti)}</div></div>
          <div class="metric"><div class="metric-label">Total Outflow</div><div class="metric-value" style="color:var(--danger-text)">${fmtK(to)}</div></div>
          <div class="metric" style="background:var(--success-bg);border-color:rgba(34,197,94,.2)"><div class="metric-label" style="color:var(--success-text)">Dec Closing</div><div class="metric-value" style="color:var(--success)">${fmtK(closing)}</div></div>
        </div>
      </div>
    </div>
    <div class="view-panel" id="cf-edit">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Cash Flow — Direct Input</div><div class="card-desc">Headers: Month | Opening Balance | Inflow | Outflow</div></div>
          <div style="display:flex;gap:6px">
            <label class="btn btn-sm" style="cursor:pointer">⬇ Upload Excel<input type="file" accept=".xlsx,.xls" style="display:none" onchange="uploadCfExcel(this)"></label>
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
          </table>
        </div>
        <div class="save-bar" id="cf-savebar"><span class="save-hint">⚠ Unsaved changes</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="discardCashflow()">Discard</button><button class="btn btn-primary btn-sm" onclick="saveCashflow()">Save</button></div></div>
      </div>
    </div>
  </div>`;
  setTimeout(()=>{
    mkChart('chart-cf-detail','bar',{
      labels:state.cashflow.map(d=>d.month.split(' ')[0]),
      datasets:[
        {label:'Inflow',type:'bar',data:state.cashflow.map(d=>d.inflow),backgroundColor:'#f97316',borderRadius:4},
        {label:'Outflow',type:'bar',data:state.cashflow.map(d=>d.outflow),backgroundColor:'rgba(255,255,255,0.12)',borderRadius:4},
        {label:'Closing',type:'line',data:state.cashflow.map(d=>d.opening+d.inflow-d.outflow),borderColor:'#22c55e',backgroundColor:'transparent',borderWidth:2.5,pointRadius:3,pointBackgroundColor:'#22c55e',tension:.3}
      ]
    });
  },50);
}

function openCfDetail(i) {
  const r=state.cashflow[i], net=r.inflow-r.outflow, cl=r.opening+net;
  document.getElementById('cf-detail-title').textContent=`Cash Flow Detail — ${r.month}`;
  document.getElementById('cf-detail-content').innerHTML=`
    <div class="grid-3" style="margin-bottom:14px">
      <div class="metric"><div class="metric-label">Opening Balance</div><div class="metric-value">${fmt(r.opening)}</div></div>
      <div class="metric"><div class="metric-label">Net Cash</div><div class="metric-value ${net>=0?'val-pos':'val-neg'}">${net>=0?'+':''}${fmt(net)}</div></div>
      <div class="metric" style="background:var(--success-bg)"><div class="metric-label">Closing Balance</div><div class="metric-value" style="color:var(--success)">${fmt(cl)}</div></div>
    </div>
    <table class="table"><thead><tr><th>Item</th><th>Amount</th></tr></thead><tbody>
      <tr><td style="color:var(--success-text)">Total Inflow</td><td class="val-pos">${fmt(r.inflow)}</td></tr>
      <tr><td style="color:var(--danger-text)">Total Outflow</td><td class="val-neg">-${fmt(r.outflow)}</td></tr>
      <tr style="font-weight:600"><td>Net Movement</td><td class="${net>=0?'val-pos':'val-neg'}">${net>=0?'+':''}${fmt(net)}</td></tr>
    </tbody></table>
    <div style="margin-top:12px;font-size:11px;color:var(--text-2)">Connect QuickBooks to see line-by-line inflow/outflow breakdown per transaction.</div>`;
  openModal('modal-cf-detail');
}

function changeCfYear(y) { state.cfYear=Number(y); render(); }
function updateCashflow(i,field,val) { const n=parseInt(String(val).replace(/[^0-9-]/g,'')); if(!isNaN(n)) state.cashflow[i][field]=n; recalcCashflow(); }
function showCfSave() { document.getElementById('cf-savebar')?.classList.add('visible'); }
async function saveCashflow() { try { await apiCall('/cashflow',{method:'PUT',body:JSON.stringify({cashflow:state.cashflow})}); toast('Cash flow saved'); render(); } catch(e) { toast('Error: '+e.message); } }
function discardCashflow() { loadAll().then(render); }

async function uploadCfExcel(inp) {
  if (!inp.files[0]) return;
  const fd=new FormData(); fd.append('file',inp.files[0]);
  try {
    const res=await fetch('/api/cashflow/upload-excel',{method:'POST',headers:{'Authorization':'Bearer '+state.token},body:fd});
    const d=await res.json(); if(!res.ok) throw new Error(d.error);
    await loadAll(); render(); toast(`Excel imported — ${d.imported} rows`);
  } catch(e) { toast('Upload failed: '+e.message); }
}

// ── Budget ────────────────────────────────────────────────────────────────────
function budgetCurrentMonth() { return MO[TODAY.getMonth()]; }

function renderBudget(c) {
  const curMo=budgetCurrentMonth();
  const totalAnnual=state.budget.reduce((a,b)=>a+b.annual,0);
  const totalActual=state.budget.reduce((a,b)=>a+(b.months?.[curMo]?.actual||0),0);
  const budLabels=state.budget.map(b=>b.cat);
  const budActuals=state.budget.map(b=>b.months?.[curMo]?.actual||0);
  const budTargets=state.budget.map(b=>b.months?.[curMo]?.target||Math.round(b.annual/12));

  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab active" onclick="switchView(this,'bud-charts')">Charts</button>
      <button class="view-tab" onclick="switchView(this,'bud-edit')">Edit Targets</button>
    </div>
    <div class="view-panel active" id="bud-charts">
      <div class="grid-3" style="margin-bottom:12px">
        <div class="metric"><div class="metric-label">Annual Budget</div><div class="metric-value">${fmtK(totalAnnual)}</div></div>
        <div class="metric"><div class="metric-label">Actual ${curMo}</div><div class="metric-value" style="color:var(--primary)">${fmtK(totalActual)}</div></div>
        <div class="metric"><div class="metric-label">Monthly Target</div><div class="metric-value">${fmtK(Math.round(totalAnnual/12))}</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">Budget vs Actual — ${curMo}</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-bud-bar"></canvas></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Expense Distribution</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-bud-donut"></canvas></div></div>
      </div>
    </div>
    <div class="view-panel" id="bud-edit">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Budget Targets — FY 2026</div><div class="card-desc">Click category name to rename · Click Details to see monthly breakdown</div></div>
          <div style="display:flex;gap:6px">
            <label class="btn btn-sm" style="cursor:pointer">⬇ Upload Excel<input type="file" accept=".xlsx,.xls" style="display:none" onchange="uploadBudgetExcel(this)"></label>
            <button class="btn btn-sm" onclick="syncSource('/budget/sync','QuickBooks')">↻ Sync</button>
            <button class="btn btn-primary btn-sm" onclick="addBudgetRow()">+ Row</button>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Category</th><th>Annual <span class="badge-manual">edit</span></th><th>Monthly <span class="badge-auto">auto</span></th><th>Actual/${curMo} <span class="badge-qbo">QBO</span></th><th>vs Budget</th><th>Status</th><th></th></tr></thead>
            <tbody id="budget-tbody">${renderBudgetRows(curMo)}</tbody>
          </table>
        </div>
        <div class="save-bar" id="bud-savebar"><span class="save-hint">⚠ Unsaved changes</span><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="discardBudget()">Discard</button><button class="btn btn-primary btn-sm" onclick="saveBudget()">Save</button></div></div>
      </div>
    </div>
  </div>`;

  setTimeout(()=>{
    mkChart('chart-bud-bar','bar',{
      labels:budLabels,
      datasets:[
        {label:'Target',data:budTargets,backgroundColor:'rgba(255,255,255,0.1)',borderRadius:4},
        {label:'Actual',data:budActuals,backgroundColor:budActuals.map((v,i)=>v>budTargets[i]?'#ef4444':'#f97316'),borderRadius:4}
      ]
    },{indexAxis:'y'});
    const colors=['#f97316','#fb923c','#fdba74','#22c55e','#3b82f6','#a855f7','#ec4899','#14b8a6'];
    mkDoughnut('chart-bud-donut',budLabels,budActuals,colors.slice(0,budLabels.length));
  },50);
}

function renderBudgetRows(curMo) {
  return state.budget.map((r,i)=>{
    const mo=r.months?.[curMo]?.target||Math.round(r.annual/12);
    const act=r.months?.[curMo]?.actual||0;
    const pct=mo?Math.round((act/mo)*100):0;
    const over=pct>100;
    return `<tr>
      <td><span class="editable-cat" style="cursor:pointer;border-bottom:1px dashed var(--border-2);padding-bottom:1px" onclick="editBudgetCat(${i},this)">${r.cat}</span></td>
      <td><input class="input input-cell" type="text" value="${fmt(r.annual)}" onchange="updateBudgetAnnual(${i},this.value)" oninput="this.classList.add('modified');document.getElementById('bud-savebar').classList.add('visible')"></td>
      <td style="color:var(--text-2)">${fmt(mo)}</td>
      <td><input class="input input-cell" type="text" value="${fmt(act)}" onchange="updateBudgetActual(${i},'${curMo}',this.value)" oninput="this.classList.add('modified');document.getElementById('bud-savebar').classList.add('visible')"></td>
      <td class="${over?'val-neg':'val-pos'}">${over?'+':'-'}${fmt(Math.abs(act-mo))}</td>
      <td><div style="display:flex;align-items:center;gap:5px"><div class="progress-track"><div class="progress-fill${over?' over':''}" style="width:${Math.min(pct,100)}%"></div></div><span style="font-size:10px;${over?'color:var(--danger)':'color:var(--success)'}">${pct}%</span></div></td>
      <td style="display:flex;gap:4px"><button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="openBudgetDetail(${i})">Details</button><button class="del-btn" onclick="deleteBudgetRow(${r.id})">×</button></td>
    </tr>`;
  }).join('');
}

function editBudgetCat(i, el) {
  const old=el.textContent;
  const inp=document.createElement('input');
  inp.className='input'; inp.value=old; inp.style.width='120px';
  el.replaceWith(inp); inp.focus(); inp.select();
  const save=async()=>{ const val=inp.value.trim()||old; state.budget[i].cat=val; try { await apiCall(`/budget/${state.budget[i].id}`,{method:'PUT',body:JSON.stringify({cat:val})}); toast('Category renamed'); } catch {}  render(); };
  inp.onblur=save; inp.onkeydown=e=>{ if(e.key==='Enter') inp.blur(); if(e.key==='Escape'){inp.value=old;inp.blur();} };
}

function updateBudgetAnnual(i,val) { const n=parseInt(String(val).replace(/[^0-9]/g,'')); if(!isNaN(n)) state.budget[i].annual=n; }
function updateBudgetActual(i,month,val) { const n=parseInt(String(val).replace(/[^0-9]/g,'')); if(!isNaN(n)&&state.budget[i].months?.[month]) state.budget[i].months[month].actual=n; }

async function addBudgetRow() {
  try { const r=await apiCall('/budget',{method:'POST',body:JSON.stringify({cat:'New Category',annual:0})}); state.budget.push(r.item); render(); toast('Row added — click name to rename'); } catch(e) { toast(e.message); }
}
async function deleteBudgetRow(id) {
  if (!confirm('Delete this budget category?')) return;
  await apiCall(`/budget/${id}`,{method:'DELETE'}); state.budget=state.budget.filter(b=>b.id!==id); render();
}
async function saveBudget() {
  try {
    await Promise.all(state.budget.map(b=>apiCall(`/budget/${b.id}`,{method:'PUT',body:JSON.stringify({annual:b.annual,cat:b.cat,note:b.note||''})})));
    toast('Budget saved'); render();
  } catch(e) { toast('Error: '+e.message); }
}
function discardBudget() { loadAll().then(render); }

function openBudgetDetail(i) {
  const b=state.budget[i];
  document.getElementById('bud-detail-title').textContent=`${b.cat} — Monthly Detail`;
  const rows=MO.map(m=>{
    const mo=b.months?.[m]||{target:Math.round(b.annual/12),actual:0,details:[]};
    const pct=mo.target?Math.round((mo.actual/mo.target)*100):0;
    const over=pct>100;
    return `<tr>
      <td><strong>${m}</strong></td>
      <td>${fmt(mo.target)}</td>
      <td><input class="input input-cell" type="text" value="${fmt(mo.actual)}" onchange="updateMonthActual(${i},'${m}',this.value)"></td>
      <td class="${over?'val-neg':'val-pos'}">${pct}%</td>
      <td><button class="btn btn-sm" style="font-size:10px;padding:2px 7px" onclick="openMonthDetails(${i},'${m}')">Items</button></td>
    </tr>`;
  }).join('');
  document.getElementById('bud-detail-content').innerHTML=`
    <table class="table" style="margin-bottom:10px">
      <thead><tr><th>Month</th><th>Target</th><th>Actual <span class="badge-manual">edit</span></th><th>%</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button class="btn btn-primary btn-sm" onclick="saveBudgetMonths(${i})">Save Monthly Data</button>`;
  openModal('modal-budget-detail');
}

function updateMonthActual(i,m,val) { const n=parseInt(String(val).replace(/[^0-9]/g,'')); if(!isNaN(n)&&state.budget[i].months?.[m]) state.budget[i].months[m].actual=n; }
async function saveBudgetMonths(i) {
  const b=state.budget[i];
  try {
    await Promise.all(MO.map(m=>apiCall(`/budget/${b.id}/month/${m}`,{method:'PUT',body:JSON.stringify({actual:b.months[m]?.actual||0,target:b.months[m]?.target||0})})));
    toast('Monthly data saved');
  } catch(e) { toast(e.message); }
}

function openMonthDetails(budIdx, month) {
  const b=state.budget[budIdx];
  const mo=b.months?.[month]||{target:0,actual:0,details:[]};
  const dets=Array.isArray(mo.details)?mo.details:[];
  document.getElementById('bud-detail-title').textContent=`${b.cat} — ${month} 2026 — Payment Details`;
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
    const r=await apiCall(`/budget/${b.id}/month/${month}/detail`,{method:'POST',body:JSON.stringify({vendor,amount,date,note})});
    if(!b.months[month].details) b.months[month].details=[];
    b.months[month].details.push(r.detail);
    openMonthDetails(budIdx,month);
    toast('Detail added');
  } catch(e) { toast(e.message); }
}

async function deleteDetail(budIdx, month, did) {
  const b=state.budget[budIdx];
  await apiCall(`/budget/${b.id}/month/${month}/detail/${did}`,{method:'DELETE'});
  if(b.months[month]?.details) b.months[month].details=b.months[month].details.filter(d=>d.id!==did);
  openMonthDetails(budIdx,month);
}

async function uploadBudgetExcel(inp) {
  if (!inp.files[0]) return;
  const fd=new FormData(); fd.append('file',inp.files[0]);
  try {
    const res=await fetch('/api/budget/upload-excel',{method:'POST',headers:{'Authorization':'Bearer '+state.token},body:fd});
    const d=await res.json(); if(!res.ok) throw new Error(d.error);
    await loadAll(); render(); toast(`Excel imported — ${d.imported} rows`);
  } catch(e) { toast('Upload failed: '+e.message); }
}

// ── Revenue ───────────────────────────────────────────────────────────────────
function renderRevenue(c) {
  const withAct=state.revenue.filter(r=>r.revenue>0);
  const ytdRev=withAct.reduce((a,r)=>a+r.revenue,0);
  const ytdTgt=withAct.reduce((a,r)=>a+r.target,0);
  const pct=ytdTgt?((ytdRev/ytdTgt)*100).toFixed(1):0;
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab active" onclick="switchView(this,'rev-charts')">Charts</button>
      <button class="view-tab" onclick="switchView(this,'rev-edit')">Edit — 12 Months</button>
    </div>
    <div class="view-panel active" id="rev-charts">
      <div class="grid-3" style="margin-bottom:12px">
        <div class="metric"><div class="metric-label">Revenue YTD</div><div class="metric-value">${fmtK(ytdRev)}</div></div>
        <div class="metric"><div class="metric-label">Achievement</div><div class="metric-value" style="color:var(--success)">${pct}%</div></div>
        <div class="metric"><div class="metric-label">vs Target YTD</div><div class="metric-value" style="color:${ytdRev>=ytdTgt?'var(--success)':'var(--danger-text)'}">${ytdRev>=ytdTgt?'+':''}${fmtK(ytdRev-ytdTgt)}</div></div>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">Revenue vs Target — FY 2026</div><button class="btn btn-sm" onclick="syncSource('/revenue/sync','QuickBooks + HubSpot')">↻ Sync</button></div><div class="chart-wrap chart-wrap-lg"><canvas id="chart-rev-detail"></canvas></div></div>
    </div>
    <div class="view-panel" id="rev-edit">
      <div class="card">
        <div class="card-header"><div class="card-title">Revenue Targets — 12 Months</div><button class="btn btn-sm" onclick="syncSource('/revenue/sync','QuickBooks')">↻ Sync</button></div>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Month</th><th>Actual <span class="badge-qbo">QBO</span></th><th>Target <span class="badge-manual">edit</span></th><th>Variance</th><th>Expenses <span class="badge-qbo">QBO</span></th><th>Margin</th></tr></thead>
            <tbody>${state.revenue.map((r,i)=>{
              const v=r.revenue-r.target;
              const mg=r.revenue?Math.round(((r.revenue-r.expenses)/r.revenue)*100):0;
              return `<tr>
                <td><strong>${r.month}</strong></td>
                <td style="color:var(--text-2)">${r.revenue?fmt(r.revenue):'—'}</td>
                <td><input class="input input-cell" type="text" value="${fmt(r.target)}" onchange="updateRevenue(${i},'target',this.value)" oninput="this.classList.add('modified');showRevSave()"></td>
                <td class="${v>=0?'val-pos':'val-neg'}">${r.revenue?(v>=0?'+':'')+(fmt(v)):'—'}</td>
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
    mkChart('chart-rev-detail','bar',{
      labels:state.revenue.map(r=>r.month),
      datasets:[
        {label:'Revenue',data:state.revenue.map(r=>r.revenue),backgroundColor:'#f97316',borderRadius:4},
        {label:'Target',data:state.revenue.map(r=>r.target),backgroundColor:'rgba(255,255,255,0.1)',borderRadius:4}
      ]
    });
  },50);
}
function updateRevenue(i,f,v){const n=parseInt(String(v).replace(/[^0-9]/g,''));if(!isNaN(n))state.revenue[i][f]=n;}
function showRevSave(){document.getElementById('rev-savebar')?.classList.add('visible');}
async function saveRevenue(){try{await apiCall('/revenue',{method:'PUT',body:JSON.stringify({revenue:state.revenue})});toast('Revenue saved');render();}catch(e){toast(e.message);}}
function discardRevenue(){loadAll().then(render);}

// ── Sales Pipeline ────────────────────────────────────────────────────────────
const STAGE_COLORS={'Prospecting':'#475569','Qualification':'#3b82f6','Proposal':'#f59e0b','Negotiation':'#f97316','Closed Won':'#22c55e','Closed Lost':'#ef4444'};

function renderPipeline(c) {
  const byType={}, byStage={};
  let totalVal=0, weightedVal=0;
  state.pipeline.forEach(d=>{
    byType[d.type]=(byType[d.type]||0)+d.value;
    byStage[d.stage]=(byStage[d.stage]||0)+1;
    totalVal+=d.value; weightedVal+=d.value*(d.probability/100);
  });
  const active=state.pipeline.filter(d=>d.stage!=='Closed Won'&&d.stage!=='Closed Lost');
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="view-tabs" style="width:fit-content">
      <button class="view-tab active" onclick="switchView(this,'pipe-charts')">Overview</button>
      <button class="view-tab" onclick="switchView(this,'pipe-list')">All Deals</button>
    </div>
    <div class="view-panel active" id="pipe-charts">
      <div class="grid-4" style="margin-bottom:12px">
        <div class="metric"><div class="metric-label">Total Pipeline</div><div class="metric-value">${fmtK(totalVal)}</div></div>
        <div class="metric"><div class="metric-label">Weighted Value</div><div class="metric-value" style="color:var(--primary)">${fmtK(weightedVal)}</div></div>
        <div class="metric"><div class="metric-label">Active Deals</div><div class="metric-value">${active.length}</div></div>
        <div class="metric" style="background:var(--success-bg)"><div class="metric-label">Closed Won</div><div class="metric-value" style="color:var(--success)">${fmtK(byType['Enterprise']||0)}</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">Pipeline by Deal Type</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="pipe-type-chart"></canvas></div></div>
        <div class="card"><div class="card-header"><div class="card-title">Deals by Stage</div></div><div class="chart-wrap chart-wrap-lg"><canvas id="pipe-stage-chart"></canvas></div></div>
      </div>
    </div>
    <div class="view-panel" id="pipe-list">
      <div class="card">
        <div class="card-header"><div><div class="card-title">Sales Pipeline — All Deals</div><div class="card-desc">HubSpot connected · manual override enabled</div></div><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="syncSource('/pipeline/sync','HubSpot')">↻ HubSpot</button><button class="btn btn-primary btn-sm" onclick="openAddDeal()">+ Add Deal</button></div></div>
        ${state.pipeline.map(d=>{
          const col=STAGE_COLORS[d.stage]||'#475569';
          const wtd=Math.round(d.value*d.probability/100);
          return `<div class="deal-row">
            <div style="width:3px;border-radius:2px;background:${col};align-self:stretch;flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:600">${d.name}</div>
              <div style="font-size:10px;color:var(--text-2);margin-top:2px">${d.client} · ${d.owner} · Close: ${fmtDate(d.closeDate)}</div>
            </div>
            <span class="stage-badge" style="background:${col}22;color:${col}">${d.stage}</span>
            <span class="tag ${d.type==='Enterprise'?'tag-primary':d.type==='Government'?'tag-info':'tag-purple'}">${d.type}</span>
            <div style="text-align:right;min-width:90px"><div style="font-size:13px;font-weight:700">${fmtK(d.value)}</div><div style="font-size:10px;color:var(--text-2)">${d.probability}% → ${fmtK(wtd)}</div></div>
            <button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="editDeal(${d.id})">Edit</button>
            <button class="del-btn" onclick="deleteDeal(${d.id})">×</button>
          </div>`;}).join('')}
      </div>
    </div>
  </div>`;
  setTimeout(()=>{
    const typeLabels=Object.keys(byType), typeData=Object.values(byType);
    mkDoughnut('pipe-type-chart',typeLabels,typeData,['#f97316','#3b82f6','#a855f7']);
    const stLabels=Object.keys(byStage), stData=Object.values(byStage);
    mkChart('pipe-stage-chart','bar',{labels:stLabels,datasets:[{data:stData,backgroundColor:stLabels.map(s=>STAGE_COLORS[s]||'#475569'),borderRadius:4}]});
  },50);
}

function openAddDeal() {
  document.getElementById('deal-modal-title').textContent='Add Deal';
  ['deal-name','deal-client','deal-owner','deal-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('deal-value').value=''; document.getElementById('deal-prob').value='75';
  document.getElementById('deal-close').value=''; delete document.getElementById('modal-deal').dataset.editId;
  openModal('modal-deal');
}
function editDeal(id) {
  const d=state.pipeline.find(x=>x.id===id); if(!d) return;
  document.getElementById('deal-modal-title').textContent='Edit Deal';
  document.getElementById('deal-name').value=d.name; document.getElementById('deal-client').value=d.client;
  document.getElementById('deal-type').value=d.type; document.getElementById('deal-value').value=d.value;
  document.getElementById('deal-prob').value=d.probability; document.getElementById('deal-stage').value=d.stage;
  document.getElementById('deal-close').value=d.closeDate; document.getElementById('deal-owner').value=d.owner;
  document.getElementById('deal-notes').value=d.notes||'';
  document.getElementById('modal-deal').dataset.editId=id;
  openModal('modal-deal');
}
async function saveDeal() {
  const data={name:document.getElementById('deal-name').value.trim(),client:document.getElementById('deal-client').value.trim(),type:document.getElementById('deal-type').value,value:Number(document.getElementById('deal-value').value)||0,probability:Number(document.getElementById('deal-prob').value)||0,stage:document.getElementById('deal-stage').value,closeDate:document.getElementById('deal-close').value,owner:document.getElementById('deal-owner').value.trim(),notes:document.getElementById('deal-notes').value};
  if (!data.name) { toast('Deal name required'); return; }
  const eid=document.getElementById('modal-deal').dataset.editId;
  try {
    if (eid) { const r=await apiCall(`/pipeline/${eid}`,{method:'PUT',body:JSON.stringify(data)}); const i=state.pipeline.findIndex(x=>x.id===Number(eid)); if(i>-1) state.pipeline[i]=r.deal; }
    else { const r=await apiCall('/pipeline',{method:'POST',body:JSON.stringify(data)}); state.pipeline.push(r.deal); }
    closeModal('modal-deal'); render(); toast('Deal saved');
  } catch(e) { toast(e.message); }
}
async function deleteDeal(id) {
  if(!confirm('Delete this deal?')) return;
  await apiCall(`/pipeline/${id}`,{method:'DELETE'}); state.pipeline=state.pipeline.filter(d=>d.id!==id); render();
}

// ── Clients ───────────────────────────────────────────────────────────────────
function renderClients(c) {
  c.innerHTML=`
  <div class="clients-grid">
    <div class="card" style="max-height:680px;overflow-y:auto">
      <div class="card-header" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:center"><div class="card-title">Clients</div><span style="font-size:10px;padding:2px 8px;border-radius:4px;background:var(--info-bg);color:var(--info)">QuickBooks</span></div>
        <div style="display:flex;gap:6px"><button class="btn btn-sm" style="flex:1" onclick="syncSource('/clients/sync','QuickBooks')">↻ Sync</button><button class="btn btn-primary btn-sm" onclick="openAddClient()">+ Add</button></div>
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
  const list=state.clients.filter(c=>!filter||c.name.toLowerCase().includes(filter.toLowerCase())||c.type.toLowerCase().includes(filter.toLowerCase())||c.country.toLowerCase().includes(filter.toLowerCase()));
  const el=document.getElementById('clients-list'); if(!el) return;
  el.innerHTML=list.length ? list.map((c,i)=>{
    const init=c.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const col=CLIENT_COLORS[i%CLIENT_COLORS.length];
    return `<div class="client-item${state.selectedClientId===c.id?' selected':''}" onclick="showClient(${c.id})">
      <div class="client-avatar" style="background:${col[1]};color:${col[0]}">${init}</div>
      <div style="flex:1;min-width:0"><div class="client-name">${c.name}</div><div class="client-sub">${c.type} · ${c.country}</div></div>
      <div style="font-size:12px;font-weight:600">${fmtK(c.revenue)}</div>
    </div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:12px 0;text-align:center">No results</div>';
}
function filterClients(v){renderClientsList(v);}

function showClient(id) {
  state.selectedClientId=id;
  const c=state.clients.find(x=>x.id===id); if(!c) return;
  renderClientsList(document.getElementById('client-search')?.value||'');
  const saasP=c.revenue?Math.round((c.saas/c.revenue)*100):0;
  const renewDays=Math.ceil((new Date(c.renewal+'T00:00:00')-TODAY)/864e5);
  const init=c.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('client-detail-wrap').innerHTML=`
  <div style="display:flex;flex-direction:column;gap:10px">
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:44px;height:44px;border-radius:50%;background:var(--primary-bg);border:1.5px solid var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--primary);font-size:14px;flex-shrink:0">${init}</div>
        <div style="flex:1"><div style="font-size:15px;font-weight:700">${c.name}</div><div style="font-size:11px;color:var(--text-2);margin-top:2px">${c.type} · ${c.country}${c.fromQBO?' <span style="font-size:9px;padding:1px 6px;border-radius:3px;background:var(--info-bg);color:var(--info);margin-left:4px">QuickBooks</span>':''}</div></div>
        <button class="btn btn-sm" onclick="editClient(${c.id})">Edit</button>
        <button class="del-btn" onclick="deleteClient(${c.id})">×</button>
      </div>
      <div class="grid-2" style="gap:8px">
        <div class="metric"><div class="metric-label">Total Revenue</div><div class="metric-value">${fmt(c.revenue)}</div></div>
        <div class="metric"><div class="metric-label">SaaS Ratio</div><div class="metric-value">${saasP}%</div></div>
        <div class="metric"><div class="metric-label">SaaS Revenue</div><div class="metric-value">${fmt(c.saas)}</div></div>
        <div class="metric"><div class="metric-label">Services</div><div class="metric-value">${fmt(c.services)}</div></div>
      </div>
    </div>
    <div class="card"><div class="card-title" style="margin-bottom:10px">Revenue Trend — Last 6 Months</div><div class="chart-wrap chart-wrap-sm"><canvas id="chart-client-trend"></canvas></div></div>
    <div class="card">
      <div class="grid-2" style="gap:12px">
        <div><div class="card-title" style="margin-bottom:8px">SaaS vs Services</div><div style="height:140px;position:relative"><canvas id="chart-client-split"></canvas></div></div>
        <div>
          <div class="card-title" style="margin-bottom:8px">Contract Details</div>
          <div class="detail-row"><span class="detail-label">Renewal</span><span class="detail-value" style="color:${renewDays<90?'var(--danger-text)':'var(--text)'}">${fmtDate(c.renewal)} <span class="tag ${renewDays<60?'tag-danger':renewDays<90?'tag-warning':'tag-neutral'}" style="font-size:9px">${renewDays}d</span></span></div>
          <div class="detail-row"><span class="detail-label">Annual Value</span><span class="detail-value">${fmt(c.revenue)}</span></div>
          <div class="detail-row"><span class="detail-label">Country</span><span class="detail-value">${c.country}</span></div>
          <div class="detail-row"><span class="detail-label">Segment</span><span class="detail-value">${c.type}</span></div>
          ${c.qbId?`<div class="detail-row"><span class="detail-label">QBO ID</span><span class="detail-value" style="font-family:monospace;font-size:10px;color:var(--text-2)">${c.qbId}</span></div>`:''}
        </div>
      </div>
    </div>
    <div class="card"><div class="card-title" style="margin-bottom:7px">CFO Notes</div><div style="font-size:12px;color:var(--text-2);line-height:1.6">${c.notes||'No notes added.'}</div></div>
  </div>`;
  setTimeout(()=>{
    mkChart('chart-client-trend','line',{
      labels:['Nov','Dec','Jan','Feb','Mar','Apr'],
      datasets:[{data:c.trend||[],borderColor:'#f97316',backgroundColor:'rgba(249,115,22,0.06)',fill:true,borderWidth:2,pointRadius:3,pointBackgroundColor:'#f97316',tension:.3}]
    });
    mkDoughnut('chart-client-split',['SaaS','Services'],[c.saas,c.services],['#f97316','rgba(255,255,255,0.15)']);
  },50);
}

function openAddClient() {
  document.getElementById('client-modal-title').textContent='Add Client';
  ['cl-name','cl-country','cl-revenue','cl-saas','cl-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cl-type').value='Enterprise'; document.getElementById('cl-renewal').value='2027-01-01';
  delete document.getElementById('modal-client').dataset.editId; openModal('modal-client');
}
function editClient(id) {
  const c=state.clients.find(x=>x.id===id); if(!c) return;
  document.getElementById('client-modal-title').textContent='Edit — '+c.name;
  document.getElementById('cl-name').value=c.name; document.getElementById('cl-type').value=c.type;
  document.getElementById('cl-country').value=c.country; document.getElementById('cl-revenue').value=c.revenue;
  document.getElementById('cl-saas').value=c.saas; document.getElementById('cl-renewal').value=c.renewal;
  document.getElementById('cl-notes').value=c.notes||'';
  document.getElementById('modal-client').dataset.editId=id; openModal('modal-client');
}
async function saveClient() {
  const name=document.getElementById('cl-name').value.trim(); if(!name){toast('Name required');return;}
  const data={name,type:document.getElementById('cl-type').value,country:document.getElementById('cl-country').value||'—',revenue:parseInt(document.getElementById('cl-revenue').value)||0,saas:parseInt(document.getElementById('cl-saas').value)||0,renewal:document.getElementById('cl-renewal').value||'2027-01-01',notes:document.getElementById('cl-notes').value};
  const eid=document.getElementById('modal-client').dataset.editId;
  try {
    if (eid) { const r=await apiCall(`/clients/${eid}`,{method:'PUT',body:JSON.stringify(data)}); const i=state.clients.findIndex(c=>c.id===Number(eid)); if(i>-1) state.clients[i]=r.client; state.selectedClientId=Number(eid); }
    else { const r=await apiCall('/clients',{method:'POST',body:JSON.stringify(data)}); state.clients.push(r.client); state.selectedClientId=r.client.id; }
    closeModal('modal-client'); render(); toast('Client saved');
  } catch(e){toast(e.message);}
}
async function deleteClient(id) {
  if(!confirm('Delete this client?')) return;
  await apiCall(`/clients/${id}`,{method:'DELETE'}); state.clients=state.clients.filter(c=>c.id!==id); state.selectedClientId=null; render();
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
    </div>
    <div class="view-panel active" id="stmt-pnl">
      <div class="card">
        <div class="card-header"><div class="card-title">Profit & Loss Statement — FY ${pnl?.year||2026}</div><div style="font-size:11px;color:var(--text-2)">Monthly view · QBO + manual</div></div>
        <div style="overflow-x:auto">
          <table class="table" style="min-width:900px">
            <thead><tr><th style="min-width:180px">Category</th>${MO.map(m=>`<th style="text-align:right">${m}</th>`).join('')}<th style="text-align:right">Total</th></tr></thead>
            <tbody>${renderPnLRows(pnl)}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="view-panel" id="stmt-bs">
      <div class="card">
        <div class="card-header"><div class="card-title">Balance Sheet — as of ${bs?.asOf||'2026-04-30'}</div></div>
        <div class="grid-3">
          ${['assets','liabilities','equity'].map(sec=>{
            const items=bs?.[sec]||[];
            const total=items.reduce((a,i)=>a+i.value,0);
            const secLabel={assets:'Assets',liabilities:'Liabilities',equity:'Equity'}[sec];
            return `<div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2);margin-bottom:8px;padding-bottom:6px;border-bottom:0.5px solid var(--border)">${secLabel}</div>
              ${items.map((item,idx)=>`
                <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:0.5px solid var(--border);font-size:11px">
                  <input class="input" style="flex:1;margin-right:6px;padding:2px 6px" value="${item.label}" onchange="updateBsLabel('${sec}',${idx},this.value)">
                  <input class="input input-cell" style="width:90px;text-align:right;padding:2px 6px" value="${item.value}" type="number" onchange="updateBsValue('${sec}',${idx},this.value)">
                </div>`).join('')}
              <div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700;font-size:12px;border-top:0.5px solid var(--border-2);margin-top:4px">
                <span>Total ${secLabel}</span><span style="color:var(--primary)">${fmt(total)}</span>
              </div>
              <button class="btn btn-sm" style="width:100%;margin-top:4px" onclick="addBsItem('${sec}')">+ Add Line</button>
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:12px;text-align:right"><button class="btn btn-primary btn-sm" onclick="saveBalanceSheet()">Save Balance Sheet</button></div>
      </div>
    </div>
  </div>`;
}

function renderPnLRows(pnl) {
  if (!pnl?.rows) return '<tr><td colspan="14" style="text-align:center;color:var(--text-3);padding:20px">No P&L data. Connect QuickBooks to auto-populate.</td></tr>';
  const revenue=pnl.rows.find(r=>r.id==='revenue');
  const cogs=pnl.rows.find(r=>r.id==='cogs');
  const opexRows=pnl.rows.filter(r=>r.type==='opex');
  return pnl.rows.map(row=>{
    if (row.computed) {
      const vals={};
      if (row.formula==='revenue-cogs') MO.forEach(m=>vals[m]=(revenue?.months[m]||0)-(cogs?.months[m]||0));
      else if (row.formula==='sum-opex') MO.forEach(m=>vals[m]=opexRows.reduce((a,r)=>a+(r.months[m]||0),0));
      else if (row.formula==='gross-totopex') {
        const gross=pnl.rows.find(r=>r.id==='gross'), totopex=pnl.rows.find(r=>r.id==='totopex');
        MO.forEach(m=>vals[m]=(gross?computed_gross(m,revenue,cogs):0)-(totopex?computed_totopex(m,opexRows):0));
      }
      const total=MO.reduce((a,m)=>a+(vals[m]||0),0);
      const isTotal=row.type==='total';
      return `<tr class="${row.type==='subtotal'||isTotal?'stmt-row subtotal':'stmt-row'}${isTotal?' total':''}">
        <td style="padding:7px 10px;font-weight:600;${isTotal?'color:var(--primary)':''}">${row.cat}</td>
        ${MO.map(m=>`<td style="text-align:right;padding:7px 10px;border-left:0.5px solid var(--border);${vals[m]<0?'color:var(--danger-text)':''}">${vals[m]?fmtK(vals[m]):'—'}</td>`).join('')}
        <td style="text-align:right;padding:7px 10px;border-left:0.5px solid var(--border);font-weight:700;${total<0?'color:var(--danger-text)':total>0?'color:var(--success)':''}">${fmtK(total)}</td>
      </tr>`;
    }
    const total=MO.reduce((a,m)=>a+(row.months[m]||0),0);
    const isCogs=row.type==='cogs';
    return `<tr class="stmt-row">
      <td style="padding:7px 10px;color:var(--text-2)">${row.cat}</td>
      ${MO.map(m=>`<td style="text-align:right;padding:7px 10px;border-left:0.5px solid var(--border)">${row.months[m]?fmtK(row.months[m]):'—'}</td>`).join('')}
      <td style="text-align:right;padding:7px 10px;border-left:0.5px solid var(--border);font-weight:600">${fmtK(total)}</td>
    </tr>`;
  }).join('');
}
function computed_gross(m,revenue,cogs){return (revenue?.months[m]||0)-(cogs?.months[m]||0);}
function computed_totopex(m,opexRows){return opexRows.reduce((a,r)=>a+(r.months[m]||0),0);}

function updateBsLabel(sec,idx,val){ if(state.statements?.balanceSheet?.[sec]?.[idx]) state.statements.balanceSheet[sec][idx].label=val; }
function updateBsValue(sec,idx,val){ if(state.statements?.balanceSheet?.[sec]?.[idx]) state.statements.balanceSheet[sec][idx].value=Number(val)||0; }
async function addBsItem(sec) {
  try { await apiCall('/statements/balance-sheet/item',{method:'POST',body:JSON.stringify({section:sec,label:'New Item',value:0})}); state.statements=null; render(); } catch(e){toast(e.message);}
}
async function saveBalanceSheet() {
  try { await apiCall('/statements/balance-sheet',{method:'PUT',body:JSON.stringify(state.statements.balanceSheet)}); toast('Balance sheet saved'); } catch(e){toast(e.message);}
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function renderCalendar(c) {
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div class="card-header">
        <div class="card-title">Calendar — ${MONTHS[state.calMonth]} ${state.calYear}</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="toast('Connect Google Calendar: add GOOGLE_CALENDAR_ID to .env and restart server')">📅 Google Cal</button>
          <button class="btn btn-sm" onclick="syncGcal()">↻ Sync</button>
          <button class="btn btn-primary btn-sm" onclick="openAddEvent()">+ Event</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <button class="btn btn-sm" style="padding:4px 10px" onclick="calMove(-1)">‹</button>
        <strong id="cal-label">${MONTHS[state.calMonth]} ${state.calYear}</strong>
        <button class="btn btn-sm" style="padding:4px 10px" onclick="calMove(1)">›</button>
      </div>
      <div class="cal-grid">${DAYS.map(d=>`<div class="cal-hd">${d}</div>`).join('')}</div>
      <div class="cal-grid" style="margin-top:3px" id="cal-days"></div>
      <div style="margin-top:14px;font-size:12px;font-weight:600;margin-bottom:8px">Upcoming Events</div>
      <div id="events-list"></div>
    </div>
  </div>`;
  renderCalDays(); renderEventsList();
}

function renderCalDays() {
  const el=document.getElementById('cal-days'); if(!el) return;
  const first=new Date(state.calYear,state.calMonth,1).getDay();
  const dim=new Date(state.calYear,state.calMonth+1,0).getDate();
  const prev=new Date(state.calYear,state.calMonth,0).getDate();
  const eD={},tD={};
  state.events.forEach(e=>{ const d=new Date(e.date+'T00:00:00'); if(d.getFullYear()===state.calYear&&d.getMonth()===state.calMonth){eD[d.getDate()]=true;if(e.type==='tax')tD[d.getDate()]=true;} });
  let html='';
  for(let i=0;i<first;i++) html+=`<div class="cal-day dim">${prev-first+1+i}</div>`;
  for(let d=1;d<=dim;d++){
    const isTd=state.calYear===TODAY.getFullYear()&&state.calMonth===TODAY.getMonth()&&d===TODAY.getDate();
    const dot=tD[d]?`<div class="cal-dot" style="background:${isTd?'#fff':'#ef4444'}"></div>`:eD[d]?`<div class="cal-dot" style="background:${isTd?'#fff':'#f97316'}"></div>`:'';
    html+=`<div class="cal-day${isTd?' today':''}">${d}${dot}</div>`;
  }
  el.innerHTML=html;
}

function calMove(dir){ state.calMonth+=dir; if(state.calMonth>11){state.calMonth=0;state.calYear++;} if(state.calMonth<0){state.calMonth=11;state.calYear--;} document.getElementById('cal-label').textContent=MONTHS[state.calMonth]+' '+state.calYear; renderCalDays(); }

const EVT_COLORS={tax:'#ef4444',meeting:'#3b82f6',deadline:'#f59e0b',task:'#22c55e',planning:'#a855f7'};
const EVT_TAGS={tax:'Tax',meeting:'Meeting',deadline:'Deadline',task:'Task',planning:'Planning'};

function cdBadge(d){ const n=daysTo(d); if(n<0) return ''; if(n===0) return '<span class="countdown cd-urgent">Today</span>'; if(n<=3) return `<span class="countdown cd-urgent">${n}d</span>`; if(n<=14) return `<span class="countdown cd-soon">${n}d</span>`; return `<span class="countdown cd-ok">${n}d</span>`; }

function renderEventsList() {
  const list=state.events.filter(e=>daysTo(e.date)>=0).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,8);
  const el=document.getElementById('events-list'); if(!el) return;
  el.innerHTML=list.length?list.map(e=>{ const col=EVT_COLORS[e.type]||'#94a3b8'; return `<div class="event-item"><div class="event-bar" style="background:${col}"></div><div style="flex:1;min-width:0"><div class="event-title">${e.title}</div><div class="event-meta"><span class="tag" style="background:${col}22;color:${col}">${EVT_TAGS[e.type]||e.type}</span><span>${fmtDate(e.date)}</span>${e.amount?`<strong>${fmt(e.amount)}</strong>`:''} ${cdBadge(e.date)}</div></div><button class="del-btn" onclick="deleteEvent(${e.id})">×</button></div>`; }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:12px 0">No upcoming events</div>';
}

function openAddEvent() { ['evt-title','evt-note','evt-amount'].forEach(id=>document.getElementById(id).value=''); document.getElementById('evt-date').value=TODAY.toISOString().split('T')[0]; openModal('modal-event'); }

async function saveEvent() {
  const title=document.getElementById('evt-title').value.trim(), date=document.getElementById('evt-date').value;
  if (!title||!date){toast('Title and date required');return;}
  try {
    const r=await apiCall('/events',{method:'POST',body:JSON.stringify({type:document.getElementById('evt-type').value,title,date,note:document.getElementById('evt-note').value,amount:document.getElementById('evt-amount').value||null,recur:document.getElementById('evt-recur').value})});
    state.events.push(r.event); closeModal('modal-event'); renderCalDays(); renderEventsList(); toast('Event saved');
  } catch(e){toast(e.message);}
}
async function deleteEvent(id) { await apiCall(`/events/${id}`,{method:'DELETE'}); state.events=state.events.filter(e=>e.id!==id); renderCalDays(); renderEventsList(); }
async function syncGcal() { try { const r=await apiCall('/events/gcal/sync',{method:'POST'}); toast(r.message); } catch(e){toast(e.message);} }

// ── Tasks ─────────────────────────────────────────────────────────────────────
function renderTasks(c) {
  const open=state.tasks.filter(t=>!t.done), done=state.tasks.filter(t=>t.done);
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div class="card-header"><div class="card-title">Tasks</div><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="toggleDone()">${state.showDone?'Hide done':'Show done'}</button><button class="btn btn-primary btn-sm" onclick="openAddTask()">+ Task</button></div></div>
      <div style="font-size:11px;color:var(--text-2);margin-bottom:10px">${open.length} open · ${done.length} completed</div>
      <div id="tasks-list"></div>
    </div>
  </div>`;
  renderTasksList();
}

function renderTasksList() {
  const el=document.getElementById('tasks-list'); if(!el) return;
  const vis=state.tasks.filter(t=>state.showDone||!t.done);
  const PRIO_COL={high:'var(--danger)',medium:'var(--warning)',low:'var(--text-3)'};
  el.innerHTML=vis.length?vis.map(t=>`
    <div class="task-row" style="padding-left:6px;border-left:2px solid ${PRIO_COL[t.priority]||'var(--text-3)'}">
      <div class="checkbox${t.done?' done':''}" onclick="toggleTask(${t.id})"></div>
      <div style="flex:1">
        <div class="task-title${t.done?' done':''}">${t.title}</div>
        <div class="task-due">${t.deadline?`Due: ${fmtDate(t.deadline)} ${cdBadge(t.deadline)}`:(t.due||'No deadline')} · <span style="text-transform:capitalize;color:${PRIO_COL[t.priority]||'var(--text-3)'}">${t.priority||'medium'} priority</span></div>
      </div>
      <button class="del-btn" onclick="deleteTask(${t.id})">×</button>
    </div>`).join('') : '<div style="font-size:11px;color:var(--text-3);padding:12px 0;text-align:center">No tasks — great work!</div>';
}

function openAddTask() { ['task-title'].forEach(id=>document.getElementById(id).value=''); document.getElementById('task-deadline').value=''; document.getElementById('task-priority').value='medium'; openModal('modal-task'); }

async function saveTask() {
  const title=document.getElementById('task-title').value.trim(); if(!title){toast('Task title required');return;}
  const deadline=document.getElementById('task-deadline').value, priority=document.getElementById('task-priority').value;
  try { const r=await apiCall('/tasks',{method:'POST',body:JSON.stringify({title,deadline,priority})}); state.tasks.unshift(r.task); closeModal('modal-task'); renderTasksList(); toast('Task added'); } catch(e){toast(e.message);}
}

async function toggleTask(id) {
  const t=state.tasks.find(x=>x.id===id); if(!t) return;
  t.done=!t.done;
  await apiCall(`/tasks/${id}`,{method:'PATCH',body:JSON.stringify({done:t.done})});
  renderTasksList();
}
function toggleDone(){state.showDone=!state.showDone; render();}
async function deleteTask(id) { await apiCall(`/tasks/${id}`,{method:'DELETE'}); state.tasks=state.tasks.filter(t=>t.id!==id); renderTasksList(); }

// ── Files ─────────────────────────────────────────────────────────────────────
function renderFiles(c) {
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div class="card-header"><div class="card-title">Legal Documents & Official Files</div><div style="display:flex;gap:6px"><button class="btn btn-sm" onclick="toast('Google Drive sync: add GOOGLE_DRIVE credentials to .env')">Google Drive</button><label class="btn btn-primary btn-sm" style="cursor:pointer">⬆ Upload<input type="file" style="display:none" onchange="uploadFile(this)"></label></div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${['all','license','contract','tax','report'].map(f=>`<button class="btn btn-sm${state.fileFilter===f?' btn-primary':''}" onclick="setFileFilter('${f}')">${f.charAt(0).toUpperCase()+f.slice(1)}</button>`).join('')}
      </div>
      <div id="files-list"></div>
    </div>
  </div>`;
  renderFilesList();
}

function renderFilesList() {
  const ICO={p:'fi-pdf',x:'fi-xls',d:'fi-doc'}, LBL={p:'PDF',x:'XLS',d:'DOC'};
  const list=state.fileFilter==='all'?state.files:state.files.filter(f=>f.type===state.fileFilter);
  const el=document.getElementById('files-list'); if(!el) return;
  el.innerHTML=list.length?list.map(f=>`
    <div class="file-row">
      <div class="file-icon ${ICO[f.cat]||'fi-doc'}">${LBL[f.cat]||'DOC'}</div>
      <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</div><div style="font-size:10px;color:var(--text-2)">${f.size} · ${f.date}${f.drive?' · <span style="color:var(--info)">Drive</span>':''}</div></div>
      <div style="display:flex;gap:5px">${f.storedAs?`<a href="/api/files/${f.id}/download" class="file-action" style="text-decoration:none">Download</a>`:`<button class="file-action" onclick="toast('Downloading: ${f.name}')">Download</button>`}<button class="file-action" style="color:var(--danger-text)" onclick="deleteFile(${f.id})">Delete</button></div>
    </div>`).join('') : '<div style="font-size:11px;color:var(--text-3);padding:20px 0;text-align:center">No files in this category</div>';
}
function setFileFilter(f){state.fileFilter=f;render();}

async function uploadFile(inp) {
  if (!inp.files[0]) return;
  const fd=new FormData(); fd.append('file',inp.files[0]); fd.append('type','report');
  try { const res=await fetch('/api/files/upload',{method:'POST',headers:{'Authorization':'Bearer '+state.token},body:fd}); const d=await res.json(); if(d.file) state.files.unshift(d.file); inp.value=''; renderFilesList(); toast('Uploaded: '+d.file.name); } catch(e){toast('Upload failed');}
}
async function deleteFile(id) {
  if(!confirm('Delete this file?')) return;
  await apiCall(`/files/${id}`,{method:'DELETE'}); state.files=state.files.filter(f=>f.id!==id); renderFilesList();
}

// ── Settings & Users ──────────────────────────────────────────────────────────
async function renderSettings(c) {
  try { const d=await apiCall('/users'); state.users=d.users; state.invitations=d.invitations; } catch {}
  const isAdmin=state.user?.role==='admin';
  c.innerHTML=`
  <div style="display:flex;flex-direction:column;gap:14px">
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">Team Members</div>${isAdmin?'<button class="btn btn-primary btn-sm" onclick="openModal(\'modal-invite\')">+ Invite</button>':''}</div>
        ${state.users.map(u=>`
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border)">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--primary-bg);border:1px solid var(--primary);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--primary);flex-shrink:0">${u.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
            <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500">${u.name}</div><div style="font-size:10px;color:var(--text-2)">${u.email}</div></div>
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
      <div class="card">
        <div class="card-title" style="margin-bottom:12px">My Account</div>
        <div style="font-size:12px;color:var(--text-2);margin-bottom:16px">Signed in as <strong style="color:var(--text)">${state.user?.email}</strong></div>
        <div class="form-row"><label>Change Password</label><input type="password" id="cur-pass" placeholder="Current password" style="margin-bottom:6px"></div>
        <div class="form-row"><input type="password" id="new-pass" placeholder="New password (min 8 chars)"></div>
        <button class="btn btn-primary btn-sm" style="margin-bottom:16px" onclick="changePassword()">Update Password</button>
        <div style="border-top:0.5px solid var(--border);padding-top:14px">
          <div class="card-title" style="margin-bottom:10px">API Connections</div>
          ${[['QuickBooks','QUICKBOOKS_CLIENT_ID'],['HubSpot','HUBSPOT_ACCESS_TOKEN'],['Google Calendar','GOOGLE_CALENDAR_ID'],['Google Drive','GOOGLE_DRIVE_FOLDER_ID']].map(([n,k])=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--border);font-size:11px">
              <span>${n}</span>
              <span class="tag tag-neutral">${k} in .env</span>
            </div>`).join('')}
        </div>
        <div style="border-top:0.5px solid var(--border);padding-top:14px;margin-top:14px">
          <button class="btn btn-danger btn-sm" onclick="logout()">Sign Out</button>
        </div>
      </div>
    </div>
  </div>`;
}

async function sendInvite() {
  const email=document.getElementById('inv-email').value.trim(), role=document.getElementById('inv-role').value, name=document.getElementById('inv-name').value.trim();
  if (!email){toast('Email required');return;}
  try { const r=await apiCall('/auth/invite',{method:'POST',body:JSON.stringify({email,role,name})}); closeModal('modal-invite'); renderSettings(document.getElementById('main-content')); toast('Invitation created'); console.log('Invite link:',r.link); } catch(e){toast(e.message);}
}

function copyInviteLink(token) {
  const link=window.location.origin+`/register?token=${token}`;
  navigator.clipboard.writeText(link).then(()=>toast('Link copied to clipboard')).catch(()=>{ prompt('Copy this link:',link); });
}

async function cancelInvite(id) {
  try { await apiCall(`/users/invitations/${id}`,{method:'DELETE'}); renderSettings(document.getElementById('main-content')); toast('Invitation cancelled'); } catch(e){toast(e.message);}
}

async function removeUser(id) {
  if(!confirm('Remove this user?')) return;
  try { await apiCall(`/users/${id}`,{method:'DELETE'}); renderSettings(document.getElementById('main-content')); toast('User removed'); } catch(e){toast(e.message);}
}

async function changePassword() {
  const cur=document.getElementById('cur-pass').value, next=document.getElementById('new-pass').value;
  if (!cur||!next){toast('Both password fields required');return;}
  try { await apiCall('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:cur,newPassword:next})}); document.getElementById('cur-pass').value=''; document.getElementById('new-pass').value=''; toast('Password updated'); } catch(e){toast(e.message);}
}

// ── AI Chat ───────────────────────────────────────────────────────────────────
function openAI() { document.getElementById('ai-chat-panel').classList.add('open'); }
function closeAI() { document.getElementById('ai-chat-panel').classList.remove('open'); }

function sendAIMsg() {
  const inp=document.getElementById('ai-input'), msg=inp.value.trim(); if(!msg) return;
  const msgsEl=document.getElementById('ai-msgs');
  msgsEl.innerHTML+=`<div class="ai-msg user">${msg}</div>`;
  inp.value=''; msgsEl.scrollTop=msgsEl.scrollHeight;
  setTimeout(()=>{
    const reply=generateAIReply(msg);
    msgsEl.innerHTML+=`<div class="ai-msg bot">${reply}</div>`;
    msgsEl.scrollTop=msgsEl.scrollHeight;
  },600);
}

function generateAIReply(msg) {
  const m=msg.toLowerCase();
  if (m.includes('cash')||m.includes('balance')) {
    const total=state.banks.reduce((a,b)=>a+b.total,0);
    const res=state.reserves.reduce((a,r)=>a+r.amount,0);
    return `Current total cash is <strong>${fmt(total)}</strong> across ${state.banks.length} accounts. After ${fmt(res)} in reserves, available cash is <strong>${fmt(total-res)}</strong>. Forecast closing balance for December is <strong>${fmtK(state.cashflow[state.cashflow.length-1]?.opening+(state.cashflow[state.cashflow.length-1]?.inflow||0)-(state.cashflow[state.cashflow.length-1]?.outflow||0)||0)}</strong>.`;
  }
  if (m.includes('budget')||m.includes('expense')) {
    const total=state.budget.reduce((a,b)=>a+b.annual,0);
    return `Annual budget totals <strong>${fmtK(total)}</strong> across ${state.budget.length} categories. The highest spend is <strong>${state.budget.sort((a,b)=>b.annual-a.annual)[0]?.cat}</strong>. Cloud infrastructure is trending over budget — worth reviewing.`;
  }
  if (m.includes('revenue')||m.includes('target')) {
    const ytd=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.revenue,0);
    const tgt=state.revenue.filter(r=>r.revenue>0).reduce((a,r)=>a+r.target,0);
    return `Revenue YTD stands at <strong>${fmt(ytd)}</strong> against a target of <strong>${fmt(tgt)}</strong> — that's <strong>${tgt?((ytd/tgt)*100).toFixed(1):0}%</strong> of target. Annual revenue target sums to <strong>${fmtK(state.revenue.reduce((a,r)=>a+r.target,0))}</strong>.`;
  }
  if (m.includes('pipeline')||m.includes('deal')||m.includes('sales')) {
    const total=state.pipeline.reduce((a,d)=>a+d.value,0);
    const wtd=state.pipeline.reduce((a,d)=>a+d.value*(d.probability/100),0);
    return `Sales pipeline contains <strong>${state.pipeline.length} deals</strong> with total value <strong>${fmt(total)}</strong>. Weighted by probability, expected value is <strong>${fmt(wtd)}</strong>. Government deals represent the largest opportunity.`;
  }
  if (m.includes('client')) {
    const top=state.clients.sort((a,b)=>b.revenue-a.revenue)[0];
    return `You have <strong>${state.clients.length} active clients</strong>. Top client is <strong>${top?.name}</strong> at <strong>${fmt(top?.revenue||0)}</strong> annually. ${state.clients.filter(c=>Math.ceil((new Date(c.renewal)-TODAY)/864e5)<90).length} contracts renew within 90 days.`;
  }
  return `I can help you analyze: <strong>cash flow</strong>, <strong>budget variances</strong>, <strong>revenue trends</strong>, <strong>pipeline health</strong>, or <strong>client risk</strong>. What would you like to explore?`;
}

// ── Sync helpers ──────────────────────────────────────────────────────────────
async function syncSource(endpoint, label) {
  const dot=document.getElementById('sync-dot'), lbl=document.getElementById('sync-label');
  if(dot){dot.classList.add('spin');lbl.textContent='Syncing...';}
  try { await apiCall(endpoint,{method:'POST'}); await loadAll(); render(); toast(label+' — sync complete'); }
  catch(e){toast('Sync error: '+e.message);}
  finally { if(dot){dot.classList.remove('spin');lbl.textContent='Updated';} }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('click', e=>{
  const ni=e.target.closest('.nav-item');
  if (ni?.dataset?.section) showSection(ni.dataset.section);
  if (e.target.classList.contains('modal-backdrop')) closeModal(e.target.id);
});

document.addEventListener('keydown', e=>{
  if (e.key==='Enter'&&document.getElementById('l-pass')===document.activeElement) doLogin();
});

async function init() {
  const isInvite=await checkInviteToken();
  if (!isInvite&&state.token) {
    try {
      const r=await fetch('/api/auth/me',{headers:{'Authorization':'Bearer '+state.token}});
      if (r.ok){state.user=await r.json(); await showApp(); return;}
    } catch {}
    logout();
  }
}

init();

init();
