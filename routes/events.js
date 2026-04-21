const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

function get() { return load('events.json', seed().events); }
function set(d) { save('events.json', d); }

// ── Google Calendar client (lazy-loaded so missing creds don't crash startup) ──
function getGCalClient() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!key) return null;
  try {
    const { google } = require('googleapis');
    const creds = JSON.parse(
      key.startsWith('{') ? key : Buffer.from(key, 'base64').toString('utf8')
    );
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
    return google.calendar({ version: 'v3', auth });
  } catch (e) {
    console.error('GCal auth error:', e.message);
    return null;
  }
}

const GCAL_ID = () => process.env.GOOGLE_CALENDAR_ID || 'primary';

// ── Map local event → Google Calendar event body ──────────────────────────────
function toGCalEvent(ev) {
  const start = ev.date;
  return {
    summary: ev.title,
    description: [ev.note, ev.amount ? `Amount: ${ev.amount}` : ''].filter(Boolean).join('\n'),
    start: { date: start },
    end:   { date: start },
    colorId: ev.type === 'tax' ? '11' : ev.type === 'meeting' ? '9' : ev.type === 'deadline' ? '6' : '1'
  };
}

// ── Map Google Calendar event → local event ───────────────────────────────────
function fromGCalEvent(gcEv) {
  return {
    id: Date.now() + Math.random(),
    gcalId: gcEv.id,
    title: gcEv.summary || '(no title)',
    date: gcEv.start?.date || gcEv.start?.dateTime?.slice(0, 10) || '',
    note: gcEv.description || '',
    type: 'meeting',
    amount: null,
    recur: 'none'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => res.json(get()));

router.post('/', async (req, res) => {
  const { type, title, date, note, amount, recur } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title and date required' });
  const events = get();
  const event = {
    id: Date.now(), type: type || 'task', title, date,
    note: note || '', amount: amount ? Number(amount) : null,
    recur: recur || 'none', gcalId: null,
    createdAt: new Date().toISOString()
  };

  // Push to Google Calendar if configured
  const gcal = getGCalClient();
  if (gcal) {
    try {
      const r = await gcal.events.insert({ calendarId: GCAL_ID(), requestBody: toGCalEvent(event) });
      event.gcalId = r.data.id;
    } catch (e) {
      console.warn('GCal insert failed:', e.message);
    }
  }

  events.push(event);
  set(events);
  res.json({ event });
});

router.put('/:id', async (req, res) => {
  const events = get();
  const i = events.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  events[i] = { ...events[i], ...req.body, id: events[i].id };

  // Update in Google Calendar
  const gcal = getGCalClient();
  if (gcal && events[i].gcalId) {
    try {
      await gcal.events.update({ calendarId: GCAL_ID(), eventId: events[i].gcalId, requestBody: toGCalEvent(events[i]) });
    } catch (e) {
      console.warn('GCal update failed:', e.message);
    }
  }

  set(events);
  res.json({ event: events[i] });
});

router.delete('/:id', async (req, res) => {
  const events = get();
  const ev = events.find(e => e.id === Number(req.params.id));

  // Delete from Google Calendar
  const gcal = getGCalClient();
  if (gcal && ev?.gcalId) {
    try {
      await gcal.events.delete({ calendarId: GCAL_ID(), eventId: ev.gcalId });
    } catch (e) {
      console.warn('GCal delete failed:', e.message);
    }
  }

  set(events.filter(e => e.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bidirectional sync
// ─────────────────────────────────────────────────────────────────────────────

router.post('/gcal/sync', async (req, res) => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !process.env.GOOGLE_CALENDAR_ID) {
    return res.json({
      ok: false,
      message: 'Add GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_CALENDAR_ID to your .env file to enable Google Calendar sync'
    });
  }

  const gcal = getGCalClient();
  if (!gcal) return res.status(500).json({ ok: false, message: 'Failed to initialize Google Calendar client' });

  try {
    const now = new Date();
    const future = new Date(now); future.setMonth(future.getMonth() + 6);

    // Fetch events from Google Calendar (next 6 months)
    const gcRes = await gcal.events.list({
      calendarId: GCAL_ID(),
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250
    });

    const gcEvents = gcRes.data.items || [];
    const localEvents = get();
    const localGcalIds = new Set(localEvents.map(e => e.gcalId).filter(Boolean));

    // Import new Google Calendar events into local store
    let imported = 0;
    for (const gcEv of gcEvents) {
      if (!localGcalIds.has(gcEv.id) && gcEv.status !== 'cancelled') {
        localEvents.push(fromGCalEvent(gcEv));
        imported++;
      }
    }

    // Push local events that have no gcalId yet
    let pushed = 0;
    for (const ev of localEvents) {
      if (!ev.gcalId) {
        try {
          const r = await gcal.events.insert({ calendarId: GCAL_ID(), requestBody: toGCalEvent(ev) });
          ev.gcalId = r.data.id;
          pushed++;
        } catch (e) {
          console.warn('Push failed for event:', ev.title, e.message);
        }
      }
    }

    set(localEvents);
    res.json({
      ok: true,
      message: `Sync complete — ${imported} imported from Google, ${pushed} pushed to Google`,
      imported,
      pushed,
      total: localEvents.length
    });
  } catch (e) {
    console.error('GCal sync error:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
