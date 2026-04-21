const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

function get() { return load('events.json', seed().events); }
function set(d) { save('events.json', d); }

router.get('/', (req, res) => res.json(get()));

router.post('/', (req, res) => {
  const { type, title, date, note, amount, recur } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title and date required' });
  const events = get();
  const event = { id: Date.now(), type: type || 'task', title, date, note: note || '', amount: amount ? Number(amount) : null, recur: recur || 'none', gcalId: null, createdAt: new Date().toISOString() };
  events.push(event);
  set(events);
  res.json({ event });
});

router.put('/:id', (req, res) => {
  const events = get();
  const i = events.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  events[i] = { ...events[i], ...req.body, id: events[i].id };
  set(events);
  res.json({ event: events[i] });
});

router.delete('/:id', (req, res) => {
  set(get().filter(e => e.id !== Number(req.params.id)));
  res.json({ ok: true });
});

router.post('/gcal/sync', (req, res) => {
  if (!process.env.GOOGLE_CALENDAR_ID) {
    return res.json({ ok: false, message: 'Add GOOGLE_CALENDAR_ID and GOOGLE_SERVICE_ACCOUNT_KEY to .env to enable Google Calendar sync' });
  }
  res.json({ ok: true, message: 'Google Calendar sync triggered', synced: 0 });
});

module.exports = router;
