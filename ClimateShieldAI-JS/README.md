# ClimateShield AI — Enterprise Climate Risk Intelligence

ClimateShield AI is a functional, auditable MSME climate-vulnerability intelligence platform designed for credit analysts, underwriters, and sustainability risk teams.

It uses a transparent, deterministic scoring methodology combining financial vulnerability with localized hazard exposure metrics.

## Features

- **Full Portfolio Business Management (CRUD)**:
  - Add, edit, and delete MSME business profiles with instant deterministic score calculation.
  - Multi-hazard inputs: Financial vulnerability (0–100), Flood risk (0–100), Heat risk (0–100), and Water scarcity (0–100).
  - Clear labeling distinguishing seed sample data (`DEMO DATA`) from saved borrower accounts (`SAVED RECORD`).
  - Search, sort, and multi-dimensional filtering across sectors and risk bands.
  - Safe delete confirmation dialog preventing accidental data loss.

- **Deterministic Climate Risk Scoring**:
  - `Overall Score = round( 0.40 × Financial Vulnerability + 0.60 × Average(Flood, Heat, Water) )`
  - Clamped strictly between 0 and 100.
  - Risk Classifications:
    - **Low**: 0–29
    - **Moderate**: 30–49
    - **Elevated**: 50–69
    - **High**: 70–100

- **Climate Risk Stress-Testing & Scenario Simulator**:
  - Interactive what-if scenario testing for any borrower account.
  - Real-time delta score calculation, category shift projection, and point variance display.
  - Scenario presets (Severe Monsoons, Peak Heatwave, Severe Drought).
  - Persist simulation records or apply projected values directly as the new baseline.

- **Dynamic Climate Alerts**:
  - Portfolio hazard alerts automatically identified from borrower vulnerability clusters.
  - Interactive status transitions: `Open`, `Monitoring`, `Resolved`.
  - Direct links to affected MSME borrower records.

- **Executive Portfolio Reporting & RFC 4180 CSV Export**:
  - Sector-level risk concentration breakdown.
  - One-click RFC 4180 compliant CSV export with proper escaping and UTF-8 BOM encoding for Excel.
  - Print / PDF summary formatting.

- **Centralized Data Layer & Supabase Readiness**:
  - Decoupled `dataService` abstraction in `api.js` separates UI from persistence.
  - Fully functional Node.js / Express backend with JSON file persistence (`data/db.json`).
  - Ready to swap to Supabase without changing any frontend UI code.

## Getting Started

### 1. Start the Backend Server

Open your terminal in this directory (`ClimateShieldAI-JS`) and run:

```powershell
npm install
npm start
```

### 2. Access the Application

Open your browser to:
- **Dashboard**: `http://localhost:3000`
- **API Health Check**: `http://localhost:3000/api/health`

### Available API Endpoints

- `GET /api/health` — API status and storage statistics
- `GET /api/businesses` — Retrieve all businesses with computed risk scores
- `GET /api/businesses/:id` — Retrieve a single business assessment
- `POST /api/businesses` — Create and save a new business assessment
- `PUT /api/businesses/:id` — Update an existing business assessment
- `DELETE /api/businesses/:id` — Delete a business assessment from portfolio
- `GET /api/simulations` — List recent scenario simulation runs
- `POST /api/simulations` — Run and save a climate stress-test scenario
- `GET /api/alerts` — List portfolio climate alerts
- `PATCH /api/alerts/:id` — Update alert status (`Open`, `Monitoring`, `Resolved`)
- `GET /api/dashboard/summary` — Aggregate portfolio summary metrics
- `GET /api/reports/portfolio` — JSON executive risk report
- `GET /api/reports/portfolio.csv` — RFC 4180 compliant CSV file download

## Supabase Integration Guide

To migrate from the local JSON storage to Supabase:

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Run the following SQL migration in the Supabase SQL Editor:

```sql
CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT,
  fin INT CHECK (fin >= 0 AND fin <= 100),
  flood INT CHECK (flood >= 0 AND flood <= 100),
  heat INT CHECK (heat >= 0 AND heat <= 100),
  water INT CHECK (water >= 0 AND water <= 100),
  context TEXT,
  is_demo BOOLEAN DEFAULT false,
  assessed DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE simulations (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  business_name TEXT,
  hazard TEXT,
  baseline_score INT,
  scenario_score INT,
  difference INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

3. In `api.js`, replace the `fetch('/api/businesses')` calls with:
```javascript
const { data, error } = await supabase.from('businesses').select('*');
```
Because all components call `window.dataService`, no UI code needs to be altered.
