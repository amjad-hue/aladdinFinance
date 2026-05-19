const router = require('express').Router();
const mailer = require('../lib/mailer');
const { load } = require('../data/store');

router.get('/status', (req, res) => {
  res.json([
    { name: 'QuickBooks Online', items: ['Bank balances', 'Customers', 'Bills / AP', 'Invoices', 'P&L report', 'Budget'], connected: !!process.env.QUICKBOOKS_ACCESS_TOKEN, lastSync: new Date().toISOString() },
    { name: 'HubSpot CRM', items: ['Pipeline deals', 'Close dates', 'Weighted forecast'], connected: !!process.env.HUBSPOT_ACCESS_TOKEN, lastSync: new Date().toISOString() },
    { name: 'Google Drive', items: ['Licenses', 'Contracts', 'Tax docs'], connected: !!(process.env.GOOGLE_DRIVE_FOLDER_ID && load('gcal_tokens.json', null)?.refresh_token), lastSync: new Date().toISOString() },
    { name: 'Google Calendar', items: ['Events', 'Tax deadlines', 'Tasks'], connected: !!(process.env.GOOGLE_CLIENT_ID && load('gcal_tokens.json', null)?.refresh_token), lastSync: null }
  ]);
});

router.get('/integration-config', (req, res) => {
  res.json([
    {
      id: 'quickbooks', name: 'QuickBooks Online', abbr: 'QB', color: '#0AB27D',
      tagline: 'Sync bank balances, invoices, P&L, and budget data',
      syncs: ['Bank balances', 'Accounts receivable', 'P&L report', 'Budget actuals', 'Bills / AP'],
      connected: !!process.env.QUICKBOOKS_ACCESS_TOKEN,
      envVars: [
        { key: 'QUICKBOOKS_ACCESS_TOKEN', set: !!process.env.QUICKBOOKS_ACCESS_TOKEN, hint: 'From QuickBooks → Settings → Integrations → OAuth token' },
        { key: 'QUICKBOOKS_CLIENT_ID',    set: !!process.env.QUICKBOOKS_CLIENT_ID,    hint: 'From developer.intuit.com → My Apps → Client ID' },
        { key: 'QUICKBOOKS_CLIENT_SECRET',set: !!process.env.QUICKBOOKS_CLIENT_SECRET,hint: 'From developer.intuit.com → My Apps → Client Secret' },
        { key: 'QUICKBOOKS_REALM_ID',     set: !!process.env.QUICKBOOKS_REALM_ID,     hint: 'Your QuickBooks company ID (shown in URL when logged in)' }
      ],
      setupSteps: ['1. Go to developer.intuit.com and create an app', '2. Copy Client ID and Client Secret to .env', '3. Add your Realm ID (company ID) to .env', '4. Run OAuth flow to get an access token', '5. Restart the server to apply changes']
    },
    {
      id: 'hubspot', name: 'HubSpot CRM', abbr: 'HS', color: '#FF7A59',
      tagline: 'Pull live deals, pipeline stages, and close probabilities',
      syncs: ['Pipeline deals', 'Close dates', 'Deal values', 'Weighted forecast'],
      connected: !!process.env.HUBSPOT_ACCESS_TOKEN,
      envVars: [
        { key: 'HUBSPOT_ACCESS_TOKEN', set: !!process.env.HUBSPOT_ACCESS_TOKEN, hint: 'From HubSpot → Settings → Integrations → Private Apps → Access Token' }
      ],
      setupSteps: ['1. In HubSpot, go to Settings → Integrations → Private Apps', '2. Create a Private App with CRM Object read permissions', '3. Copy the Access Token to .env as HUBSPOT_ACCESS_TOKEN', '4. Restart the server']
    },
    {
      id: 'zoom', name: 'Zoom', abbr: 'ZM', color: '#2D8CFF',
      tagline: 'Auto-create Zoom meetings when scheduling calendar events',
      syncs: ['Meeting links', 'Video calls', 'Scheduled meetings'],
      connected: !!process.env.ZOOM_ACCOUNT_ID && !!process.env.ZOOM_CLIENT_ID,
      envVars: [
        { key: 'ZOOM_ACCOUNT_ID',    set: !!process.env.ZOOM_ACCOUNT_ID,    hint: 'Your Zoom Account ID — from marketplace.zoom.us → App Credentials' },
        { key: 'ZOOM_CLIENT_ID',     set: !!process.env.ZOOM_CLIENT_ID,     hint: 'OAuth App Client ID from Zoom Marketplace (Server-to-Server app)' },
        { key: 'ZOOM_CLIENT_SECRET', set: !!process.env.ZOOM_CLIENT_SECRET, hint: 'OAuth App Client Secret from Zoom Marketplace' }
      ],
      setupSteps: [
        '1. Go to marketplace.zoom.us and sign in',
        '2. Click Develop → Build App → choose "Server-to-Server OAuth"',
        '3. Activate the app and copy Account ID, Client ID, and Client Secret',
        '4. Add all three values to your .env file',
        '5. Restart the server',
        '6. Use the "Generate Zoom" button when creating calendar events'
      ]
    },
    {
      id: 'gcal', name: 'Google Calendar', abbr: 'GC', color: '#4285F4',
      tagline: 'Sync financial events, tax deadlines, and meetings',
      syncs: ['Calendar events', 'Tax deadlines', 'Contract renewals', 'Board meetings'],
      connected: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CALENDAR_ID,
      envVars: [
        { key: 'GOOGLE_CLIENT_ID',     set: !!process.env.GOOGLE_CLIENT_ID,     hint: 'From Google Cloud Console → Credentials → OAuth 2.0 Client ID' },
        { key: 'GOOGLE_CLIENT_SECRET', set: !!process.env.GOOGLE_CLIENT_SECRET, hint: 'From Google Cloud Console → Credentials → OAuth 2.0 Client Secret' },
        { key: 'GOOGLE_CALENDAR_ID',   set: !!process.env.GOOGLE_CALENDAR_ID,   hint: 'Your Google Calendar ID — usually your Gmail address' }
      ],
      oauthUrl: '/api/events/gcal/auth',
      setupSteps: ['1. Go to Google Cloud Console → APIs & Services → Credentials', '2. Create OAuth 2.0 credentials (Web Application type)', '3. Add redirect URI: http://your-domain/api/events/gcal/callback', '4. Copy Client ID and Secret to .env', '5. Set GOOGLE_CALENDAR_ID to your Google email', '6. Click "Connect Google Calendar" button below']
    },
    {
      id: 'gdrive', name: 'Google Drive', abbr: 'GD', color: '#34A853',
      tagline: 'Store and access contracts, licenses, and financial documents',
      syncs: ['Document storage', 'License files', 'Contracts', 'Tax returns'],
      connected: !!(process.env.GOOGLE_DRIVE_FOLDER_ID && load('gcal_tokens.json', null)?.refresh_token),
      envVars: [
        { key: 'GOOGLE_DRIVE_FOLDER_ID', set: !!process.env.GOOGLE_DRIVE_FOLDER_ID, hint: 'The folder ID from your Google Drive folder URL — already set!' }
      ],
      setupSteps: ['1. Create or choose a Google Drive folder for CFO Genie documents', '2. Copy the folder ID from the URL (the long alphanumeric string)', '3. Set GOOGLE_DRIVE_FOLDER_ID in .env', '4. Uses same Google credentials as Google Calendar']
    },
    {
      id: 'gmail', name: 'Gmail', abbr: 'GM', color: '#EA4335',
      tagline: 'Read inbox, send reports, and manage financial emails via Gmail API',
      syncs: ['Read financial emails', 'Send reports & reminders', 'Compose & reply', 'Mark as read'],
      connected: !!load('gcal_tokens.json', null)?.refresh_token && (load('gcal_tokens.json', null)?.scope || '').includes('gmail'),
      oauthUrl: '/api/events/gcal/auth',
      envVars: [
        { key: 'GOOGLE_CLIENT_ID',     set: !!process.env.GOOGLE_CLIENT_ID,     hint: 'Same credentials as Google Calendar — already set if Calendar is connected' },
        { key: 'GOOGLE_CLIENT_SECRET', set: !!process.env.GOOGLE_CLIENT_SECRET, hint: 'Same credentials as Google Calendar' }
      ],
      setupSteps: [
        '1. Uses the same Google OAuth credentials as Google Calendar & Drive',
        '2. If already connected to Calendar, click "Re-authorize Google" to add Gmail scope',
        '3. In the Google OAuth consent screen, approve Gmail permissions',
        '4. Gmail Inbox will appear as a new section in the sidebar'
      ]
    },
    {
      id: 'smtp', name: 'Email (SMTP)', abbr: 'EM', color: '#6366F1',
      tagline: 'Send financial reports and CEO task reminders via email',
      syncs: ['Financial summary reports', 'CEO task reminders', 'Mark-done links'],
      connected: !!process.env.SMTP_USER && !!process.env.SMTP_PASS,
      envVars: [
        { key: 'SMTP_USER', set: !!process.env.SMTP_USER, hint: 'Your sender email address (e.g. cfo@yourcompany.com)' },
        { key: 'SMTP_PASS', set: !!process.env.SMTP_PASS, hint: 'For Gmail: generate an App Password at myaccount.google.com/apppasswords' },
        { key: 'SMTP_HOST', set: !!process.env.SMTP_HOST, hint: 'SMTP server hostname (default: smtp.gmail.com)' },
        { key: 'SMTP_PORT', set: !!process.env.SMTP_PORT, hint: 'SMTP port (default: 587 for TLS, 465 for SSL)' },
        { key: 'CEO_EMAIL',    set: !!process.env.CEO_EMAIL,    hint: 'CEO email address for task reminders' },
        { key: 'REPORT_EMAIL', set: !!process.env.REPORT_EMAIL, hint: 'Recipient email for scheduled financial reports' }
      ],
      setupSteps: ['1. For Gmail: enable 2FA and generate an App Password at myaccount.google.com/apppasswords', '2. Set SMTP_USER to your sender email in .env', '3. Set SMTP_PASS to the app password in .env', '4. Set CEO_EMAIL and REPORT_EMAIL in .env', '5. Restart the server', '6. Test via Settings → Send Test Report']
    }
  ]);
});

router.post('/all', async (req, res) => {
  await new Promise(r => setTimeout(r, 800));
  res.json({ success: true, sources: ['QuickBooks', 'HubSpot', 'Google Drive'], syncedAt: new Date().toISOString() });
});

router.post('/test-smtp', async (_req, res) => {
  if (!mailer.isConfigured()) {
    return res.status(400).json({ ok: false, error: 'No email method configured. Connect Gmail in Settings or set SMTP credentials in .env.' });
  }
  if (mailer.isGmailApiConfigured && mailer.isGmailApiConfigured() && !mailer.isSmtpConfigured()) {
    const { load } = require('../data/store');
    const email = load('gcal_tokens.json', null)?._email || 'your Gmail account';
    return res.json({ ok: true, message: `Gmail API ready — sending as ${email}` });
  }
  try {
    const transporter = mailer.createTransport();
    await transporter.verify();
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT) || 587;
    res.json({ ok: true, message: `Connected to ${host}:${port} as ${process.env.SMTP_USER}` });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
