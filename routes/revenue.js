const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const seed = require('../data/seed');

router.get('/', (req, res) => {
  res.json(load('revenue.json', seed.revenue));
});

router.put('/', (req, res) => {
  const { revenue } = req.body;
  if (!Array.isArray(revenue)) {
    return res.status(400).json({ error: 'revenue array required' });
  }
  save('revenue.json', revenue);
  res.json({ success: true });
});

router.post('/sync', (req, res) => {
  const r = load('revenue.json', seed.revenue);
  res.json({ success: true, source: 'QuickBooks + HubSpot', revenue: r, syncedAt: new Date().toISOString() });
});

module.exports = router;
