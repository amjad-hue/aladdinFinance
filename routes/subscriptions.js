const router = require('express').Router();
const { load, save } = require('../data/store');
const mailer = require('../lib/mailer');

function getSubs()  { return load('subscriptions', []); }
function setSubs(d) { save('subscriptions', d); }
function getCfg()   { return load('sub-settings', { reminderDays:[7,30,60], recipients:[], renewalSchedule:'daily', renewalNextSend:'' }); }
function saveCfg(d) { save('sub-settings', d); }
function nextId(a)  { return a.length ? Math.max(...a.map(s=>s.id||0))+1 : 1; }

function toMRR(sub) {
  const a = Number(sub.amount)||0;
  if (sub.billing==='monthly')   return a;
  if (sub.billing==='quarterly') return a/3;
  if (sub.billing==='yearly')    return a/12;
  return 0;
}
const fmtAmt  = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
const fmtDate = iso => { if (!iso) return '—'; try { return new Date(iso.slice(0,10)+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); } catch { return iso; } };

// ── Settings (BEFORE /:id) ────────────────────────────────────────────────────
router.get('/settings', (req, res) => res.json(getCfg()));
router.put('/settings', (req, res) => {
  const cfg = { ...getCfg(), ...req.body };
  saveCfg(cfg);
  res.json({ ok:true, settings:cfg });
});

// ── KPIs ─────────────────────────────────────────────────────────────────────
router.get('/kpis', (req, res) => {
  const subs    = getSubs();
  const active  = subs.filter(s=>s.status==='active');
  const churned = subs.filter(s=>s.status==='churned'||s.status==='cancelled');
  const mrr     = active.reduce((sum,s)=>sum+toMRR(s), 0);
  const arr     = mrr*12;
  const acv     = active.length ? arr/active.length : 0;

  const now  = new Date();
  const in30 = new Date(now); in30.setDate(now.getDate()+30);
  const in7  = new Date(now); in7.setDate(now.getDate()+7);

  const renewalsDue    = active.filter(s=>{ if(!s.renewalDate) return false; const d=new Date(s.renewalDate+'T00:00:00'); return d>=now&&d<=in30; });
  const renewalsUrgent = active.filter(s=>{ if(!s.renewalDate) return false; const d=new Date(s.renewalDate+'T00:00:00'); return d>=now&&d<=in7; });
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  // MRR trend — last 6 months
  const mrrTrend = [];
  for (let i=5; i>=0; i--) {
    const d    = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const mEnd = new Date(d.getFullYear(), d.getMonth()+1, 0);
    const label = d.toLocaleString('en-US',{month:'short'});
    const subsActive = subs.filter(s=>{
      const start = s.startDate ? new Date(s.startDate+'T00:00:00') : null;
      const lost  = s.lostAt   ? new Date(s.lostAt)               : null;
      if (!start||start>mEnd) return false;
      if (lost&&lost<d)       return false;
      return true;
    });
    mrrTrend.push({ label, mrr: Math.round(subsActive.reduce((sum,s)=>sum+toMRR({...s,status:'active'}),0)) });
  }

  // Revenue by billing cycle (active only)
  const revByBilling = {
    monthly:   active.filter(s=>s.billing==='monthly').reduce((s,x)=>s+Number(x.amount||0),0),
    quarterly: active.filter(s=>s.billing==='quarterly').reduce((s,x)=>s+Number(x.amount||0),0),
    yearly:    active.filter(s=>s.billing==='yearly').reduce((s,x)=>s+Number(x.amount||0),0)
  };

  res.json({
    mrr: Math.round(mrr), arr: Math.round(arr), acv: Math.round(acv),
    activeCount:    active.length,
    churnedCount:   churned.length,
    trialCount:     subs.filter(s=>s.status==='trial').length,
    pausedCount:    subs.filter(s=>s.status==='paused').length,
    churnRate:      (active.length+churned.length) ? +(churned.length/(active.length+churned.length)*100).toFixed(1) : 0,
    renewalsDue:    renewalsDue.length,
    renewalsUrgent: renewalsUrgent.length,
    churnedThisMonth: churned.filter(s=>(s.lostAt||'').startsWith(thisMonth)).length,
    mrrTrend,
    byBilling: {
      monthly:   active.filter(s=>s.billing==='monthly').length,
      quarterly: active.filter(s=>s.billing==='quarterly').length,
      yearly:    active.filter(s=>s.billing==='yearly').length
    },
    revByBilling,
    byStatus: {
      active: active.length,
      churned: subs.filter(s=>s.status==='churned').length,
      cancelled: subs.filter(s=>s.status==='cancelled').length,
      trial: subs.filter(s=>s.status==='trial').length,
      paused: subs.filter(s=>s.status==='paused').length
    },
    renewalsList: renewalsDue
      .sort((a,b)=>a.renewalDate.localeCompare(b.renewalDate))
      .map(s=>({ id:s.id, clientName:s.clientName, renewalDate:s.renewalDate, billing:s.billing, amount:s.amount, seats:s.seats }))
  });
});

