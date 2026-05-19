const { MONTHS: MO } = require('../lib/constants');

function buildMonths(annual, actuals) {
  const tgt = Math.round(annual / 12);
  const obj = {};
  MO.forEach((m, i) => { obj[m] = { target: tgt, actual: actuals[i] || 0, details: [] }; });
  return obj;
}

function seed() {
  return {
    banks: [
      { id: 1, name: 'ENBD',          total: 285000, account: '****4821', currency: 'AED', type: 'Current'  },
      { id: 2, name: 'Mashreq',        total: 172000, account: '****3302', currency: 'AED', type: 'Current'  },
      { id: 3, name: 'Wio',            total: 98000,  account: '****7741', currency: 'USD', type: 'Business' },
      { id: 4, name: 'Stripe Balance', total: 64000,  account: 'Stripe',   currency: 'USD', type: 'Payment'  }
    ],

    reserves: [
      { id: 1, bank: 'ENBD',    name: 'VAT provision Q2', amount: 42000 },
      { id: 2, bank: 'ENBD',    name: 'Payroll buffer',    amount: 58000 },
      { id: 3, bank: 'Mashreq', name: 'Operating buffer',  amount: 30000 }
    ],

    cashflow: [
      { id: 1,  month: 'Jan 2026', opening: 300000, inflow: 155000, outflow: 99000  },
      { id: 2,  month: 'Feb 2026', opening: 356000, inflow: 170000, outflow: 112000 },
      { id: 3,  month: 'Mar 2026', opening: 414000, inflow: 165000, outflow: 119000 },
      { id: 4,  month: 'Apr 2026', opening: 460000, inflow: 178000, outflow: 125000 },
      { id: 5,  month: 'May 2026', opening: 513000, inflow: 183000, outflow: 130000 },
      { id: 6,  month: 'Jun 2026', opening: 566000, inflow: 175000, outflow: 122000 },
      { id: 7,  month: 'Jul 2026', opening: 619000, inflow: 182000, outflow: 126000 },
      { id: 8,  month: 'Aug 2026', opening: 675000, inflow: 196000, outflow: 138000 },
      { id: 9,  month: 'Sep 2026', opening: 733000, inflow: 188000, outflow: 142000 },
      { id: 10, month: 'Oct 2026', opening: 779000, inflow: 204000, outflow: 151000 },
      { id: 11, month: 'Nov 2026', opening: 832000, inflow: 211000, outflow: 158000 },
      { id: 12, month: 'Dec 2026', opening: 885000, inflow: 198000, outflow: 139000 }
    ],

    budget: [
      { id: 1, cat: 'Payroll',       annual: 696000, note: '', months: buildMonths(696000, [54000,55000,56000,54000,57000,56000,0,0,0,0,0,0]) },
      { id: 2, cat: 'Contractors',   annual: 240000, note: '', months: buildMonths(240000, [18000,20000,19000,22000,18000,19000,0,0,0,0,0,0]) },
      { id: 3, cat: 'Software',      annual: 120000, note: '', months: buildMonths(120000, [9600,9800,10200,9500,10400,9700,0,0,0,0,0,0])   },
      { id: 4, cat: 'Cloud',         annual: 144000, note: 'Review AWS costs', months: buildMonths(144000, [13200,12800,12400,13600,12200,13800,0,0,0,0,0,0]) },
      { id: 5, cat: 'Marketing',     annual: 96000,  note: '', months: buildMonths(96000,  [7200,8400,9200,7800,8600,8200,0,0,0,0,0,0])    },
      { id: 6, cat: 'Legal & Admin', annual: 72000,  note: '', months: buildMonths(72000,  [5400,6200,5800,6400,5600,7200,0,0,0,0,0,0])    }
    ],

    revenueByType: [
      { type: 'Enterprise Accounts', color: '#FF681A', monthly: [72000,84000,94000,104000,112000,110000,0,0,0,0,0,0] },
      { type: 'Government / Public Sector', color: '#2563EB', monthly: [22000,26000,30000,34000,35000,34000,0,0,0,0,0,0] },
      { type: 'Events & Tradeshows', color: '#16A34A', monthly: [8000,9000,11000,13000,14000,14000,0,0,0,0,0,0] },
      { type: 'SMB & Direct', color: '#D97706', monthly: [6000,7000,7000,7000,8000,8000,0,0,0,0,0,0] }
    ],

    revenue: [
      { month: 'Jan', revenue: 108000, target: 120000, expenses: 76000 },
      { month: 'Feb', revenue: 126000, target: 120000, expenses: 81000 },
      { month: 'Mar', revenue: 142000, target: 130000, expenses: 86000 },
      { month: 'Apr', revenue: 158000, target: 140000, expenses: 89000 },
      { month: 'May', revenue: 169000, target: 150000, expenses: 93000 },
      { month: 'Jun', revenue: 166000, target: 160000, expenses: 95000 },
      { month: 'Jul', revenue: 0,      target: 170000, expenses: 0     },
      { month: 'Aug', revenue: 0,      target: 175000, expenses: 0     },
      { month: 'Sep', revenue: 0,      target: 180000, expenses: 0     },
      { month: 'Oct', revenue: 0,      target: 185000, expenses: 0     },
      { month: 'Nov', revenue: 0,      target: 190000, expenses: 0     },
      { month: 'Dec', revenue: 0,      target: 200000, expenses: 0     }
    ],

    clients: [
      { id: 1, name: 'Informa Markets',   type: 'Enterprise', country: 'UAE',         revenue: 196000, saas: 74000,  services: 122000, renewal: '2026-11-01', notes: 'Key account. Renewal negotiation due Q4.',    fromQBO: true, qbId: 'QBO-1001', trend: [155000,162000,168000,180000,188000,196000] },
      { id: 2, name: 'Al Futtaim Group',  type: 'Enterprise', country: 'UAE',         revenue: 284000, saas: 142000, services: 142000, renewal: '2027-01-15', notes: 'Expanding SaaS usage. Upsell opportunity.',   fromQBO: true, qbId: 'QBO-1002', trend: [240000,250000,260000,268000,276000,284000] },
      { id: 3, name: 'DEWA',              type: 'Government', country: 'UAE',         revenue: 168000, saas: 0,      services: 168000, renewal: '2026-08-30', notes: 'Government contract. Strict compliance.',      fromQBO: true, qbId: 'QBO-1003', trend: [140000,148000,152000,158000,162000,168000] },
      { id: 4, name: 'Majid Al Futtaim', type: 'Enterprise', country: 'KSA',         revenue: 142000, saas: 98000,  services: 44000,  renewal: '2026-12-01', notes: 'KSA expansion project underway.',             fromQBO: true, qbId: 'QBO-1004', trend: [110000,118000,124000,130000,136000,142000] },
      { id: 5, name: 'RTA Dubai',         type: 'Government', country: 'UAE',         revenue: 98000,  saas: 0,      services: 98000,  renewal: '2026-09-15', notes: 'Public transport authority. Annual contract.', fromQBO: true, qbId: 'QBO-1005', trend: [80000,84000,88000,90000,94000,98000]       }
    ],

    events: [
      { id: 1, type: 'tax',      title: 'VAT Q1 filing deadline',          date: '2026-04-28', note: 'Federal Tax Authority', amount: 42000,  recur: 'quarterly', gcalId: null },
      { id: 2, type: 'meeting',  title: 'Board financial review',           date: '2026-05-05', note: 'Quarterly board meeting', amount: null, recur: 'quarterly', gcalId: null },
      { id: 3, type: 'deadline', title: 'Al Futtaim contract renewal',      date: '2026-05-20', note: 'Send renewal package',  amount: null, recur: 'none',      gcalId: null },
      { id: 4, type: 'tax',      title: 'Corporate tax provisional payment', date: '2026-06-30', note: 'Ministry of Finance', amount: 85000, recur: 'annual',    gcalId: null },
      { id: 5, type: 'planning', title: 'H2 2026 budget planning session',  date: '2026-06-15', note: 'Finance + leadership', amount: null, recur: 'none',      gcalId: null }
    ],

    tasks: [
      { id: 1, title: 'Review Q2 cash position and runway', due: '30 Apr 2026', deadline: '2026-04-30', priority: 'high',   done: false },
      { id: 2, title: 'Send Al Futtaim renewal proposal',   due: '15 May 2026', deadline: '2026-05-15', priority: 'high',   done: false },
      { id: 3, title: 'Reconcile April bank statements',    due: '5 May 2026',  deadline: '2026-05-05', priority: 'medium', done: false },
      { id: 4, title: 'Update HubSpot pipeline deals',      due: '22 Apr 2026', deadline: '2026-04-22', priority: 'low',    done: true  }
    ],

    files: [
      { id: 1, name: 'Trade License 2026.pdf',            size: '1.2 MB', date: 'Jan 15, 2026', cat: 'p', type: 'license',  drive: true, storedAs: null },
      { id: 2, name: 'Al Futtaim MSA v3.pdf',             size: '890 KB', date: 'Mar 1, 2026',  cat: 'p', type: 'contract', drive: true, storedAs: null },
      { id: 3, name: 'Q1 2026 Financial Report.xlsx',     size: '340 KB', date: 'Apr 2, 2026',  cat: 'x', type: 'report',  drive: true, storedAs: null },
      { id: 4, name: 'VAT Return Q4 2025.pdf',            size: '560 KB', date: 'Jan 28, 2026', cat: 'p', type: 'tax',     drive: true, storedAs: null },
      { id: 5, name: 'Audit Engagement Letter 2026.docx', size: '210 KB', date: 'Feb 10, 2026', cat: 'd', type: 'contract', drive: true, storedAs: null }
    ],

    pipeline: [
      { id: 1, name: 'TechCorp Enterprise License',        client: 'TechCorp MENA',     type: 'Enterprise', value: 250000, probability: 75, stage: 'Proposal',     closeDate: '2026-07-30', owner: 'Sarah Al-Hassan',  notes: '', hubspotId: null },
      { id: 2, name: 'Ministry of Finance Digital Portal', client: 'UAE Government',     type: 'Government', value: 500000, probability: 60, stage: 'Negotiation',  closeDate: '2026-09-15', owner: 'Ahmed Al-Rashidi', notes: '', hubspotId: null },
      { id: 3, name: 'Gulf Tech Expo 2026 Showcase',       client: 'Various',            type: 'Tradeshow',  value: 80000,  probability: 40, stage: 'Qualification', closeDate: '2026-06-30', owner: 'Maya Khalil',      notes: '', hubspotId: null },
      { id: 4, name: 'AlShifa Healthcare SaaS',            client: 'AlShifa Group',      type: 'Enterprise', value: 180000, probability: 90, stage: 'Closed Won',   closeDate: '2026-04-01', owner: 'Sarah Al-Hassan',  notes: '', hubspotId: null },
      { id: 5, name: 'Dubai Municipality CRM Platform',    client: 'Dubai Municipality', type: 'Government', value: 320000, probability: 55, stage: 'Proposal',     closeDate: '2026-08-20', owner: 'Ahmed Al-Rashidi', notes: '', hubspotId: null },
      { id: 6, name: 'ADIPEC Conference Lead Generation',  client: 'Various',            type: 'Tradeshow',  value: 120000, probability: 35, stage: 'Prospecting',  closeDate: '2026-11-05', owner: 'Maya Khalil',      notes: '', hubspotId: null }
    ],

    liabilities: [
      { id: 1, name: 'Accounts Payable', breakdown: [
        { id: 101, name: 'AWS Cloud Services', dueDate: '2026-04-30', amount: 13200 },
        { id: 102, name: 'Salesforce License', dueDate: '2026-05-05', amount: 9800 },
        { id: 103, name: 'Office Lease — DIFC', dueDate: '2026-05-01', amount: 24000 }
      ]},
      { id: 2, name: 'Accrued Expenses', breakdown: [
        { id: 201, name: 'April Payroll accrual', dueDate: '2026-04-30', amount: 58000 },
        { id: 202, name: 'Contractor invoices pending', dueDate: '2026-05-15', amount: 19000 },
        { id: 203, name: 'Marketing agency retainer', dueDate: '2026-05-10', amount: 8200 }
      ]},
      { id: 3, name: 'Deferred Revenue', breakdown: [
        { id: 301, name: 'Al Futtaim — prepaid SaaS Q3', dueDate: '2026-06-30', amount: 48000 },
        { id: 302, name: 'DEWA services advance', dueDate: '2026-07-31', amount: 31000 },
        { id: 303, name: 'Informa prepaid support', dueDate: '2026-08-31', amount: 18000 }
      ]},
      { id: 4, name: 'VAT Payable', breakdown: [
        { id: 401, name: 'VAT Q1 2026 payable', dueDate: '2026-04-28', amount: 42000 }
      ]}
    ],

    accountReceivables: [
      { id: 1, client: 'Informa Markets',   invoice: 'INV-2026-041', dueDate: '2026-05-05', amount: 85000, status: 'pending' },
      { id: 2, client: 'Al Futtaim Group',  invoice: 'INV-2026-038', dueDate: '2026-04-25', amount: 72000, status: 'overdue' },
      { id: 3, client: 'DEWA',              invoice: 'INV-2026-039', dueDate: '2026-05-15', amount: 54000, status: 'pending' },
      { id: 4, client: 'Majid Al Futtaim',  invoice: 'INV-2026-040', dueDate: '2026-04-30', amount: 38000, status: 'pending' },
      { id: 5, client: 'RTA Dubai',         invoice: 'INV-2026-035', dueDate: '2026-04-20', amount: 28000, status: 'overdue' }
    ],

    commissions: [
      { id: 1, dealName: 'AlShifa Healthcare SaaS',            repName: 'Sarah Al-Hassan',  client: 'AlShifa Group',      dealValue: 180000, rate: 5, amount: 9000,  status: 'approved', date: '2026-04-01', notes: '' },
      { id: 2, dealName: 'TechCorp Enterprise License',         repName: 'Sarah Al-Hassan',  client: 'TechCorp MENA',      dealValue: 250000, rate: 5, amount: 12500, status: 'pending',  date: '2026-07-30', notes: 'Pending deal close' },
      { id: 3, dealName: 'Ministry of Finance Digital Portal',  repName: 'Ahmed Al-Rashidi', client: 'UAE Government',     dealValue: 500000, rate: 4, amount: 20000, status: 'pending',  date: '2026-09-15', notes: '' },
      { id: 4, dealName: 'Gulf Tech Expo 2026',                 repName: 'Maya Khalil',      client: 'Various',            dealValue: 80000,  rate: 3, amount: 2400,  status: 'pending',  date: '2026-06-30', notes: '' },
      { id: 5, dealName: 'Dubai Municipality CRM Platform',     repName: 'Ahmed Al-Rashidi', client: 'Dubai Municipality', dealValue: 320000, rate: 4, amount: 12800, status: 'pending',  date: '2026-08-20', notes: '' }
    ],

    projects: [
      { id: 1, name: 'Al Futtaim SaaS Implementation',  client: 'Al Futtaim Group',  status: 'active',    type: 'implementation', startDate: '2026-01-15', endDate: '2026-07-31', budget: 85000,  actualSpend: 42000, linkedRevenue: 142000, linkedBudgetCats: ['Contractors', 'Software'], manager: 'Sarah Al-Hassan',  description: 'Full SaaS platform rollout', milestones: [{id:101,title:'Requirements sign-off',dueDate:'2026-02-01',done:true},{id:102,title:'UAT complete',dueDate:'2026-05-15',done:false},{id:103,title:'Go-live',dueDate:'2026-07-01',done:false}], notes: '' },
      { id: 2, name: 'DEWA Services Integration',       client: 'DEWA',              status: 'active',    type: 'integration',    startDate: '2026-02-01', endDate: '2026-08-30', budget: 55000,  actualSpend: 28000, linkedRevenue: 168000, linkedBudgetCats: ['Contractors'], manager: 'Ahmed Al-Rashidi', description: 'API integration for government portal', milestones: [{id:201,title:'API design',dueDate:'2026-03-01',done:true},{id:202,title:'Testing',dueDate:'2026-06-01',done:false}], notes: '' },
      { id: 3, name: 'Ministry Finance Portal Phase 2', client: 'UAE Government',    status: 'proposal',  type: 'development',    startDate: '2026-06-01', endDate: '2026-12-31', budget: 200000, actualSpend: 0,     linkedRevenue: 0,      linkedBudgetCats: [], manager: 'Ahmed Al-Rashidi', description: 'Phase 2 of digital transformation', milestones: [], notes: 'Pending contract signature' },
      { id: 4, name: 'Q1 Gulf Tech Expo Activation',   client: 'Various',           status: 'completed', type: 'marketing',      startDate: '2026-01-01', endDate: '2026-03-31', budget: 35000,  actualSpend: 32400, linkedRevenue: 28000,  linkedBudgetCats: ['Marketing'], manager: 'Maya Khalil', description: 'Tradeshow activation and lead generation', milestones: [{id:401,title:'Booth setup',dueDate:'2026-03-15',done:true},{id:402,title:'Lead follow-up campaign',dueDate:'2026-04-15',done:true}], notes: '' }
    ],

    hrEmployees: [
      { id:1, firstName:'Sarah',  lastName:'Al-Hassan',  email:'sarah@aladdinb2b.com',   phone:'+971 50 111 2233', nationality:'UAE',     dob:'1990-03-15', gender:'Female', employeeId:'EMP-001', department:'Sales',       position:'Sales Manager',        type:'full-time',   status:'active',     startDate:'2022-01-10', managerId:null, salary:28000, currency:'AED', salaryFrequency:'monthly', leaveBalances:{annual:22,sick:15,emergency:3,unpaid:0}, onboarding:null, notes:'Key account manager.',    createdAt:'2022-01-10T00:00:00.000Z' },
      { id:2, firstName:'Ahmed',  lastName:'Al-Rashidi', email:'ahmed@aladdinb2b.com',   phone:'+971 55 222 3344', nationality:'UAE',     dob:'1988-07-22', gender:'Male',   employeeId:'EMP-002', department:'Sales',       position:'Sales Manager',        type:'full-time',   status:'active',     startDate:'2021-06-01', managerId:null, salary:30000, currency:'AED', salaryFrequency:'monthly', leaveBalances:{annual:18,sick:15,emergency:3,unpaid:0}, onboarding:null, notes:'Government accounts lead.', createdAt:'2021-06-01T00:00:00.000Z' },
      { id:3, firstName:'Maya',   lastName:'Khalil',     email:'maya@aladdinb2b.com',    phone:'+971 52 333 4455', nationality:'Lebanon', dob:'1993-11-08', gender:'Female', employeeId:'EMP-003', department:'Marketing',   position:'Marketing Specialist', type:'full-time',   status:'active',     startDate:'2023-03-15', managerId:null, salary:18000, currency:'AED', salaryFrequency:'monthly', leaveBalances:{annual:28,sick:15,emergency:3,unpaid:0}, onboarding:null, notes:'Tradeshow lead.',          createdAt:'2023-03-15T00:00:00.000Z' },
      { id:4, firstName:'Amjad',  lastName:'Al-Hue',     email:'amjad@aladdinb2b.com',   phone:'+971 50 444 5566', nationality:'UAE',     dob:'1985-01-30', gender:'Male',   employeeId:'EMP-004', department:'Finance',     position:'CFO',                  type:'full-time',   status:'active',     startDate:'2020-01-01', managerId:null, salary:55000, currency:'AED', salaryFrequency:'monthly', leaveBalances:{annual:30,sick:15,emergency:3,unpaid:0}, onboarding:null, notes:'',                         createdAt:'2020-01-01T00:00:00.000Z' },
      { id:5, firstName:'Layla',  lastName:'Mansour',    email:'layla@aladdinb2b.com',   phone:'+971 54 555 6677', nationality:'Egypt',   dob:'1995-05-20', gender:'Female', employeeId:'EMP-005', department:'Engineering', position:'Software Engineer',    type:'full-time',   status:'active',     startDate:'2023-09-01', managerId:null, salary:22000, currency:'AED', salaryFrequency:'monthly', leaveBalances:{annual:27,sick:15,emergency:3,unpaid:0}, onboarding:{startedAt:'2023-09-01T00:00:00.000Z',completedAt:null,tasks:[{id:1,title:'Send offer letter & welcome email',owner:'HR',category:'Pre-Hire',done:true,doneAt:'2023-08-29T00:00:00.000Z'},{id:2,title:'Setup laptop, email & system access',owner:'IT',category:'Day 1',done:true,doneAt:'2023-09-01T00:00:00.000Z'},{id:3,title:'Office tour & team introductions',owner:'Manager',category:'Day 1',done:true,doneAt:'2023-09-01T00:00:00.000Z'},{id:4,title:'Complete employment contract & visa docs',owner:'HR',category:'Day 1',done:true,doneAt:'2023-09-02T00:00:00.000Z'},{id:5,title:'Enroll in payroll & benefits',owner:'Finance',category:'Week 1',done:true,doneAt:'2023-09-05T00:00:00.000Z'},{id:6,title:'Assign buddy / mentor',owner:'Manager',category:'Week 1',done:false,doneAt:null},{id:7,title:'30-day check-in with manager',owner:'Manager',category:'Month 1',done:false,doneAt:null},{id:8,title:'Complete compliance & safety training',owner:'HR',category:'Month 1',done:false,doneAt:null},{id:9,title:'90-day probation review',owner:'HR',category:'Month 3',done:false,doneAt:null}]}, notes:'New hire — onboarding in progress.', createdAt:'2023-09-01T00:00:00.000Z' }
    ],

    hrSettings: {
      departments: ['Engineering','Sales','Finance','Operations','Marketing','Legal','HR'],
      positions:   ['CEO','CFO','CPO','HR Manager','Sales Manager','Software Engineer','Operations Manager','Marketing Specialist','Legal Counsel','Finance Analyst'],
      leaveTypes: [
        { id:'annual',    name:'Annual Leave',    defaultDays:30, color:'#2563EB' },
        { id:'sick',      name:'Sick Leave',      defaultDays:15, color:'#DC2626' },
        { id:'emergency', name:'Emergency Leave', defaultDays:3,  color:'#D97706' },
        { id:'unpaid',    name:'Unpaid Leave',    defaultDays:0,  color:'#6B7280' }
      ],
      portalEnabled: true,
      hrEmail: '',
      financeEmail: '',
      defaultOnboardingTasks: [
        { title:'Send offer letter & welcome email',        owner:'HR',      category:'Pre-Hire' },
        { title:'Setup laptop, email & system access',      owner:'IT',      category:'Day 1'   },
        { title:'Office tour & team introductions',         owner:'Manager', category:'Day 1'   },
        { title:'Complete employment contract & visa docs', owner:'HR',      category:'Day 1'   },
        { title:'Enroll in payroll & benefits',             owner:'Finance', category:'Week 1'  },
        { title:'Assign buddy / mentor',                    owner:'Manager', category:'Week 1'  },
        { title:'30-day check-in with manager',             owner:'Manager', category:'Month 1' },
        { title:'Complete compliance & safety training',    owner:'HR',      category:'Month 1' },
        { title:'90-day probation review',                  owner:'HR',      category:'Month 3' }
      ],
      companyPolicy: `Welcome to Aladdin Finance. These are the key policies for all team members:\n\n1. WORKING HOURS\nStandard hours are Sunday–Thursday, 9:00 AM–6:00 PM (UAE time). Fridays and Saturdays are weekends.\n\n2. LEAVE POLICY\nAnnual leave must be requested at least 5 working days in advance. Sick leave requires a medical certificate for absences of 3 or more consecutive days. Emergency leave of up to 3 days may be taken without prior approval.\n\n3. REMOTE WORK\nRemote work requests must be approved by your direct manager. Up to 2 days per week may be permitted depending on role requirements.\n\n4. CODE OF CONDUCT\nAll employees are expected to maintain professional standards, respect colleagues, and protect confidential company and client information at all times.\n\n5. REQUESTS & EXPENSES\nAll purchase requests and expense reimbursements must be submitted through the official portal and approved before commitment.`
    },

    statements: {
      pnl: {
        year: 2026,
        rows: [
          { id: 'revenue',  cat: 'Revenue',                  type: 'income',   months: { Jan:108000,Feb:126000,Mar:142000,Apr:158000,May:169000,Jun:166000,Jul:0,Aug:0,Sep:0,Oct:0,Nov:0,Dec:0 }, computed: false },
          { id: 'cogs',     cat: 'Cost of Sales',            type: 'cogs',     months: { Jan:43200, Feb:50400, Mar:56800, Apr:63200, May:67600, Jun:66400, Jul:0,Aug:0,Sep:0,Oct:0,Nov:0,Dec:0 }, computed: false },
          { id: 'gross',    cat: 'Gross Profit',             type: 'subtotal', months: {}, computed: true, formula: 'revenue-cogs' },
          { id: 'payroll',  cat: 'Payroll',                  type: 'opex',     months: { Jan:54000, Feb:55000, Mar:56000, Apr:54000, May:57000, Jun:56000, Jul:0,Aug:0,Sep:0,Oct:0,Nov:0,Dec:0 }, computed: false },
          { id: 'contract', cat: 'Contractors',              type: 'opex',     months: { Jan:18000, Feb:20000, Mar:19000, Apr:22000, May:18000, Jun:19000, Jul:0,Aug:0,Sep:0,Oct:0,Nov:0,Dec:0 }, computed: false },
          { id: 'software', cat: 'Software & Tools',         type: 'opex',     months: { Jan:9600,  Feb:9800,  Mar:10200, Apr:9500,  May:10400, Jun:9700,  Jul:0,Aug:0,Sep:0,Oct:0,Nov:0,Dec:0 }, computed: false },
          { id: 'cloud',    cat: 'Cloud Infrastructure',     type: 'opex',     months: { Jan:13200, Feb:12800, Mar:12400, Apr:13600, May:12200, Jun:13800, Jul:0,Aug:0,Sep:0,Oct:0,Nov:0,Dec:0 }, computed: false },
          { id: 'mktg',     cat: 'Marketing',                type: 'opex',     months: { Jan:7200,  Feb:8400,  Mar:9200,  Apr:7800,  May:8600,  Jun:8200,  Jul:0,Aug:0,Sep:0,Oct:0,Nov:0,Dec:0 }, computed: false },
          { id: 'legal',    cat: 'Legal & Admin',            type: 'opex',     months: { Jan:5400,  Feb:6200,  Mar:5800,  Apr:6400,  May:5600,  Jun:7200,  Jul:0,Aug:0,Sep:0,Oct:0,Nov:0,Dec:0 }, computed: false },
          { id: 'totopex',  cat: 'Total Operating Expenses', type: 'subtotal', months: {}, computed: true, formula: 'sum-opex' },
          { id: 'ebitda',   cat: 'EBITDA',                   type: 'total',    months: {}, computed: true, formula: 'gross-totopex' }
        ]
      },
      balanceSheet: {
        asOf: '2026-04-30',
        assets: [
          { label: 'Cash & Bank Balances', value: 619000 },
          { label: 'Accounts Receivable',  value: 287000 },
          { label: 'Prepaid Expenses',     value: 42000  },
          { label: 'Property & Equipment', value: 185000 },
          { label: 'Intangible Assets',    value: 95000  }
        ],
        liabilities: [
          { label: 'Accounts Payable', value: 78000  },
          { label: 'Accrued Expenses', value: 125000 },
          { label: 'Deferred Revenue', value: 97000  }
        ],
        equity: [
          { label: 'Paid-in Capital',   value: 500000 },
          { label: 'Retained Earnings', value: 428000 }
        ]
      }
    }
  };
}

module.exports = { seed };
