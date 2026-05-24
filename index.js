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

// ── HTTP Function — all API routes + SPA ─────────────────────────────────────
exports.api = onRequest(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  app
);

// ── Hourly Cloud Scheduler ────────────────────────────────────────────────────
exports.schedulerHourly = onSchedule(
  { schedule: 'every 60 minutes', region: 'us-central1', memory: '256MiB', timeoutSeconds: 540 },
  async () => {
    await initStore();
    const { runHourly } = require('./lib/scheduler');
    await runHourly();
  }
);