// ── Check & send renewal reminders ───────────────────────────────────────────
router.post('/check-renewals', async (req, res) => {
  const subs = getSubs();
  const cfg  = getCfg();
  const days = cfg.reminderDays||[7,30,60];
  const rcpt = cfg.recipients||[];
  if (!rcpt.length) return res.json({ ok:true, sent:[], message:'No recipients configured' });

  const now  = new Date();
  const sent = [];
  for (const sub of subs.filter(s=>s.status==='active'&&s.renewalDate)) {
    const renewal   = new Date(sub.renewalDate+'T00:00:00');
    const daysUntil = Math.round((renewal-now)/86400000);
    if (days.includes(daysUntil) && mailer.isConfigured()) {
      try {
        await mailer.sendMail({
          to: rcpt.join(', '),
          subject: `⏰ Renewal Reminder: ${sub.clientName} — ${daysUntil} day${daysUntil!==1?'s':''} left`,
          html: reminderHtml(sub, daysUntil)
        });
        sent.push({ type:'reminder', client:sub.clientName, daysUntil });
      } catch(e) {}
    }
  }
  cfg.renewalNextSend = new Date(Date.now()+86400000).toISOString().slice(0,10);
  saveCfg(cfg);
  res.json({ ok:true, sent });
});

// ── Email previews ────────────────────────────────────────────────────────────
router.get('/preview/reminder', (req, res) => {
  const sub = getSubs().find(s=>s.status==='active') ||
    { clientName:'Acme Corp', amount:5000, billing:'yearly', renewalDate:new Date(Date.now()+30*86400000).toISOString().slice(0,10), seats:10 };
  res.send(reminderHtml(sub, 30));
});
router.get('/preview/won', (req, res) => {
  const sub = getSubs().find(s=>s.status==='active') ||
    { clientName:'Acme Corp', amount:5000, billing:'yearly', startDate:new Date().toISOString().slice(0,10), seats:10 };
  res.send(wonHtml(sub));
});
router.get('/preview/lost', (req, res) => {
  const sub = getSubs().find(s=>s.status==='churned') ||
    { clientName:'Acme Corp', amount:5000, billing:'yearly', lostAt:new Date().toISOString(), lostReason:'Price sensitivity', seats:10 };
  res.send(lostHtml(sub));
});

// ── CRUD ─────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => res.json(getSubs()));

router.post('/', (req, res) => {
  const subs = getSubs();
  const sub  = { id:nextId(subs), createdAt:new Date().toISOString(), ...req.body };
  subs.push(sub);
  setSubs(subs);
  const cfg = getCfg();
  if (sub.status==='active' && (cfg.recipients||[]).length && mailer.isConfigured()) {
    mailer.sendMail({ to:cfg.recipients.join(', '), subject:`🎉 New Subscription Won: ${sub.clientName}`, html:wonHtml(sub) }).catch(()=>{});
  }
  res.status(201).json(sub);
});

