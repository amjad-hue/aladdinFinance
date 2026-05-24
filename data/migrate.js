/**
 * One-time migration: imports all store/*.json files into Firestore.
 *
 * Usage:
 *   1. Download service account key from Firebase Console:
 *      Project Settings → Service Accounts → Generate new private key
 *      Save as serviceAccountKey.json in the project root.
 *
 *   2. Run:
 *      node data/migrate.js
 *
 * The script reads serviceAccountKey.json from the project root automatically.
 */
'use strict';
require('dotenv').config();
const path  = require('path');
const fs    = require('fs');
const admin = require('firebase-admin');

// Load service account key from project root
const KEY_PATH = path.join(__dirname, '..', 'serviceAccountKey.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error('\n✗  serviceAccountKey.json not found in project root.');
  console.error('   Download it from: Firebase Console → Project Settings → Service Accounts\n');
  process.exit(1);
}

const serviceAccount = require(KEY_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db    = admin.firestore();
const STORE = path.join(__dirname, '..', 'store');

async function main() {
  const files = fs.readdirSync(STORE).filter(f => f.endsWith('.json'));
  console.log(`\nMigrating ${files.length} store files → Firestore (project: ${serviceAccount.project_id})\n`);

  let ok = 0, fail = 0;
  for (const file of files) {
    const key = file.replace(/\.json$/, '');
    try {
      const data = JSON.parse(fs.readFileSync(path.join(STORE, file), 'utf-8'));
      await db.collection('store').doc(key).set({ data });
      console.log(`  ✓  ${key}`);
      ok++;
    } catch (e) {
      console.error(`  ✗  ${key}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\n${ok} migrated, ${fail} failed.`);
  if (fail === 0) console.log('Firestore is ready — run `firebase deploy` next.\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
