'use strict';
// Firebase Functions entry point — not used in local development.
// Local dev: run `node server.js` directly.

const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const { onRequest }  = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { init: initStore } = require('./data/store');

// Express app (no app.listen in production — Firebase handles the port)
const app = require('./server');

const ALL_SECRETS = [
  'JWT_SECRET', 'APP_URL',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
  'GOOGLE_CALENDAR_ID', 'GOOGLE_DRIVE_FOLDER_ID', 'GOOGLE_DRIVE_EXPENSES_FOLDER_ID',
  'ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET',
  'ALLOWED_ORIGINS',
];

// ── HTTP Function — all API routes + SPA ─────────────────────────────────────
exports.api = onRequest(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540, secrets: ALL_SECRETS },
  app
);

// ── Hourly Cloud Scheduler ────────────────────────────────────────────────────
exports.schedulerHourly = onSchedule(
  { schedule: 'every 60 minutes', region: 'us-central1', memory: '256MiB', timeoutSeconds: 540, secrets: ALL_SECRETS },
  async () => {
    await initStore();
    const { runHourly } = require('./lib/scheduler');
    await runHourly();
  }
);
