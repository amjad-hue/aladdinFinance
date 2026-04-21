module.exports = {
  banks: [
    { name: 'ENBD', total: 285000 },
    { name: 'Mashreq', total: 172000 },
    { name: 'Wio', total: 98000 },
    { name: 'Stripe', total: 64000 }
  ],
  reserves: [
    { id: 1, bank: 'ENBD', name: 'VAT provision', amount: 42000 },
    { id: 2, bank: 'ENBD', name: 'Payroll reserve', amount: 20000 },
    { id: 3, bank: 'Mashreq', name: 'Operating buffer', amount: 13000 }
  ],
  cashflow: [
    { month: 'Jul 2026', opening: 619000, inflow: 182000, outflow: 126000 },
    { month: 'Aug 2026', opening: 0, inflow: 196000, outflow: 138000 },
    { month: 'Sep 2026', opening: 0, inflow: 188000, outflow: 142000 },
    { month: 'Oct 2026', opening: 0, inflow: 204000, outflow: 151000 },
    { month: 'Nov 2026', opening: 0, inflow: 211000, outflow: 158000 },
    { month: 'Dec 2026', opening: 0, inflow: 225000, outflow: 166000 }
  ],
  budget: [
    { cat: 'Payroll', annual: 696000, actualMo: 54000, actualYTD: 318000, note: '' },
    { cat: 'Contractors', annual: 240000, actualMo: 18000, actualYTD: 112000, note: '' },
    { cat: 'Software', annual: 120000, actualMo: 9600, actualYTD: 56200, note: '' },
    { cat: 'Cloud', annual: 144000, actualMo: 13200, actualYTD: 79200, note: 'Over budget — review AWS' },
    { cat: 'Marketing', annual: 300000, actualMo: 21500, actualYTD: 119000, note: '' },
    { cat: 'Legal & admin', annual: 108000, actualMo: 7400, actualYTD: 48800, note: '' }
  ],
  revenue: [
    { month: 'Jan', revenue: 108000, target: 120000, expenses: 76000 },
    { month: 'Feb', revenue: 126000, target: 120000, expenses: 81000 },
    { month: 'Mar', revenue: 142000, target: 130000, expenses: 86000 },
    { month: 'Apr', revenue: 151000, target: 140000, expenses: 92000 },
    { month: 'May', revenue: 168000, target: 145000, expenses: 97000 },
    { month: 'Jun', revenue: 174000, target: 150000, expenses: 101000 }
  ],
  clients: [
    { id: 1, qbId: 'QBO-001', name: 'Informa Markets', type: 'Enterprise', country: 'UAE', revenue: 196000, saas: 74000, services: 122000, renewal: '2026-12-31', notes: 'Key anchor client. Renewal discussion Q3.', trend: [28000,30000,33000,35000,34000,36000], fromQBO: true },
    { id: 2, qbId: 'QBO-002', name: 'UK Government', type: 'Government', country: 'UK', revenue: 144000, saas: 96000, services: 48000, renewal: '2027-03-31', notes: 'Framework contract. SaaS heavy.', trend: [22000,24000,24000,25000,25000,24000], fromQBO: true },
    { id: 3, qbId: 'QBO-003', name: 'KOTRA', type: 'Enterprise', country: 'South Korea', revenue: 98000, saas: 28000, services: 70000, renewal: '2026-09-30', notes: 'Services-heavy. Explore upsell.', trend: [14000,16000,17000,17000,17000,17000], fromQBO: true },
    { id: 4, qbId: 'QBO-004', name: 'TechVision Corp', type: 'SMB', country: 'UAE', revenue: 52000, saas: 42000, services: 10000, renewal: '2026-11-30', notes: 'Fast growing — potential upgrade.', trend: [7000,8000,8000,9000,10000,10000], fromQBO: true },
    { id: 5, qbId: 'QBO-005', name: 'Global Expo Group', type: 'Enterprise', country: 'UAE', revenue: 88000, saas: 22000, services: 66000, renewal: '2026-08-31', notes: 'Contract renewal soon.', trend: [13000,14000,15000,15000,16000,15000], fromQBO: true }
  ],
  events: [
    { id: 1, type: 'tax', title: 'VAT Q1 2026 filing', date: '2026-04-28', note: '$42,000 due', amount: 42000, recur: 'quarterly' },
    { id: 2, type: 'deadline', title: 'Q1 book close', date: '2026-04-30', note: 'QuickBooks reconciliation', recur: 'quarterly' },
    { id: 3, type: 'meeting', title: 'Q1 audit review', date: '2026-05-06', note: 'Auditor office 10am', recur: 'none' },
    { id: 4, type: 'tax', title: 'Corporate tax advance', date: '2026-05-15', note: '$28,000', amount: 28000, recur: 'quarterly' },
    { id: 5, type: 'planning', title: 'H2 planning session', date: '2026-05-20', note: 'Budget review', recur: 'annual' }
  ],
  tasks: [
    { id: 1, title: 'Weekly bank balance check', due: 'Every Sunday', done: false },
    { id: 2, title: 'Confirm payroll — end of month', due: 'Apr 30', done: false },
    { id: 3, title: 'Follow up overdue invoices', due: 'Apr 22', done: false },
    { id: 4, title: 'Review cash flow report', due: 'Apr 24', done: true }
  ],
  files: [
    { id: 1, name: 'Trade License 2026.pdf', type: 'license', cat: 'p', size: '1.2 MB', date: 'Jan 15, 2026', drive: true },
    { id: 2, name: 'Informa Markets Contract.pdf', type: 'contract', cat: 'p', size: '3.4 MB', date: 'Feb 3, 2026', drive: true },
    { id: 3, name: 'VAT Return Q4 2025.xlsx', type: 'tax', cat: 'x', size: '0.8 MB', date: 'Jan 28, 2026', drive: true },
    { id: 4, name: 'Audit Report FY2025.pdf', type: 'report', cat: 'p', size: '2.1 MB', date: 'Mar 12, 2026', drive: true },
    { id: 5, name: 'UK Government SLA.pdf', type: 'contract', cat: 'p', size: '1.8 MB', date: 'Mar 1, 2026', drive: true }
  ]
};
