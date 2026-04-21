const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

function get() { return load('tasks.json', seed().tasks); }
function set(d) { save('tasks.json', d); }

router.get('/', (req, res) => res.json(get()));

router.post('/', (req, res) => {
  const { title, due, deadline, priority } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const tasks = get();
  const task = { id: Date.now(), title, due: due || (deadline ? new Date(deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'), deadline: deadline || null, priority: priority || 'medium', done: false, createdAt: new Date().toISOString() };
  tasks.unshift(task);
  set(tasks);
  res.json({ task });
});

router.patch('/:id', (req, res) => {
  const tasks = get();
  const task = tasks.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Not found' });
  Object.assign(task, req.body);
  set(tasks);
  res.json({ task });
});

router.delete('/:id', (req, res) => {
  set(get().filter(t => t.id !== Number(req.params.id)));
  res.json({ ok: true });
});

module.exports = router;
