const express = require('express');
const router = express.Router();
const { load, save } = require('../data/store');
const seed = require('../data/seed');

router.get('/', (req, res) => {
  res.json(load('events.json', seed.events));
});

router.post('/', (req, res) => {
  const { type, title, date, note, amount, recur } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title and date required' });
  const events = load('events.json', seed.events);
  const id = Date.now();
  const event = {
    id, type: type || 'task', title, date,
    note: note || '', amount: amount ? Number(amount) : undefined,
    recur: recur || 'none'
  };
  events.push(event);
  save('events.json', events);
  res.json({ success: true, event });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  let events = load('events.json', seed.events);
  events = events.filter(e => e.id !== id);
  save('events.json', events);
  res.json({ success: true });
});

module.exports = router;
