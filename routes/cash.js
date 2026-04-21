const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

router.get('/', (req, res) => {
  const banks = load('banks.json', seed().banks);
  res.json(banks);
});

router.post('/sync', async (req, res) => {
  try {
    const banks = load('banks.json', seed().banks);
    save('banks.json', banks);
    res.json({ success: true, source: 'QuickBooks', banks, syncedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
