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

// ── Zoom Server-to-Server OAuth ───────────────────────────────────────────────
async function getZoomToken() {
  const axios = require('axios');
  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error('ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET not set in .env');
  }
  const creds = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
  const r = await axios.post(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    null,
    { headers: { Authorization: `Basic ${creds}` } }
  );
  return r.data.access_token;
}

router.post('/zoom/create', async (req, res) => {
  const { title, date, time, duration } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title and date required' });
  try {
    const token = await getZoomToken();
    const axios = require('axios');
    const startTime = `${date}T${time || '09:00'}:00`;
    const r = await axios.post(
      'https://api.zoom.us/v2/users/me/meetings',
      {
        topic: title,
        type: 2,
        start_time: startTime,
        duration: Number(duration) || 60,
        settings: { join_before_host: true, waiting_room: false }
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    res.json({ joinUrl: r.data.join_url, meetingId: r.data.id });
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

function toGCalEvent(ev) {
  const colorId = ev.type === 'tax' ? '11' : ev.type === 'meeting' ? '9' : ev.type === 'deadline' ? '6' : '1';
  const descParts = [ev.note, ev.amount ? `Amount: ${ev.amount}` : '', ev.zoomLink ? `Video: ${ev.zoomLink}` : ''].filter(Boolean);

  // If we have a time, use dateTime; otherwise use all-day date
  if (ev.time) {
    const tz = 'Asia/Dubai';
    const startDt = `${ev.date}T${ev.time}:00`;
    // End time: use endTime if set, otherwise default +1h
    let endDt;
    if (ev.endTime) {
      endDt = `${ev.date}T${ev.endTime}:00`;
    } else {
      const [h, m] = ev.time.split(':').map(Number);
      const endH = String(h + 1).padStart(2, '0');
      endDt = `${ev.date}T${endH}:${String(m).padStart(2, '0')}:00`;
    }
    const attendees = (ev.invitees || []).filter(Boolean).map(email => ({ email }));
    return {
      summary: ev.title,
      description: descParts.join('\n'),
      start: { dateTime: startDt, timeZone: tz },
      end:   { dateTime: endDt,   timeZone: tz },
      colorId,
      ...(attendees.length ? { attendees, guestsCanSeeOtherGuests: true } : {}),
      ...(ev.zoomLink ? { location: ev.zoomLink } : {}),
    };
  }
  return {
    summary: ev.title,
    description: descParts.join('\n'),
    start: { date: ev.date },
    end:   { date: ev.date },
    colorId,
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
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    prompt: req.query.switch === '1' ? 'select_account consent' : 'consent'
  });
  res.redirect(url);
}

function gcalDisconnect(req, res) {
  save('gcal_tokens.json', null);
  res.json({ ok: true });
}

// ── Public: OAuth callback (no JWT needed) ────────────────────────────────────
async function gcalCallback(req, res) {
  const { code, error } = req.query;
  if (error) return res.status(400).send('Google denied access: ' + error);
  if (!code) return res.status(400).send('Missing authorization code');

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    // Store connected email alongside tokens
    let email = null;
    try {
      client.setCredentials(tokens);
      const { google } = require('googleapis');
      const oauth2 = google.oauth2({ version: 'v2', auth: client });
      const info = await oauth2.userinfo.get();
      email = info.data.email || null;
    } catch (_) {}
    saveTokens({ ...tokens, _email: email });
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
  const tokens = loadTokens();
  res.json({
    configured: isConfigured(),
    connected:  isConnected(),
    email:      tokens?._email || null,
    hasDrive:   !!(tokens?.scope || '').includes('drive')
  });
});

// ── Disconnect ────────────────────────────────────────────────────────────────
router.delete('/gcal/disconnect', (req, res) => {
  const { save } = require('../data/store');
  save('gcal_tokens.json', null);
  res.json({ ok: true });
});

// ── Meeting invitation email (fallback when GCal not connected) ───────────────
function buildInviteEmail(event, toEmail) {
  const fmtTime = t => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const timeStr = event.time ? `${fmtTime(event.time)}${event.endTime ? ' – ' + fmtTime(event.endTime) : ''}` : 'All day';
  const dateObj = new Date(event.date + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:28px 16px;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09)">
  <div style="background:linear-gradient(135deg,#1E40AF 0%,#2563EB 100%);padding:26px 32px">
    <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Meeting Invitation</div>
    <div style="font-size:20px;font-weight:800;color:#fff">${event.title}</div>
    <div style="font-size:12px;color:rgba(255,255,255,.85);margin-top:8px">${dateStr} · ${timeStr}</div>
  </div>
  <div style="padding:24px 32px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="border-bottom:1px solid #E4E7EC"><td style="padding:9px 0;color:#5E6C84;width:120px">Type</td><td style="padding:9px 0;font-weight:600;text-transform:capitalize">${event.type || 'Meeting'}</td></tr>
      <tr style="border-bottom:1px solid #E4E7EC"><td style="padding:9px 0;color:#5E6C84">Date</td><td style="padding:9px 0;font-weight:600">${dateStr}</td></tr>
      <tr style="border-bottom:1px solid #E4E7EC"><td style="padding:9px 0;color:#5E6C84">Time</td><td style="padding:9px 0;font-weight:600">${timeStr}</td></tr>
      ${event.zoomLink ? `<tr style="border-bottom:1px solid #E4E7EC"><td style="padding:9px 0;color:#5E6C84">Video Link</td><td style="padding:9px 0"><a href="${event.zoomLink}" style="color:#2563EB;font-weight:600">Join Meeting →</a></td></tr>` : ''}
    </table>
    ${event.note ? `<div style="margin-top:16px;background:#F8FAFC;border-radius:8px;padding:14px 16px"><div style="font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:8px">Agenda</div><div style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap">${event.note}</div></div>` : ''}
  </div>
  <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:14px 32px;text-align:center">
    <div style="font-size:10px;color:#94A3B8">CFO Genie · Meeting Invitation · Automated</div>
  </div>
</div>
</body></html>`;
}

async function sendFallbackInvites(event) {
  const mailer = require('../lib/mailer');
  if (!mailer.isConfigured()) return { sent: 0 };
  const invitees = (event.invitees || []).filter(Boolean);
  if (!invitees.length) return { sent: 0 };
  let sent = 0;
  for (const email of invitees) {
    try {
      await mailer.sendMail({
        to: email,
        subject: `📅 Meeting Invitation: ${event.title} — ${event.date}`,
        html: buildInviteEmail(event, email),
      });
      sent++;
    } catch (e) { console.warn(`[events] Invite to ${email} failed:`, e.message); }
  }
  return { sent };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => res.json(get()));

router.post('/', async (req, res) => {
  const { type, title, date, time, endTime, note, amount, recur, zoomLink, invitees } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title and date required' });
  const events = get();
  const event = {
    id: Date.now(), type: type || 'task', title, date,
    time: time || '', endTime: endTime || '', note: note || '',
    amount: amount ? Number(amount) : null,
    recur: recur || 'none', zoomLink: zoomLink || null,
    invitees: Array.isArray(invitees) ? invitees : [],
    gcalId: null, createdAt: new Date().toISOString()
  };

  let invitesSent = 0;
  const gcal = getCalendar();
  if (gcal) {
    try {
      const sendUpdates = (event.invitees || []).length ? 'all' : 'none';
      const r = await gcal.events.insert({ calendarId: GCAL_ID(), requestBody: toGCalEvent(event), sendUpdates });
      event.gcalId = r.data.id;
      if (sendUpdates === 'all') invitesSent = event.invitees.length;
    } catch (e) { console.warn('GCal insert failed:', e.message); }
  }

  // Fallback: send email invitations directly if GCal didn't handle it
  if (!gcal && event.invitees.length) {
    const fb = await sendFallbackInvites(event);
    invitesSent = fb.sent;
  }

  events.push(event);
  set(events);
  res.json({ event, invitesSent });
});

router.put('/:id', async (req, res) => {
  const events = get();
  const i = events.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const prev = events[i];
  events[i] = { ...prev, ...req.body, id: prev.id };

  let invitesSent = 0;
  const gcal = getCalendar();
  if (gcal && events[i].gcalId) {
    try {
      const sendUpdates = (events[i].invitees || []).length ? 'all' : 'none';
      await gcal.events.update({ calendarId: GCAL_ID(), eventId: events[i].gcalId, requestBody: toGCalEvent(events[i]), sendUpdates });
      if (sendUpdates === 'all') invitesSent = (events[i].invitees || []).length;
    } catch (e) { console.warn('GCal update failed:', e.message); }
  }

  // Fallback invites on update — only for newly added invitees
  if (!gcal && (events[i].invitees || []).length) {
    const prevInvitees = new Set(prev.invitees || []);
    const newInvitees = (events[i].invitees || []).filter(e => !prevInvitees.has(e));
    if (newInvitees.length) {
      const fb = await sendFallbackInvites({ ...events[i], invitees: newInvitees });
      invitesSent = fb.sent;
    }
  }

  set(events);
  res.json({ event: events[i], invitesSent });
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
module.exports.gcalAuth      = gcalAuth;
module.exports.gcalCallback  = gcalCallback;
module.exports.gcalDisconnect = gcalDisconnect;
