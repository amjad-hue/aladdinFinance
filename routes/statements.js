const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const { requireRole } = require('../middleware/roles');

function get() { return load('statements.json', seed().statements); }
function set(d) { save('statements.json', d); }

router.get('/pnl', (req, res) => res.json(get().pnl));
router.put('/pnl', requireRole('finance'), (req, res) => {
  const s = get(); s.pnl = req.body; set(s);
  res.json({ ok: true });
});

router.get('/balance-sheet', (req, res) => res.json(get().balanceSheet));
router.put('/balance-sheet', requireRole('finance'), (req, res) => {
  const bs = req.body;
  const placeholders = ['new item', 'new', 'untitled', 'item'];
  for (const sec of ['assets','liabilities','equity']) {
    for (const item of (bs[sec]||[])) {
      if (!item.label || placeholders.includes(item.label.trim().toLowerCase())) {
        return res.status(400).json({ error: `Balance sheet line "${item.label||'(blank)'}" has a placeholder name. Please give it a descriptive label before saving.` });
      }
    }
  }
  const s = get(); s.balanceSheet = bs; set(s);
  res.json({ ok: true });
});

router.put('/balance-sheet/item', requireRole('finance'), (req, res) => {
  const { section, index, label, value } = req.body;
  const s = get();
  if (!s.balanceSheet[section] || s.balanceSheet[section][index] === undefined) {
    return res.status(404).json({ error: 'Item not found' });
  }
  s.balanceSheet[section][index] = { label, value: Number(value) };
  set(s);
  res.json({ ok: true });
});

router.post('/balance-sheet/item', requireRole('finance'), (req, res) => {
  const { section, label, value } = req.body;
  const s = get();
  if (!s.balanceSheet[section]) return res.status(400).json({ error: 'Invalid section' });
  s.balanceSheet[section].push({ label, value: Number(value) });
  set(s);
  res.json({ ok: true });
});

router.delete('/balance-sheet/item', requireRole('finance'), (req, res) => {
  const { section, index } = req.body;
  const s = get();
  if (!s.balanceSheet[section]) return res.status(400).json({ error: 'Invalid section' });
  s.balanceSheet[section].splice(index, 1);
  set(s);
  res.json({ ok: true });
});

module.exports = router;
