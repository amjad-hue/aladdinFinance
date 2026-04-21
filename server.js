const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/cash', require('./routes/cash'));
app.use('/api/reserves', require('./routes/reserves'));
app.use('/api/cashflow', require('./routes/cashflow'));
app.use('/api/budget', require('./routes/budget'));
app.use('/api/revenue', require('./routes/revenue'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/events', require('./routes/events'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/files', require('./routes/files'));
app.use('/api/sync', require('./routes/sync'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log('');
  console.log('===================================================');
  console.log('  Aladdin Finance — CFO Command Center');
  console.log('===================================================');
  console.log(`  Server running at: http://localhost:${PORT}`);
  console.log(`  API health check:  http://localhost:${PORT}/api/health`);
  console.log('===================================================');
  console.log('');
});
