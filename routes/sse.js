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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function send(key) {
    try { res.write(`data: ${JSON.stringify({ key })}\n\n`); } catch (_) {}
  }

  // Heartbeat keeps connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(':\n\n'); } catch (_) {}
  }, 25_000);

  let cleanup = () => {};

  if (USE_FIRESTORE) {
    // Production: Firestore real-time listener per client
    try {
      const db = _getDb();
      const unsub = db.collection('store').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'modified') send(change.doc.id);
        });
      }, err => console.error('[SSE] Firestore error:', err.message));
      cleanup = unsub;
    } catch (e) {
      console.error('[SSE] Firestore setup error:', e.message);
    }
  } else {
    // Local dev: watch store directory for file changes
    try {
      const watcher = fs.watch(STORE_DIR, (event, filename) => {
        if (filename && filename.endsWith('.json')) send(filename);
      });
      cleanup = () => watcher.close();
    } catch (e) {
      console.error('[SSE] fs.watch error:', e.message);
    }
  }

  req.on('close', () => {
    clearInterval(heartbeat);
    cleanup();
  });
};
