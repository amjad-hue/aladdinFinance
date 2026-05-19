const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const { buildClientMap, resolveClientId, resolveDealId } = require('../data/linker');
const { requireRole } = require('../middleware/roles');

function get() { return load('commissions.json', seed().commissions); }
function set(d) { save('commissions.json', d); }

router.get('/', (req, res) => res.json(get()));

router.post('/', requireRole('write'), (req, res) => {
  const items = get();
  const clients  = load('clients.json', seed().clients);
  const pipeline = load('pipeline.json', seed().pipeline);
  const clientMap = buildClientMap(clients);
  const item = {
    id: Date.now(),
    dealName:  req.body.dealName || '',
    repName:   req.body.repName || '',
    client:    req.body.client || '',
    clientId:  resolveClientId(req.body.client, clientMap),
    dealId:    resolveDealId(req.body.dealName, pipeline),
    dealValue: Number(req.body.dealValue) || 0,
    rate:      Number(req.body.rate) || 5,
    amount:    Number(req.body.amount) || Math.round((Number(req.body.dealValue) || 0) * (Number(req.body.rate) || 5) / 100),
    status:    req.body.status || 'pending',
    date:      req.body.date || new Date().toISOString().split('T')[0],
    notes:     req.body.notes || ''
  };
  items.push(item);
  set(items);
  res.json({ item });
});

// Specific routes must come before /:id wildcard
router.get('/settings', (req, res) => {
  res.json(load('commission-settings.json', {
    rates: { Enterprise: 5, Government: 4, Tradeshow: 3, Default: 4 },
    recipientEmails: [],
    autoCalculate: true
  }));
});

router.put('/settings', requireRole('admin'), (req, res) => {
  save('commission-settings.json', req.body);
  res.json({ ok: true });
});

// Rename a rep across all commission records + settings
router.post('/rep-rename', requireRole('write'), (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName || !newName.trim()) return res.status(400).json({ error: 'oldName and newName required' });
  const trimmed = newName.trim();
  if (trimmed === oldName) return res.json({ ok: true, updated: 0 });
  const comms = get();
  let count = 0;
  set(comms.map(c => { if (c.repName === oldName) { count++; return { ...c, repName: trimmed }; } return c; }));
  const settings = load('commission-settings.json', {});
  if (settings.targets?.[oldName]) { settings.targets[trimmed] = settings.targets[oldName]; delete settings.targets[oldName]; }
  if (settings.customReps) settings.customReps = settings.customReps.map(r => r === oldName ? trimmed : r);
  if (settings.archivedReps) settings.archivedReps = settings.archivedReps.map(r => r === oldName ? trimmed : r);
  save('commission-settings.json', settings);
  res.json({ ok: true, updated: count });
});

// Archive / unarchive a rep
router.post('/rep-archive', requireRole('write'), (req, res) => {
  const { repName, archive } = req.body;
  if (!repName) return res.status(400).json({ error: 'repName required' });
  const settings = load('commission-settings.json', {});
  const archivedReps = [...(settings.archivedReps || [])];
  const idx = archivedReps.indexOf(repName);
  if (archive && idx === -1) archivedReps.push(repName);
  else if (!archive && idx >= 0) archivedReps.splice(idx, 1);
  settings.archivedReps = archivedReps;
  save('commission-settings.json', settings);
  res.json({ ok: true });
});

router.put('/:id', requireRole('write'), (req, res) => {
  const items = get();
  const i = items.findIndex(x => x.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  // Block marking commission as paid if linked deal hasn't closed yet
  if (req.body.status === 'paid') {
    const pipeline = load('pipeline.json', seed().pipeline);
    const deal = pipeline.find(d => d.id === (items[i].dealId || resolveDealId(items[i].dealName, pipeline)));
    if (deal && deal.closeDate) {
      const today = new Date().toISOString().split('T')[0];
      if (deal.closeDate > today) {
        return res.status(400).json({ error: `Cannot mark commission as paid — deal "${deal.name}" close date (${deal.closeDate}) is in the future` });
      }
      if (deal.stage !== 'Closed Won') {
        return res.status(400).json({ error: `Cannot mark commission as paid — deal "${deal.name}" is not Closed Won (current stage: ${deal.stage})` });
      }
    }
  }
  items[i] = { ...items[i], ...req.body, id: items[i].id };
  // Re-resolve FK fields on every update
  const clients  = load('clients.json', seed().clients);
  const pipeline = load('pipeline.json', seed().pipeline);
  items[i].clientId = resolveClientId(items[i].client, buildClientMap(clients));
  items[i].dealId   = resolveDealId(items[i].dealName, pipeline);
  set(items);
  res.json({ item: items[i] });
});

router.delete('/:id', requireRole('write'), (req, res) => {
  set(get().filter(x => x.id !== Number(req.params.id)));
  res.json({ ok: true });
});

module.exports = router;
