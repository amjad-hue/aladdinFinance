const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

function get() { return load('statements.json', seed().statements); }
function set(d) { save('statements.json', d); }

router.get('/pnl', (req, res) => res.json(get().pnl));
router.put('/pnl', (req, res) => {
  const s = get(); s.pnl = req.body; set(s);
  res.json({ ok: true });
});

router.get('/balance-sheet', (req, res) => res.json(get().balanceSheet));
router.put('/balance-sheet', (req, res) => {
  const s = get(); s.balanceSheet = req.body; set(s);
  res.json({ ok: true });
});

router.put('/balance-sheet/item', (req, res) => {
  const { section, index, label, value } = req.body;
  const s = get();
  if (!s.balanceSheet[section] || s.balanceSheet[section][index] === undefined) {
    return res.status(404).json({ error: 'Item not found' });
  }
  s.balanceSheet[section][index] = { label, value: Number(value) };
  set(s);
  res.json({ ok: true });
});

router.post('/balance-sheet/item', (req, res) => {
  const { section, label, value } = req.body;
  const s = get();
  if (!s.balanceSheet[section]) return res.status(400).json({ error: 'Invalid section' });
  s.balanceSheet[section].push({ label, value: Number(value) });
  set(s);
  res.json({ ok: true });
});

router.delete('/balance-sheet/item', (req, res) => {
  const { section, index } = req.body;
  const s = get();
  if (!s.balanceSheet[section]) return res.status(400).json({ error: 'Invalid section' });
  s.balanceSheet[section].splice(index, 1);
  set(s);
  res.json({ ok: true });
});

module.exports = router;
