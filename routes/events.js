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

function isPermissionError(e) {
  const msg = (e.message || '').toLowerCase();
  const status = e.code || e.response?.status;
  return status === 403 || msg.includes('writer') || msg.includes('forbidden') || msg.includes('permission');
}

async function gcalInsertWithFallback(gcal, eventBody, sendUpdates) {
  const calId = GCAL_ID();
  try {
    const r = await gcal.events.insert({ calendarId: calId, requestBody: eventBody, sendUpdates });
    return { id: r.data.id, calendarId: calId, usedFallback: false };
  } catch (e) {
    if (calId !== 'primary' && isPermissionError(e)) {
      const r = await gcal.events.insert({ calendarId: 'primary', requestBody: eventBody, sendUpdates });
      return { id: r.data.id, calendarId: 'primary', usedFallback: true };
    }
    throw e;
  }
}

async function gcalUpdateWithFallback(gcal, gcalId, storedCalId, eventBody, sendUpdates) {
  const calId = storedCalId || GCAL_ID();
  try {
    await gcal.events.update({ calendarId: calId, eventId: gcalId, requestBody: eventBody, sendUpdates });
    return { calendarId: calId, usedFallback: false };
  } catch (e) {
    if (isPermissionError(e)) {
      // Re-insert into primary if the stored calendar is inaccessible
      const r = await gcal.events.insert({ calendarId: 'primary', requestBody: eventBody, sendUpdates });
      return { id: r.data.id, calendarId: 'primary', usedFallback: true };
    }
    throw e;
  }
}

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
  const attendees = (ev.invitees || []).filter(Boolean).map(email => ({ email }));
  const attendeeFields = attendees.length ? { attendees, guestsCanSeeOtherGuests: true } : {};
  const locationField = ev.zoomLink ? { location: ev.zoomLink } : {};

  if (ev.time) {
    const tz = 'Asia/Dubai';
    const startDt = `${ev.date}T${ev.time}:00`;
    let endDt;
    if (ev.endTime) {
      endDt = `${ev.date}T${ev.endTime}:00`;
    } else {
      const [h, m] = ev.time.split(':').map(Number);
      const endH = String(h + 1).padStart(2, '0');
      endDt = `${ev.date}T${endH}:${String(m).padStart(2, '0')}:00`;
    }
    return {
      summary: ev.title,
      description: descParts.join('\n'),
      start: { dateTime: startDt, timeZone: tz },
      end:   { dateTime: endDt,   timeZone: tz },
      colorId,
      ...attendeeFields,
      ...locationField,
    };
  }
  // All-day event — attendees still supported by GCal
  const tomorrow = new Date(ev.date + 'T00:00:00');
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    summary: ev.title,
    description: descParts.join('\n'),
    start: { date: ev.date },
    end:   { date: tomorrow.toISOString().split('T')[0] },
    colorId,
    ...attendeeFields,
    ...locationField,
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

