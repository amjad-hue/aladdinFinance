const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');
const { requireRole } = require('../middleware/roles');

function get() { return load('liabilities.json', seed().liabilities); }
function set(d) { save('liabilities.json', d); }

function recalc(cat) {
  cat.total = (cat.breakdown || []).reduce((s, b) => s + (b.amount || 0), 0);
  return cat;
}

router.get('/', (req, res) => res.json(get()));

router.post('/', requireRole('finance'), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const cats = get();
  const cat = { id: Date.now(), name, breakdown: [] };
  recalc(cat);
  cats.push(cat);
  set(cats);
  res.json({ category: cat });
});

router.put('/:id', requireRole('finance'), (req, res) => {
  const cats = get();
  const i = cats.findIndex(c => c.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  if (req.body.name) cats[i].name = req.body.name;
  recalc(cats[i]);
  set(cats);
  res.json({ category: cats[i] });
});

router.delete('/:id', requireRole('finance'), (req, res) => {
  const cats = get().filter(c => c.id !== Number(req.params.id));
  set(cats);
  res.json({ ok: true });
});

router.post('/:id/breakdown', requireRole('finance'), (req, res) => {
  const { name, dueDate, amount } = req.body;
  if (!name || !amount) return res.status(400).json({ error: 'name and amount required' });
  const cats = get();
  const i = cats.findIndex(c => c.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const row = { id: Date.now(), name, dueDate: dueDate || '', amount: Number(amount) };
  cats[i].breakdown.push(row);
  recalc(cats[i]);
  set(cats);
  res.json({ row, category: cats[i] });
});

router.put('/:id/breakdown/:rid', requireRole('finance'), (req, res) => {
  const cats = get();
  const i = cats.findIndex(c => c.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const j = cats[i].breakdown.findIndex(r => r.id === Number(req.params.rid));
  if (j === -1) return res.status(404).json({ error: 'Row not found' });
  cats[i].breakdown[j] = { ...cats[i].breakdown[j], ...req.body, id: cats[i].breakdown[j].id };
  if (cats[i].breakdown[j].amount) cats[i].breakdown[j].amount = Number(cats[i].breakdown[j].amount);
  recalc(cats[i]);
  set(cats);
  res.json({ category: cats[i] });
});

router.delete('/:id/breakdown/:rid', requireRole('finance'), (req, res) => {
  const cats = get();
  const i = cats.findIndex(c => c.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  cats[i].breakdown = cats[i].breakdown.filter(r => r.id !== Number(req.params.rid));
  recalc(cats[i]);
  set(cats);
  res.json({ category: cats[i] });
});

module.exports = router;
