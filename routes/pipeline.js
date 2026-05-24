const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const { buildClientMap, resolveClientId } = require('../data/linker');
const { requireRole } = require('../middleware/roles');
const mailer = require('../lib/mailer');

function newLeadHtml(deal) {
  const fmt = v => v ? `$${Number(v).toLocaleString()}` : '—';
  const pct = deal.probability != null ? `${deal.probability}%` : '—';
  const rows = [
    ['Client', deal.client || '—'],
    ['Stage', deal.stage || '—'],
    ['Value', fmt(deal.value)],
    ['Probability', pct],
    ['Close Date', deal.closeDate || '—'],
    ['Owner', deal.owner || '—'],
    ['Revenue Type', deal.revenueType || '—'],
  ].map(([k,v]) => `<tr><td style="padding:7px 12px;font-size:13px;color:#6B7280;width:140px;white-space:nowrap">${k}</td><td style="padding:7px 12px;font-size:13px;font-weight:600;color:#111">${v}</td></tr>`).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:36px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="background:linear-gradient(135deg,#3B5BDB 0%,#5C7CFA 100%);padding:28px 32px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:rgba(255,255,255,.7);text-transform:uppercase;margin-bottom:6px">New Lead</div>
    <div style="font-size:22px;font-weight:800;color:#fff">${deal.name || 'Untitled Deal'}</div>
  </div>
  <div style="padding:24px 32px">
    <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden">${rows}</table>
    ${deal.notes ? `<div style="margin-top:16px;padding:14px;background:#F9FAFB;border-radius:8px;font-size:12px;color:#374151"><strong>Notes:</strong> ${deal.notes}</div>` : ''}
  </div>
  <div style="padding:14px 32px 24px;text-align:center">
    <div style="font-size:11px;color:#9CA3AF">Aladdin Finance · New deal added ${new Date().toLocaleDateString()}</div>
  </div>
</div></body></html>`;
}

function get() { return load('pipeline.json', seed().pipeline); }
function set(d) { save('pipeline.json', d); }

router.get('/', (req, res) => res.json(get()));

const VALID_STAGES = ['Prospecting','Qualification','Proposal','Negotiation','Closed Won','Closed Lost','On Hold'];

const STAGE_PROB = {
  'Prospecting': 10, 'Qualification': 20, 'Proposal': 40,
  'Negotiation': 60, 'On Hold': 30, 'Closed Won': 100, 'Closed Lost': 0,
};

function stageProbability(stage) {
  return STAGE_PROB[stage] ?? 50;
}

function sanitizeDeal(data) {
  if (data.stage) {
    data.probability = stageProbability(data.stage);
  }
  if (data.stage && !VALID_STAGES.includes(data.stage)) {
    return { error: `Invalid stage "${data.stage}". Must be one of: ${VALID_STAGES.join(', ')}` };
  }
  if (data.value !== undefined && Number(data.value) < 0) {
    return { error: 'Deal value cannot be negative' };
  }
  return null;
}

router.post('/', requireRole('write'), async (req, res) => {
  const err = sanitizeDeal(req.body);
  if (err) return res.status(400).json(err);
  const deals = get();
  const clients = load('clients.json', seed().clients);
  const clientMap = buildClientMap(clients);
  const deal = {
    id: Date.now(), ...req.body,
    probability: Math.min(100, Math.max(0, Number(req.body.probability) || 0)),
    clientId: resolveClientId(req.body.client, clientMap),
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
  deals.push(deal);
  set(deals);

  // Send new-lead notification email
  if (mailer.isConfigured()) {
    try {
      const appSettings = load('app-settings.json', {});
      const notifyList = Array.isArray(appSettings.leadNotifyEmails) ? appSettings.leadNotifyEmails : [];
      const ownerEmail = deal.ownerEmail || '';
      const toSet = new Set(notifyList.map(e => e.trim()).filter(Boolean));
      if (ownerEmail) toSet.add(ownerEmail.trim());
      if (toSet.size > 0) {
        await mailer.sendMail({
          to: [...toSet].join(', '),
          subject: `New Lead: ${deal.name || 'Untitled Deal'}`,
          html: newLeadHtml(deal),
        });
      }
    } catch (e) { console.error('Lead notify email failed:', e.message); }
  }

  res.json({ deal });
});

router.put('/:id', requireRole('write'), (req, res) => {
  const err = sanitizeDeal(req.body);
  if (err) return res.status(400).json(err);
  const deals = get();
  const i = deals.findIndex(d => d.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const prevStage = deals[i].stage;
  deals[i] = { ...deals[i], ...req.body, id: deals[i].id, lastUpdated: new Date().toISOString() };
  deals[i].probability = stageProbability(deals[i].stage);
  const clients = load('clients.json', seed().clients);
  deals[i].clientId = resolveClientId(deals[i].client, buildClientMap(clients));
  set(deals);

  let arDraft = null, autoProject = null, autoSubscription = null, autoCommission = null;

  if (deals[i].stage === 'Closed Won' && prevStage !== 'Closed Won') {
    const deal = deals[i];
    const dealType = deal.dealType || 'event_project';
    const today = new Date().toISOString().split('T')[0];

    // ── Auto-draft AR invoice ──────────────────────────────────────────────────
    const ar = load('ar.json', seed().accountReceivables);
    if (!ar.some(x => x.pipelineDealId === deal.id)) {
      const due = deal.closeDate
        ? new Date(new Date(deal.closeDate).getTime() + 30*24*60*60*1000).toISOString().split('T')[0]
        : new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
      arDraft = {
        id: Date.now(), client: deal.client, invoice: 'INV-' + String(deal.id).slice(-5),
        issuedDate: today, dueDate: due, amount: Number(deal.value) || 0,
        status: 'pending', revenueType: deal.revenueType || 'Services',
        planType: deal.plan || deal.planType || '',
        clientId: deal.clientId || null, pipelineDealId: deal.id,
        createdAt: new Date().toISOString(),
      };
      ar.push(arDraft);
      save('ar.json', ar);
    }

    // ── Branch A: Event / Project ──────────────────────────────────────────────
    if (dealType === 'event_project') {
      const projects = load('projects.json', seed().projects);
      if (!projects.some(p => p.dealId === deal.id)) {
        autoProject = {
          id: Date.now() + 1, name: deal.name, client: deal.client,
          clientId: deal.clientId || null, dealId: deal.id,
          status: 'active', type: 'implementation',
          startDate: today, endDate: deal.closeDate || '',
          budget: Number(deal.value) || 0, actualSpend: 0, linkedRevenue: 0,
          manager: deal.owner || '', description: `Auto-created from deal: ${deal.name}`,
          milestones: [], notes: '', linkedBudgetCats: [],
          createdAt: new Date().toISOString(), fromDeal: true,
        };
        projects.push(autoProject);
        save('projects.json', projects);
      }
    }

    // ── Branch B: Subscription ────────────────────────────────────────────────
    if (dealType === 'subscription') {
      const subs = load('subscriptions.json', seed().subscriptions);
      if (!subs.some(s => s.dealId === deal.id)) {
        autoSubscription = {
          id: Date.now() + 2, clientName: deal.client, clientId: deal.clientId || null,
          dealId: deal.id, plan: deal.plan || '', billing: deal.billingCycle || 'monthly',
          amount: Number(deal.value) || 0, status: 'pending_approval',
          startDate: '', renewalDate: '', seats: 0,
          notes: `Auto-created from deal: ${deal.name}`, owner: deal.owner || '',
          ownerEmail: deal.ownerEmail || '', createdAt: new Date().toISOString(), fromDeal: true,
        };
        subs.push(autoSubscription);
        save('subscriptions.json', subs);
      }
    }

    // ── Auto-create pending Commission (both branches) ────────────────────────
    const commissions = load('commissions.json', seed().commissions);
    if (!commissions.some(c => c.dealId === deal.id)) {
      const commSettings = load('commission-settings.json', { rates: { Enterprise:5, Government:4, Tradeshow:3, Default:4 } });
      const channel = deal.type || 'Default';
      const rate = commSettings.rates?.[channel] ?? commSettings.rates?.Default ?? 4;
      autoCommission = {
        id: Date.now() + 3, dealName: deal.name, repName: deal.owner || '',
        client: deal.client, clientId: deal.clientId || null, dealId: deal.id,
        dealValue: Number(deal.value) || 0, rate, amount: Math.round((Number(deal.value) || 0) * rate / 100),
        status: 'pending', date: today, notes: 'Auto-generated on Closed Won',
        fromDeal: true,
      };
      commissions.push(autoCommission);
      save('commissions.json', commissions);
    }
  }

  res.json({ deal: deals[i], arDraft, autoProject, autoSubscription, autoCommission });
});

router.delete('/:id', requireRole('write'), (req, res) => {
  const deals = get();
  set(deals.filter(d => d.id !== Number(req.params.id)));
  res.json({ ok: true });
});

router.get('/summary', (req, res) => {
  const deals = get();
  const byType = {};
  const byStage = {};
  let totalValue = 0, weightedValue = 0;
  deals.forEach(d => {
    byType[d.type] = (byType[d.type] || 0) + d.value;
    byStage[d.stage] = (byStage[d.stage] || 0) + 1;
    totalValue += d.value;
    weightedValue += d.value * (d.probability / 100);
  });
  res.json({ byType, byStage, totalValue, weightedValue, count: deals.length });
});

router.post('/sync', (req, res) => {
  res.json({ ok: true, message: 'HubSpot sync — add HUBSPOT_ACCESS_TOKEN to .env to enable live data' });
});

// Pipeline Cash Flow Forecast — persisted override data
function pfGet() { return load('pipeline-forecast.json', {}); }
function pfSet(d) { save('pipeline-forecast.json', d); }

router.get('/forecast-cashflow', (req, res) => res.json(pfGet()));

router.put('/forecast-cashflow', requireRole('write'), (req, res) => {
  pfSet(req.body);
  res.json({ ok: true });
});

module.exports = router;
