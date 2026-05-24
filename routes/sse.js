'use strict';
const fs   = require('fs');
const path = require('path');
const jwt  = require('jsonwebtoken');
const { JWT_SECRET }    = require('../config');
const { USE_FIRESTORE, _getDb } = require('../data/store');

const STORE_DIR = path.join(__dirname, '..', 'store');

module.exports = function sseHandler(req, res) {
  // EventSource can't send headers — auth via query param
  const token = req.query.token;
  if (!token) return res.status(401).end();
  try { jwt.verify(token, JWT_SECRET); }
  catch (_) { return res.status(401).end(); }

  // Headers that prevent CDN/proxy buffering (Firebase Hosting, nginx, etc.)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  function send(key) {
    try {
      res.write(`data: ${JSON.stringify({ key })}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    } catch (_) {}
  }

  // Immediate ping so client knows connection is live
  send('__connected__');

  // Heartbeat keeps connection alive through proxies (every 20s)
  const heartbeat = setInterval(() => {
    try {
      res.write(':\n\n');
      if (typeof res.flush === 'function') res.flush();
    } catch (_) {}
  }, 20_000);

  let cleanup = () => {};

  if (USE_FIRESTORE) {
    // Production: per-client Firestore real-time listener
    try {
      const db = _getDb();
      const unsub = db.collection('store').onSnapshot(
        { includeMetadataChanges: false },
        snapshot => {
          snapshot.docChanges().forEach(change => {
            if (change.type === 'modified') {
              send(change.doc.id);
            }
          });
        },
        err => console.error('[SSE] Firestore listener error:', err.message)
      );
      cleanup = unsub;
    } catch (e) {
      console.error('[SSE] Firestore setup failed:', e.message);
    }
  } else {
    // Local dev: watch individual store files with fs.watchFile
    // (more reliable than fs.watch on Windows)
    const watched = [];
    try {
      const files = fs.readdirSync(STORE_DIR).filter(f => f.endsWith('.json'));
      files.forEach(filename => {
        const filepath = path.join(STORE_DIR, filename);
        const handler = (curr, prev) => {
          if (curr.mtimeMs !== prev.mtimeMs) send(filename);
        };
        fs.watchFile(filepath, { interval: 400, persistent: false }, handler);
        watched.push({ filepath, handler });
      });
    } catch (e) {
      console.error('[SSE] fs.watchFile setup failed:', e.message);
    }
    cleanup = () => {
      watched.forEach(({ filepath, handler }) => fs.unwatchFile(filepath, handler));
    };
  }

  req.on('close', () => {
    clearInterval(heartbeat);
    cleanup();
  });
};
