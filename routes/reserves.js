const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

router.get('/', (req, res) => {
  res.json(load('reserves.json', seed().reserves));
});

router.post('/', (req, res) => {
  const { bank, name, amount } = req.body;
  if (!bank || !name || !amount) {
    return res.status(400).json({ error: 'bank, name and amount required' });
  }
  const reserves = load('reserves.json', seed().reserves);
  const id = Date.now();
  reserves.push({ id, bank, name, amount: Number(amount) });
  save('reserves.json', reserves);
  res.json({ success: true, id });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  let reserves = load('reserves.json', seed().reserves);
  reserves = reserves.filter(r => r.id !== id);
  save('reserves.json', reserves);
  res.json({ success: true });
});

module.exports = router;
