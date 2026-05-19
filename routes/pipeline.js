const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const { buildClientMap, resolveClientId } = require('../data/linker');
const { requireRole } = require('../middleware/roles');

function get() { return load('pipeline.json', seed().pipeline); }
function set(d) { save('pipeline.json', d); }

router.get('/', (req, res) => res.json(get()));

const VALID_STAGES = ['Prospecting','Qualification','Proposal','Negotiation','Closed Won','Closed Lost'];

function sanitizeDeal(data) {
  const prob = Number(data.probability);
  if (!isNaN(prob)) data.probability = Math.min(100, Math.max(0, prob));
  if (data.stage && !VALID_STAGES.includes(data.stage)) {
    return { error: `Invalid stage "${data.stage}". Must be one of: ${VALID_STAGES.join(', ')}` };
  }
  if (data.value !== undefined && Number(data.value) < 0) {
    return { error: 'Deal value cannot be negative' };
  }
  return null;
}

router.post('/', requireRole('write'), (req, res) => {
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
  if (deals[i].probability !== undefined) deals[i].probability = Math.min(100, Math.max(0, Number(deals[i].probability)));
  const clients = load('clients.json', seed().clients);
  deals[i].clientId = resolveClientId(deals[i].client, buildClientMap(clients));
  set(deals);

  // Auto-draft AR invoice when a deal transitions into Closed Won
  let arDraft = null;
  if (deals[i].stage === 'Closed Won' && prevStage !== 'Closed Won') {
    const ar = load('ar.json', seed().accountReceivables);
    const alreadyDrafted = ar.some(x => x.pipelineDealId === deals[i].id);
    if (!alreadyDrafted) {
      const today = new Date().toISOString().split('T')[0];
      const due   = deals[i].closeDate
        ? new Date(new Date(deals[i].closeDate).getTime() + 30*24*60*60*1000).toISOString().split('T')[0]
        : new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
      const invNo = 'INV-' + String(deals[i].id).slice(-5);
      arDraft = {
        id: Date.now(), client: deals[i].client, invoice: invNo,
        issuedDate: today, dueDate: due,
        amount: Number(deals[i].value) || 0,
        status: 'pending', revenueType: deals[i].revenueType || 'Services',
        planType: deals[i].planType || '',
        clientId: deals[i].clientId || null,
        pipelineDealId: deals[i].id,
        createdAt: new Date().toISOString(),
      };
      ar.push(arDraft);
      save('ar.json', ar);
    }
  }

  res.json({ deal: deals[i], arDraft });
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