// ── ICS / iCalendar builder ───────────────────────────────────────────────────
function buildICS(event, toEmail, fromEmail) {
  const pad = n => String(n).padStart(2, '0');
  const fmtLocalDt = (date, time) => {
    const [y, mo, d] = date.split('-');
    const [h, m] = (time || '00:00').split(':');
    return `${y}${mo}${d}T${pad(+h)}${pad(+m)}00`;
  };
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

  let startLine, endLine;
  if (event.time) {
    startLine = `DTSTART;TZID=Asia/Dubai:${fmtLocalDt(event.date, event.time)}`;
    const endTime = event.endTime || (() => {
      const [h, m] = event.time.split(':').map(Number);
      return `${pad(h + 1)}:${pad(m)}`;
    })();
    endLine = `DTEND;TZID=Asia/Dubai:${fmtLocalDt(event.date, endTime)}`;
  } else {
    startLine = `DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`;
    const tom = new Date(event.date + 'T00:00:00');
    tom.setDate(tom.getDate() + 1);
    endLine = `DTEND;VALUE=DATE:${tom.toISOString().split('T')[0].replace(/-/g, '')}`;
  }

  const esc = s => (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const organizer = fromEmail
    ? `ORGANIZER;CN=CFO Genie:mailto:${fromEmail}`
    : 'ORGANIZER:mailto:noreply@cfogenie.app';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CFO Genie//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${event.id}@cfogenie`,
    `DTSTAMP:${stamp}`,
    startLine,
    endLine,
    `SUMMARY:${esc(event.title)}`,
    event.note   ? `DESCRIPTION:${esc(event.note)}`    : '',
    event.zoomLink ? `LOCATION:${esc(event.zoomLink)}` : '',
    organizer,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${toEmail}:mailto:${toEmail}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  // RFC 5545: fold lines longer than 75 octets
  return lines.map(line => {
    if (Buffer.byteLength(line, 'utf8') <= 75) return line;
    const chunks = [];
    while (Buffer.byteLength(line, 'utf8') > 75) {
      let cut = 75;
      while (Buffer.byteLength(line.slice(0, cut), 'utf8') > 75) cut--;
      chunks.push(line.slice(0, cut));
      line = ' ' + line.slice(cut);
    }
    chunks.push(line);
    return chunks.join('\r\n');
  }).join('\r\n');
}

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
  const fromEmail = mailer.fromAddress ? mailer.fromAddress() : null;
  let sent = 0;
  for (const email of invitees) {
    try {
      const icsContent = buildICS(event, email, fromEmail);
      await mailer.sendMail({
        to: email,
        subject: `📅 Meeting Invitation: ${event.title} — ${event.date}`,
        html: buildInviteEmail(event, email),
        attachments: [{
          filename: 'invite.ics',
          content: icsContent,
          contentType: 'text/calendar; method=REQUEST',
        }],
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
  let gcalHandledInvites = false;
  let gcalWarning = null;
  const gcal = getCalendar();
  if (gcal) {
    try {
      const hasInvitees = (event.invitees || []).length > 0;
      const sendUpdates = hasInvitees ? 'all' : 'none';
      const ins = await gcalInsertWithFallback(gcal, toGCalEvent(event), sendUpdates);
      event.gcalId = ins.id;
      event.gcalCalendarId = ins.calendarId;
      if (ins.usedFallback) gcalWarning = 'Saved to your primary Google Calendar (configured calendar ID has no write access).';
      if (hasInvitees) { invitesSent = event.invitees.length; gcalHandledInvites = true; }
    } catch (e) {
      console.warn('GCal insert failed:', e.message);
    }
  }

  // Send direct email invites when GCal isn't connected or didn't handle them
  if (!gcalHandledInvites && event.invitees.length) {
    const fb = await sendFallbackInvites(event);
    invitesSent = fb.sent;
  }

  events.push(event);
  set(events);
  res.json({ event, invitesSent, gcalWarning });
});

router.put('/:id', async (req, res) => {
  const events = get();
  const i = events.findIndex(e => e.id === Number(req.params.id));
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const prev = events[i];
  events[i] = { ...prev, ...req.body, id: prev.id };

  let invitesSent = 0;
  let gcalHandledInvites = false;
  let gcalWarning = null;
  const gcal = getCalendar();
  if (gcal) {
    try {
      const hasInvitees = (events[i].invitees || []).length > 0;
      const sendUpdates = hasInvitees ? 'all' : 'none';
      if (events[i].gcalId) {
        const upd = await gcalUpdateWithFallback(gcal, events[i].gcalId, events[i].gcalCalendarId, toGCalEvent(events[i]), sendUpdates);
        if (upd.id) events[i].gcalId = upd.id;
        events[i].gcalCalendarId = upd.calendarId;
        if (upd.usedFallback) gcalWarning = 'Saved to your primary Google Calendar (configured calendar ID has no write access).';
      } else {
        const ins = await gcalInsertWithFallback(gcal, toGCalEvent(events[i]), sendUpdates);
        events[i].gcalId = ins.id;
        events[i].gcalCalendarId = ins.calendarId;
        if (ins.usedFallback) gcalWarning = 'Saved to your primary Google Calendar (configured calendar ID has no write access).';
      }
      if (hasInvitees) { invitesSent = events[i].invitees.length; gcalHandledInvites = true; }
    } catch (e) {
      console.warn('GCal update failed:', e.message);
    }
  }

  // Fallback: email newly added invitees directly when GCal didn't handle it
  if (!gcalHandledInvites && (events[i].invitees || []).length) {
    const prevInvitees = new Set(prev.invitees || []);
    const newInvitees = (events[i].invitees || []).filter(e => !prevInvitees.has(e));
    if (newInvitees.length) {
      const fb = await sendFallbackInvites({ ...events[i], invitees: newInvitees });
      invitesSent = fb.sent;
    }
  }

  set(events);
  res.json({ event: events[i], invitesSent, gcalWarning });
});

router.delete('/:id', async (req, res) => {
  const events = get();
  const ev = events.find(e => e.id === Number(req.params.id));

  const gcal = getCalendar();
  if (gcal && ev?.gcalId) {
    try {
      await gcal.events.delete({ calendarId: ev.gcalCalendarId || GCAL_ID(), eventId: ev.gcalId });
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
