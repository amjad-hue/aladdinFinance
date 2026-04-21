const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const seed = require('../data/seed');

router.get('/', (req, res) => {
  res.json(load('tasks.json', seed.tasks));
});

router.post('/', (req, res) => {
  const { title, due } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const tasks = load('tasks.json', seed.tasks);
  const task = { id: Date.now(), title, due: due || '—', done: false };
  tasks.unshift(task);
  save('tasks.json', tasks);
  res.json({ success: true, task });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const tasks = load('tasks.json', seed.tasks);
  const task = tasks.find(t => t.id === id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  Object.assign(task, req.body);
  save('tasks.json', tasks);
  res.json({ success: true, task });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  let tasks = load('tasks.json', seed.tasks);
  tasks = tasks.filter(t => t.id !== id);
  save('tasks.json', tasks);
  res.json({ success: true });
});

module.exports = router;
