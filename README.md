# Aladdin Finance — CFO Command Center

Node.js + Express finance dashboard with QuickBooks, HubSpot, and Google integration stubs.

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000**

For auto-reload during development:
```bash
npm run dev
```

## Requirements

- Node.js 18 or higher
- npm 9 or higher

## Project structure

```
aladdin-finance/
├── server.js              Express app entry point
├── package.json           Dependencies
├── .env.example           Config template (copy to .env)
├── routes/                API endpoints
│   ├── cash.js            Bank balances
│   ├── reserves.js        Manual cash reserves
│   ├── cashflow.js        Cash flow forecast
│   ├── budget.js          Budget targets
│   ├── revenue.js         Revenue data
│   ├── clients.js         Clients (from QuickBooks)
│   ├── events.js          Calendar events
│   ├── tasks.js           Tasks
│   ├── files.js           File uploads
│   └── sync.js            API status
├── data/
│   ├── store.js           JSON file persistence
│   └── seed.js            Default seed data
├── store/                 Auto-generated JSON data files
├── uploads/               Uploaded files
└── public/
    ├── index.html         Main dashboard UI
    └── js/app.js          Frontend logic
```

## API endpoints

| Method | Endpoint                    | Description               |
|--------|-----------------------------|---------------------------|
| GET    | `/api/health`               | Health check              |
| GET    | `/api/cash`                 | Bank balances             |
| POST   | `/api/cash/sync`            | Sync from QuickBooks      |
| GET    | `/api/reserves`             | List reserves             |
| POST   | `/api/reserves`             | Add reserve               |
| DELETE | `/api/reserves/:id`         | Delete reserve            |
| GET    | `/api/cashflow`             | Cash flow forecast        |
| PUT    | `/api/cashflow`             | Update forecast           |
| POST   | `/api/cashflow/sync`        | Sync from QuickBooks      |
| GET    | `/api/budget`               | Budget data               |
| PUT    | `/api/budget`               | Update budget             |
| POST   | `/api/budget/sync`          | Sync from QuickBooks      |
| GET    | `/api/revenue`              | Revenue data              |
| PUT    | `/api/revenue`              | Update revenue            |
| POST   | `/api/revenue/sync`         | Sync from QuickBooks      |
| GET    | `/api/clients`              | List clients              |
| GET    | `/api/clients/:id`          | Single client             |
| POST   | `/api/clients`              | Add client                |
| PUT    | `/api/clients/:id`          | Update client             |
| DELETE | `/api/clients/:id`          | Delete client             |
| POST   | `/api/clients/sync`         | Sync from QuickBooks      |
| GET    | `/api/events`               | Calendar events           |
| POST   | `/api/events`               | Add event                 |
| DELETE | `/api/events/:id`           | Delete event              |
| GET    | `/api/tasks`                | List tasks                |
| POST   | `/api/tasks`                | Add task                  |
| PATCH  | `/api/tasks/:id`            | Update task               |
| DELETE | `/api/tasks/:id`            | Delete task               |
| GET    | `/api/files`                | List files                |
| POST   | `/api/files/upload`         | Upload file (multipart)   |
| GET    | `/api/files/:id/download`   | Download file             |
| DELETE | `/api/files/:id`            | Delete file               |
| GET    | `/api/sync/status`          | API connection status     |
| POST   | `/api/sync/all`             | Sync all sources          |

## Connecting real APIs

The sync endpoints currently return seeded data. To connect production APIs:

### QuickBooks
1. Register at [developer.intuit.com](https://developer.intuit.com)
2. Create an app, get Client ID + Secret
3. Copy `.env.example` to `.env` and fill in your credentials
4. Uncomment the axios calls in `routes/clients.js` sync handler

### HubSpot
1. Create a Private App at [developers.hubspot.com](https://developers.hubspot.com)
2. Add `HUBSPOT_ACCESS_TOKEN` to `.env`

### Google Drive + Calendar
1. Create project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable Drive + Calendar APIs
3. Create OAuth credentials
4. Add Google credentials to `.env`

## Data persistence

All data is stored as JSON files in `store/` directory. First run creates files automatically from seed data. For production, swap `data/store.js` to use PostgreSQL or Supabase.

## License

Private — internal use only.
