'use strict';
// Firebase Functions entry point — not used in local development.
// Local dev: run `node server.js` directly.

const functions = require('firebase-functions/v1');
const { init: initStore } = require('./data/store');

// Express app (no app.listen in production — Firebase handles the port)
const app = require('./server');

// ── HTTP Function — handles all routes (API + SPA) ───────────────────────────
exports.api = functions
  .runWith({ memory: '512MB', timeoutSeconds: 300 })
  .https.onRequest(app);

// ── Hourly Cloud Scheduler — all scheduled jobs ───────────────────────────────
exports.schedulerHourly = functions.pubsub
  .schedule('every 60 minutes')
  .onRun(async () => {
    await initStore();
    const { runHourly } = require('./lib/scheduler');
    await runHourly();
    return null;
  });