router.put('/:id', (req, res) => {
  const subs = getSubs();
  const i    = subs.findIndex(s=>s.id===Number(req.params.id));
  if (i===-1) return res.status(404).json({ error:'Not found' });
  const prev    = subs[i];
  const updated = { ...prev, ...req.body, id:prev.id };
  // Stamp lostAt when churning
  if (prev.status==='active' && (updated.status==='churned'||updated.status==='cancelled') && !updated.lostAt) {
    updated.lostAt = new Date().toISOString();
  }
  subs[i] = updated;
  setSubs(subs);
  const cfg = getCfg();
  if ((cfg.recipients||[]).length && mailer.isConfigured()) {
    if (prev.status!=='active' && updated.status==='active') {
      mailer.sendMail({ to:cfg.recipients.join(', '), subject:`🎉 Subscription Renewed: ${updated.clientName}`, html:wonHtml(updated) }).catch(()=>{});
    } else if (prev.status==='active' && (updated.status==='churned'||updated.status==='cancelled')) {
      mailer.sendMail({ to:cfg.recipients.join(', '), subject:`⛔ Subscription Lost: ${updated.clientName}`, html:lostHtml(updated) }).catch(()=>{});
    }
  }
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const subs = getSubs();
  const i    = subs.findIndex(s=>s.id===Number(req.params.id));
  if (i===-1) return res.status(404).json({ error:'Not found' });
  subs.splice(i,1); setSubs(subs);
  res.json({ ok:true });
});

