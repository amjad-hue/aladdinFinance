const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { load, save } = require('../data/store');
const seed = require('../data/seed');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/', (req, res) => {
  res.json(load('files.json', seed.files));
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const files = load('files.json', seed.files);
  const ext = req.file.originalname.split('.').pop().toLowerCase();
  const cat = ext === 'pdf' ? 'p' : ['xlsx', 'xls'].includes(ext) ? 'x' : 'd';
  const file = {
    id: Date.now(),
    name: req.file.originalname,
    type: req.body.type || 'report',
    cat,
    size: (req.file.size / 1024).toFixed(1) + ' KB',
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    drive: false,
    storedAs: req.file.filename
  };
  files.unshift(file);
  save('files.json', files);
  res.json({ success: true, file });
});

router.get('/:id/download', (req, res) => {
  const id = Number(req.params.id);
  const files = load('files.json', seed.files);
  const file = files.find(f => f.id === id);
  if (!file || !file.storedAs) return res.status(404).json({ error: 'File not found' });
  res.download(path.join(UPLOAD_DIR, file.storedAs), file.name);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  let files = load('files.json', seed.files);
  const file = files.find(f => f.id === id);
  if (file && file.storedAs) {
    const fpath = path.join(UPLOAD_DIR, file.storedAs);
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
  }
  files = files.filter(f => f.id !== id);
  save('files.json', files);
  res.json({ success: true });
});

module.exports = router;
