const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'store');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function load(filename, defaultValue) {
  const filepath = path.join(DATA_DIR, filename);
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch (e) {
    console.warn(`Could not load ${filename}, using default:`, e.message);
  }
  save(filename, defaultValue);
  return defaultValue;
}

function save(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

module.exports = { load, save };