// ── Email HTML templates ──────────────────────────────────────────────────────
function baseEmail(headerHtml, bodyRows) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:'Helvetica Neue',Arial,sans-serif;background:#F4F6FA;margin:0;padding:32px 16px}
    .wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09)}
    .header{padding:30px 36px;color:#fff}
    .header h1{margin:0 0 5px;font-size:22px;font-weight:800;letter-spacing:-.02em}
    .header p{margin:0;font-size:12.5px;opacity:.88;line-height:1.5}
    .body{padding:24px 36px}
    .intro{font-size:13px;color:#555;margin:0 0 20px;line-height:1.6}
    table.rows{width:100%;border-collapse:collapse}
    table.rows td{padding:9px 0;border-bottom:1px solid #F0F0F0;vertical-align:top}
    table.rows td:last-child{border-bottom:none}
    .lbl{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#999;width:140px}
    .val{font-size:13px;font-weight:600;color:#111}
    .footer{background:#F9FAFB;border-top:1px solid #EFEFEF;padding:16px 36px;font-size:11px;color:#BBB;text-align:center}
  </style></head><body>
  <div class="wrap">
    ${headerHtml}
    <div class="body">
      ${bodyRows}
    </div>
    <div class="footer">Aladdin Finance · CFO Command Center · Enterprise SaaS Subscriptions</div>
  </div></body></html>`;
}

function reminderHtml(sub, daysUntil) {
  const color = daysUntil<=7 ? '#DC2626' : daysUntil<=30 ? '#D97706' : '#2563EB';
  const header = `<div class="header" style="background:linear-gradient(135deg,${color},${color}BB)">
    <h1>⏰ Renewal Reminder</h1>
    <p><strong>${sub.clientName}</strong> subscription expires in <strong>${daysUntil} day${daysUntil!==1?'s':''}</strong></p>
  </div>`;
  const body = `<p class="intro">Action required — this Enterprise (SaaS) subscription is approaching its renewal date. Please follow up with the client.</p>
  <table class="rows">
    <tr><td class="lbl">Client</td><td class="val">${sub.clientName}</td></tr>
    <tr><td class="lbl">Plan</td><td class="val">Enterprise (SaaS)</td></tr>
    <tr><td class="lbl">Billing</td><td class="val" style="text-transform:capitalize">${sub.billing||'—'}</td></tr>
    <tr><td class="lbl">Amount</td><td class="val">${fmtAmt(sub.amount)}</td></tr>
    ${sub.seats?`<tr><td class="lbl">Seats</td><td class="val">${sub.seats} seats</td></tr>`:''}
    <tr><td class="lbl">Renewal Date</td><td class="val" style="color:${color};font-weight:700">${fmtDate(sub.renewalDate)}</td></tr>
    <tr><td class="lbl">Days Left</td><td class="val"><span style="background:${color}18;color:${color};padding:2px 9px;border-radius:20px;font-size:12px;font-weight:700">${daysUntil} day${daysUntil!==1?'s':''}</span></td></tr>
    ${sub.notes?`<tr><td class="lbl">Notes</td><td class="val">${sub.notes}</td></tr>`:''}
  </table>`;
  return baseEmail(header, body);
}

function wonHtml(sub) {
  const header = `<div class="header" style="background:linear-gradient(135deg,#16A34A,#22C55E)">
    <h1>🎉 Subscription Won!</h1>
    <p>New Enterprise (SaaS) subscription confirmed — <strong>${sub.clientName}</strong></p>
  </div>`;
  const body = `<p class="intro">A new subscription has been activated. Great work — let's keep it growing!</p>
  <table class="rows">
    <tr><td class="lbl">Client</td><td class="val">${sub.clientName}</td></tr>
    <tr><td class="lbl">Plan</td><td class="val">Enterprise (SaaS)</td></tr>
    <tr><td class="lbl">Billing</td><td class="val" style="text-transform:capitalize">${sub.billing||'—'}</td></tr>
    <tr><td class="lbl">Amount</td><td class="val" style="color:#16A34A">${fmtAmt(sub.amount)}</td></tr>
    ${sub.seats?`<tr><td class="lbl">Seats</td><td class="val">${sub.seats} seats</td></tr>`:''}
    <tr><td class="lbl">Start Date</td><td class="val">${fmtDate(sub.startDate)}</td></tr>
    ${sub.renewalDate?`<tr><td class="lbl">Renewal Date</td><td class="val">${fmtDate(sub.renewalDate)}</td></tr>`:''}
    ${sub.notes?`<tr><td class="lbl">Notes</td><td class="val">${sub.notes}</td></tr>`:''}
  </table>`;
  return baseEmail(header, body);
}

function lostHtml(sub) {
  const header = `<div class="header" style="background:linear-gradient(135deg,#DC2626,#EF4444)">
    <h1>⛔ Subscription Lost</h1>
    <p><strong>${sub.clientName}</strong> has churned or cancelled their subscription</p>
  </div>`;
  const body = `<p class="intro">This subscription has been marked as lost. Please review the reason and consider a win-back campaign.</p>
  <table class="rows">
    <tr><td class="lbl">Client</td><td class="val">${sub.clientName}</td></tr>
    <tr><td class="lbl">Plan</td><td class="val">Enterprise (SaaS)</td></tr>
    <tr><td class="lbl">Billing</td><td class="val" style="text-transform:capitalize">${sub.billing||'—'}</td></tr>
    <tr><td class="lbl">Amount Lost</td><td class="val" style="color:#DC2626">${fmtAmt(sub.amount)}</td></tr>
    ${sub.seats?`<tr><td class="lbl">Seats</td><td class="val">${sub.seats}</td></tr>`:''}
    ${sub.lostAt?`<tr><td class="lbl">Lost Date</td><td class="val">${fmtDate(sub.lostAt.slice(0,10))}</td></tr>`:''}
    ${sub.lostReason?`<tr><td class="lbl">Lost Reason</td><td class="val">${sub.lostReason}</td></tr>`:''}
    ${sub.notes?`<tr><td class="lbl">Notes</td><td class="val">${sub.notes}</td></tr>`:''}
  </table>`;
  return baseEmail(header, body);
}

module.exports = router;
