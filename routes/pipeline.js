const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

function get() { return load('pipeline.json', seed().pipeline); }
function set(d) { save('pipeline.json', d); }

router.get('/', (req, res) => res.json(get()));

router.post('/', (req, res) => {
  const deals = get();
  const deal = { id: Date.now(), ...req.body, createdAt: new Date().toISOString() };
  deals.push(deal);
  set(deals);
  res.json({ deal });
});

router.put('/:id', (req, res) => {
  const deals = get();
  const i = deals.findIndex(d => d.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  deals[i] = { ...deals[i], ...req.body, id: deals[i].id };
  set(deals);
  res.json({ deal: deals[i] });
});

router.delete('/:id', (req, res) => {
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

module.exports = router;
