/**
 * One-time migration: imports all store/*.json files into Firestore.
 * Run ONCE before the first Firebase deploy:
 *
 *   node data/migrate.js
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing to a Firebase
 * service account JSON key, or run from a machine already authenticated
 * with `firebase login` and application-default credentials.
 */
'use strict';
require('dotenv').config();
const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

if (!admin.apps.length) admin.initializeApp();
const db    = admin.firestore();
const STORE = path.join(__dirname, '..', 'store');

async function main() {
  const files = fs.readdirSync(STORE).filter(f => f.endsWith('.json'));
  console.log(`Migrating ${files.length} store files to Firestore…\n`);

  for (const file of files) {
    const key = file.replace(/\.json$/, '');
    try {
      const raw  = fs.readFileSync(path.join(STORE, file), 'utf-8');
      const data = JSON.parse(raw);
      await db.collection('store').doc(key).set({ data });
      console.log(`  ✓  ${key}`);
    } catch (e) {
      console.error(`  ✗  ${key}: ${e.message}`);
    }
  }

  console.log('\nMigration complete. Firestore is ready.');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
