const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const seed = require('../data/seed');

router.get('/', (req, res) => {
  res.json(load('budget.json', seed.budget));
});

router.put('/', (req, res) => {
  const { budget } = req.body;
  if (!Array.isArray(budget)) {
    return res.status(400).json({ error: 'budget array required' });
  }
  save('budget.json', budget);
  res.json({ success: true });
});

router.post('/sync', (req, res) => {
  const b = load('budget.json', seed.budget);
  res.json({ success: true, source: 'QuickBooks', budget: b, syncedAt: new Date().toISOString() });
});

module.exports = router;
