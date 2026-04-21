const router = require('express').Router();
const { load, save } = require('../data/store');
const { seed } = require('../data/seed');

function get() { return load('events.json', seed().events); }
function set(d) { save('events.json', d); }

// ── OAuth2 client ─────────────────────────────────────────────────────────────
function getOAuth2Client() {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/events/gcal/callback'
  );
}

function loadTokens() { return load('gcal_tokens.json', null); }
function saveTokens(t) { save('gcal_tokens.json', t); }

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
function isConnected() {
  const t = loadTokens();
  return !!(t && t.refresh_token);
}

function getAuthedClient() {
  if (!isConfigured() || !isConnected()) return null;
  const client = getOAuth2Client();
  const tokens = loadTokens();
  client.setCredentials(tokens);
  // Persist refreshed access tokens automatically
  client.on('tokens', updated => saveTokens({ ...tokens, ...updated }));
  return client;
}

function getCalendar() {
  const auth = getAuthedClient();
  if (!auth) return null;
  const { google } = require('googleapis');
  return google.calendar({ version: 'v3', auth });
}

const GCAL_ID = () => process.env.GOOGLE_CALENDAR_ID || 'primary';

function toGCalEvent(ev) {
  return {
    summary: ev.title,
    description: [ev.note, ev.amount ? `Amount: ${ev.amount}` : ''].filter(Boolean).join('\n'),
    start: { date: ev.date },
    end:   { date: ev.date },
    colorId: ev.type === 'tax' ? '11' : ev.type === 'meeting' ? '9' : ev.type === 'deadline' ? '6' : '1'
  };
}

function fromGCalEvent(gcEv) {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    gcalId: gcEv.id,
    title: gcEv.summary || '(no title)',
    date: gcEv.start?.date || gcEv.start?.dateTime?.slice(0, 10) || '',
    note: gcEv.description || '',
    type: 'meeting',
    amount: null,
    recur: 'none',
    createdAt: new Date().toISOString()
  };
}

// ── Public: OAuth authorize redirect (no JWT needed) ─────────────────────────
function gcalAuth(req, res) {
  if (!isConfigured()) {
    return res.status(400).send('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set in .env');
  }
  const url = getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent'
  });
  res.redirect(url);
}

// ── Public: OAuth callback (no JWT needed) ────────────────────────────────────
async function gcalCallback(req, res) {
  const { code, error } = req.query;
  if (error) return res.status(400).send('Google denied access: ' + error);
  if (!code) return res.status(400).send('Missing authorization code');

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    saveTokens(tokens);
    res.send(`<!DOCTYPE html><html><head><title>Connected</title></head>
    <body style="font-family:sans-serif;background:#080c17;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column">
      <div style="font-size:56px;margin-bottom:16px">✓</div>
      <h2 style="margin:0 0 8px;color:#22c55e">Google Calendar Connected!</h2>
      <p style="color:#94a3b8;margin:0">You can close this tab and return to Aladdin Finance.</p>
      <script>setTimeout(()=>{try{window.opener?.postMessage('gcal_connected','*');}catch(e){}window.close();},1500);</script>
    </body></html>`);
  } catch (e) {
    console.error('GCal callback error:', e.message);
    res.status(500).send('Token exchange failed: ' + e.message);
  }
}

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/gcal/status', (req, res) => {
  res.json({ configured: isConfigured(), connected: isConnected() });
});

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => res.json(get()));

router.post('/', async (req, res) => {
  const { type, title, date, note, amount, recur } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title and date required' });
  const events = get();
  const event = {
    id: Date.now(), type: type || 'task', title, date,
    note: note || '', amount: amount ? Number(amount) : null,
    recur: recur || 'none', gcalId: null, createdAt: new Date().toISOString()
  };

  const gcal = getCalendar();
  if (gcal) {
    try {
      const r = await gcal.events.insert({ calendarId: GCAL_ID(), requestBody: toGCalEvent(event) });
      event.gcalId = r.data.id;
    } catch (e) { console.warn('GCal insert failed:', e.message); }
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

  const gcal = getCalendar();
  if (gcal && events[i].gcalId) {
    try {
      await gcal.events.update({ calendarId: GCAL_ID(), eventId: events[i].gcalId, requestBody: toGCalEvent(events[i]) });
    } catch (e) { console.warn('GCal update failed:', e.message); }
  }

  set(events);
  res.json({ event: events[i] });
});

router.delete('/:id', async (req, res) => {
  const events = get();
  const ev = events.find(e => e.id === Number(req.params.id));

  const gcal = getCalendar();
  if (gcal && ev?.gcalId) {
    try {
      await gcal.events.delete({ calendarId: GCAL_ID(), eventId: ev.gcalId });
    } catch (e) { console.warn('GCal delete failed:', e.message); }
  }

  set(events.filter(e => e.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ── Bidirectional sync ────────────────────────────────────────────────────────
router.post('/gcal/sync', async (req, res) => {
  if (!isConfigured()) {
    return res.json({ ok: false, message: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env' });
  }
  if (!isConnected()) {
    return res.json({ ok: false, needsAuth: true, message: 'Google Calendar not connected yet — click "Connect" first' });
  }

  const gcal = getCalendar();
  if (!gcal) return res.status(500).json({ ok: false, message: 'Failed to initialize Google Calendar client' });

  try {
    const now = new Date();
    const future = new Date(now); future.setMonth(future.getMonth() + 6);

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

    let imported = 0;
    for (const gcEv of gcEvents) {
      if (!localGcalIds.has(gcEv.id) && gcEv.status !== 'cancelled') {
        localEvents.push(fromGCalEvent(gcEv));
        imported++;
      }
    }

    let pushed = 0;
    for (const ev of localEvents) {
      if (!ev.gcalId) {
        try {
          const r = await gcal.events.insert({ calendarId: GCAL_ID(), requestBody: toGCalEvent(ev) });
          ev.gcalId = r.data.id;
          pushed++;
        } catch (e) { console.warn('Push failed:', ev.title, e.message); }
      }
    }

    set(localEvents);
    res.json({ ok: true, message: `Sync complete — ${imported} pulled from Google, ${pushed} pushed to Google`, imported, pushed });
  } catch (e) {
    console.error('GCal sync error:', e.message);
    res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
module.exports.gcalAuth = gcalAuth;
module.exports.gcalCallback = gcalCallback;
