const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const seed = require('../data/seed');

router.get('/', (req, res) => {
  res.json(load('cashflow.json', seed.cashflow));
});

router.put('/', (req, res) => {
  const { cashflow } = req.body;
  if (!Array.isArray(cashflow)) {
    return res.status(400).json({ error: 'cashflow array required' });
  }
  save('cashflow.json', cashflow);
  res.json({ success: true });
});

router.post('/sync', (req, res) => {
  const cf = load('cashflow.json', seed.cashflow);
  res.json({ success: true, source: 'QuickBooks', cashflow: cf, syncedAt: new Date().toISOString() });
});

module.exports = router;
