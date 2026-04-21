const express = require('express');
const router = express.Router();

router.get('/status', (req, res) => {
  res.json([
    { name: 'QuickBooks Online', items: ['Bank balances', 'Customers', 'Bills / AP', 'Invoices', 'P&L report', 'Budget'], connected: !!process.env.QUICKBOOKS_ACCESS_TOKEN, lastSync: new Date().toISOString() },
    { name: 'HubSpot CRM', items: ['Pipeline deals', 'Close dates', 'Weighted forecast'], connected: !!process.env.HUBSPOT_ACCESS_TOKEN, lastSync: new Date().toISOString() },
    { name: 'Google Drive', items: ['Licenses', 'Contracts', 'Tax docs'], connected: !!process.env.GOOGLE_CLIENT_ID, lastSync: new Date().toISOString() },
    { name: 'Google Calendar', items: ['Events', 'Tax deadlines', 'Tasks'], connected: !!process.env.GOOGLE_CLIENT_ID, lastSync: null }
  ]);
});

router.post('/all', async (req, res) => {
  await new Promise(r => setTimeout(r, 800));
  res.json({ success: true, sources: ['QuickBooks', 'HubSpot', 'Google Drive'], syncedAt: new Date().toISOString() });
});

module.exports = router;
