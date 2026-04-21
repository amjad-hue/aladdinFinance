const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

function get() { return load('revenue.json', seed().revenue); }
function set(d) { save('revenue.json', d); }

router.get('/', (req, res) => res.json(get()));

router.put('/', (req, res) => {
  const data = req.body.revenue || req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: 'revenue array required' });
  set(data);
  res.json({ ok: true });
});

router.put('/:month', (req, res) => {
  const rev = get();
  const i = rev.findIndex(r => r.month.toLowerCase() === req.params.month.toLowerCase());
  if (i === -1) return res.status(404).json({ error: 'Month not found' });
  rev[i] = { ...rev[i], ...req.body };
  set(rev);
  res.json({ row: rev[i] });
});

router.post('/sync', (req, res) => {
  res.json({ ok: true, source: 'QuickBooks + HubSpot', revenue: get(), syncedAt: new Date().toISOString() });
});

module.exports = router;
