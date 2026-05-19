const path   = require('path');
const fs     = require('fs');
const multer = require('multer');

const TMP_DIR = path.join(__dirname, '..', 'uploads', 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const excelUpload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.xlsx?$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are accepted'));
    }
  },
});

function removeTmp(filePath) {
  if (filePath) {
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
}

function tmpPath(filename) {
  return path.join(TMP_DIR, filename);
}

module.exports = { excelUpload, TMP_DIR, removeTmp, tmpPath };
