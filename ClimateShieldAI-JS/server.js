'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let express;
try {
  express = require('express');
} catch (err) {
  const candidatePaths = [
    path.join(__dirname, 'node_modules', 'express'),
    path.join(__dirname, 'ClimateShieldAI-JS', 'node_modules', 'express'),
    path.join(__dirname, '..', 'node_modules', 'express'),
    path.join(__dirname, '..', 'ClimateShieldAI-JS', 'node_modules', 'express')
  ];
  for (const p of candidatePaths) {
    try {
      express = require(p);
      break;
    } catch (_) {}
  }
  if (!express) {
    console.error('\n[ClimateShield AI] Could not load "express". Please run: npm.cmd install\n');
    throw err;
  }
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(['/data', '/server.js', '/package.json'], (_req, res) => res.status(404).send('Not found'));
app.use(express.static(ROOT, { extensions: ['html'], dotfiles: 'deny' }));

const SEED_BUSINESSES = [
  { id: 'b01', name: 'Sahyadri Agro Foods',          type: 'Food processing',  city: 'Pune',   state: 'Maharashtra', fin: 48, flood: 62, heat: 55, water: 40, assessed: '2026-10-06', isDemo: true, context: 'Seasonal produce is stored on the ground floor of a unit near a drainage channel.' },
  { id: 'b02', name: 'Godavari Handloom Weavers',    type: 'Textile weaving',  city: 'Nashik', state: 'Maharashtra', fin: 66, flood: 70, heat: 58, water: 52, assessed: '2026-10-02', isDemo: true, context: 'Looms and yarn stock sit close to the river floodplain, with limited cash reserves.' },
  { id: 'b03', name: 'Tapi Textile Dyeing Works',    type: 'Textile dyeing',   city: 'Surat',  state: 'Gujarat',     fin: 72, flood: 88, heat: 70, water: 76, assessed: '2026-10-07', isDemo: true, context: 'A water-intensive process in a low-lying industrial cluster.' },
  { id: 'b04', name: 'Vidarbha Cold Chain Services', type: 'Cold storage',     city: 'Nagpur', state: 'Maharashtra', fin: 70, flood: 35, heat: 92, water: 60, assessed: '2026-09-29', isDemo: true, context: 'Refrigeration load rises sharply in peak summer, and the unit carries significant debt.' },
  { id: 'b05', name: 'Kothrud Artisan Bakery',       type: 'Bakery',           city: 'Pune',   state: 'Maharashtra', fin: 30, flood: 28, heat: 40, water: 25, assessed: '2026-10-08', isDemo: true, context: 'Small urban premises with diversified local customers.' },
  { id: 'b06', name: 'Nashik Valley Grape Packers',  type: 'Fruit packing',    city: 'Nashik', state: 'Maharashtra', fin: 55, flood: 40, heat: 68, water: 82, assessed: '2026-09-25', isDemo: true, context: 'Depends on irrigation-linked supply from partner farms.' },
  { id: 'b07', name: 'Chakan Auto Components',       type: 'Auto parts',       city: 'Pune',   state: 'Maharashtra', fin: 35, flood: 45, heat: 38, water: 30, assessed: '2026-10-01', isDemo: true, context: 'Established units with steady order books and moderate site exposure.' },
  { id: 'b08', name: 'Varachha Diamond Polishing',   type: 'Gem polishing',    city: 'Surat',  state: 'Gujarat',     fin: 78, flood: 90, heat: 60, water: 55, assessed: '2026-10-05', isDemo: true, context: 'High-value inventory is held in a flood-prone locality with a thin margin.' },
  { id: 'b09', name: 'Nagpur Masala Mills',          type: 'Spice milling',    city: 'Nagpur', state: 'Maharashtra', fin: 40, flood: 30, heat: 72, water: 48, assessed: '2026-09-30', isDemo: true, context: 'Grinding and storage areas are poorly ventilated in summer.' },
  { id: 'b10', name: 'Wardha Road Print House',      type: 'Printing',         city: 'Nagpur', state: 'Maharashtra', fin: 22, flood: 20, heat: 35, water: 18, assessed: '2026-09-22', isDemo: true, context: 'Commercial printing unit with minimal direct hazard vulnerability.' },
  { id: 'b11', name: 'Panchavati Dairy Cooperative', type: 'Dairy',            city: 'Nashik', state: 'Maharashtra', fin: 60, flood: 50, heat: 82, water: 70, assessed: '2026-10-03', isDemo: true, context: 'Milk quality and yield are sensitive to heat; fodder supply depends on rainfall.' },
  { id: 'b12', name: 'Pandesara Embroidery Cluster', type: 'Embroidery',       city: 'Surat',  state: 'Gujarat',     fin: 80, flood: 92, heat: 74, water: 70, assessed: '2026-10-04', isDemo: true, context: 'Several small units share a flood-prone site and have weak savings buffers.' },
  { id: 'b13', name: 'Hinjewadi IT Services',        type: 'IT services',      city: 'Pune',   state: 'Maharashtra', fin: 18, flood: 30, heat: 25, water: 15, assessed: '2026-10-08', isDemo: true, context: 'Office-based operations with remote-work fallback.' }
];

const SEED_ALERTS = [
  { id: 'a1', hazard: 'heat',  level: 'elevated', title: 'Elevated heat exposure — Nagpur',   region: 'Nagpur, Maharashtra', summary: 'Sample scenario: sustained high temperatures stress refrigeration and ventilation in heat-sensitive units.', status: 'Open', businessIds: ['b04', 'b09'], createdAt: '2026-10-09T00:00:00.000Z' },
  { id: 'a2', hazard: 'flood', level: 'moderate', title: 'Heavy-rainfall monitoring — Surat', region: 'Surat, Gujarat',      summary: 'Sample scenario: heavy rainfall is being monitored for low-lying industrial clusters near the river.', status: 'Monitoring', businessIds: ['b03', 'b08', 'b12'], createdAt: '2026-10-09T00:00:00.000Z' },
  { id: 'a3', hazard: 'water', level: 'moderate', title: 'Water-scarcity watch — Nashik',     region: 'Nashik, Maharashtra', summary: 'Sample scenario: reduced reservoir levels may affect water-dependent processing and farm supply.', status: 'Open', businessIds: ['b02', 'b06', 'b11'], createdAt: '2026-10-09T00:00:00.000Z' }
];

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ businesses: SEED_BUSINESSES, simulations: [], alerts: SEED_ALERTS }, null, 2));
  }
}

function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(raw);
    db.businesses ||= [];
    db.simulations ||= [];
    db.alerts ||= [];
    if (!db.businesses.length) {
      db.businesses = [...SEED_BUSINESSES];
      writeDb(db);
    }
    if (!db.alerts.length) {
      db.alerts = [...SEED_ALERTS];
      writeDb(db);
    }
    return db;
  } catch (error) {
    throw new Error('Could not read data/db.json. Restore valid JSON before restarting.');
  }
}

function writeDb(db) {
  const temp = `${DB_PATH}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_PATH);
}

// Transparent, deterministic climate risk scoring:
// 40% financial vulnerability + 60% average of flood, heat, and water-stress risk
function riskFor(b) {
  const fin = Number(b.fin);
  const flood = Number(b.flood);
  const heat = Number(b.heat);
  const water = Number(b.water);
  const climateAverage = Math.round((flood + heat + water) / 3);
  const rawScore = Math.round(0.4 * fin + 0.6 * climateAverage);
  const score = Math.min(100, Math.max(0, rawScore));
  const band = score >= 70 ? 'High' : score >= 50 ? 'Elevated' : score >= 30 ? 'Moderate' : 'Low';
  const bandKey = band.toLowerCase();
  return { score, band, bandKey, climateAverage };
}

function enriched(b) {
  const risk = riskFor(b);
  return {
    ...b,
    ...risk,
    fin: Number(b.fin),
    flood: Number(b.flood),
    heat: Number(b.heat),
    water: Number(b.water),
    isDemo: Boolean(b.isDemo),
    location: [b.city, b.state].filter(Boolean).join(', ')
  };
}

function isText(v, min = 1, max = 120) {
  return typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
}

function isScore(v) {
  const n = Number(v);
  return !Number.isNaN(n) && Number.isInteger(n) && n >= 0 && n <= 100;
}

function csvCell(value) {
  const s = String(value ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

// -----------------------------------------------------------------------------
// REST API Routes
// -----------------------------------------------------------------------------

// Health check
app.get('/api/health', (_req, res) => {
  try {
    const db = readDb();
    res.json({
      ok: true,
      service: 'ClimateShield API',
      storage: 'JSON file',
      version: '1.0.0',
      businesses: db.businesses.length,
      simulations: db.simulations.length,
      alerts: db.alerts.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Storage unavailable', details: err.message });
  }
});

// List businesses
app.get('/api/businesses', (_req, res) => {
  try {
    const db = readDb();
    res.json({
      data: db.businesses.map(enriched),
      count: db.businesses.length,
      dataNote: 'Deterministic rule-based scoring (40% financial + 60% climate exposure).'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve businesses' });
  }
});

// Get single business
app.get('/api/businesses/:id', (req, res) => {
  try {
    const db = readDb();
    const found = db.businesses.find(b => b.id === req.params.id);
    if (!found) return res.status(404).json({ error: 'Business not found' });
    res.json({ data: enriched(found) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve business' });
  }
});

// Create business
app.post('/api/businesses', (req, res) => {
  try {
    const { name, type, city, state = '', fin, flood, heat, water, context = '' } = req.body || {};
    if (!isText(name, 2, 120)) {
      return res.status(400).json({ error: 'Business name is required (2–120 characters).' });
    }
    if (!isText(type, 2, 80)) {
      return res.status(400).json({ error: 'Business industry/type is required (2–80 characters).' });
    }
    if (!isText(city, 2, 80)) {
      return res.status(400).json({ error: 'City is required (2–80 characters).' });
    }
    if (![fin, flood, heat, water].every(isScore)) {
      return res.status(400).json({ error: 'Financial vulnerability, flood, heat, and water scores must be integers between 0 and 100.' });
    }

    const db = readDb();
    const record = {
      id: `biz_${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim(),
      type: type.trim(),
      city: city.trim(),
      state: String(state || '').trim().slice(0, 80),
      fin: Number(fin),
      flood: Number(flood),
      heat: Number(heat),
      water: Number(water),
      isDemo: false,
      context: String(context || '').trim().slice(0, 500) || 'User-saved MSME climate assessment.',
      assessed: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString()
    };

    db.businesses.unshift(record);
    writeDb(db);
    res.status(201).json({ data: enriched(record), message: 'Business assessment saved successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save business assessment' });
  }
});

// Update business
app.put('/api/businesses/:id', (req, res) => {
  try {
    const { name, type, city, state, fin, flood, heat, water, context } = req.body || {};
    const db = readDb();
    const index = db.businesses.findIndex(b => b.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Business not found.' });
    }

    if (name !== undefined && !isText(name, 2, 120)) {
      return res.status(400).json({ error: 'Business name must be 2–120 characters.' });
    }
    if (type !== undefined && !isText(type, 2, 80)) {
      return res.status(400).json({ error: 'Business type must be 2–80 characters.' });
    }
    if (city !== undefined && !isText(city, 2, 80)) {
      return res.status(400).json({ error: 'City must be 2–80 characters.' });
    }
    if ([fin, flood, heat, water].some(v => v !== undefined && !isScore(v))) {
      return res.status(400).json({ error: 'All risk scores must be integers between 0 and 100.' });
    }

    const existing = db.businesses[index];
    const updated = {
      ...existing,
      name: name !== undefined ? name.trim() : existing.name,
      type: type !== undefined ? type.trim() : existing.type,
      city: city !== undefined ? city.trim() : existing.city,
      state: state !== undefined ? String(state).trim().slice(0, 80) : existing.state,
      fin: fin !== undefined ? Number(fin) : existing.fin,
      flood: flood !== undefined ? Number(flood) : existing.flood,
      heat: heat !== undefined ? Number(heat) : existing.heat,
      water: water !== undefined ? Number(water) : existing.water,
      context: context !== undefined ? String(context).trim().slice(0, 500) : existing.context,
      updatedAt: new Date().toISOString(),
      assessed: new Date().toISOString().slice(0, 10)
    };

    db.businesses[index] = updated;
    writeDb(db);
    res.json({ data: enriched(updated), message: 'Business assessment updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update business assessment' });
  }
});

// Also support PATCH for partial updates
app.patch('/api/businesses/:id', (req, res) => {
  // Delegate to PUT handler
  req.url = `/api/businesses/${req.params.id}`;
  app._router.handle(req, res);
});

// Delete business
app.delete('/api/businesses/:id', (req, res) => {
  try {
    const db = readDb();
    const index = db.businesses.findIndex(b => b.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Business not found.' });
    }

    const [removed] = db.businesses.splice(index, 1);
    // Remove business from any alerts affected list
    db.alerts.forEach(a => {
      if (Array.isArray(a.businessIds)) {
        a.businessIds = a.businessIds.filter(id => id !== req.params.id);
      }
    });

    writeDb(db);
    res.json({ ok: true, message: `Business '${removed.name}' removed from portfolio.`, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete business assessment' });
  }
});

// Simulations
app.get('/api/simulations', (_req, res) => {
  try {
    const db = readDb();
    res.json({ data: db.simulations });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve simulations' });
  }
});

app.post('/api/simulations', (req, res) => {
  try {
    const { businessId, hazard, level, levels } = req.body || {};
    const db = readDb();
    const business = db.businesses.find(b => b.id === businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found. Please select a valid business.' });
    }

    const baseline = enriched(business);
    let scenarioBusiness = { ...business };

    if (levels && typeof levels === 'object') {
      ['flood', 'heat', 'water'].forEach(h => {
        if (levels[h] !== undefined && isScore(levels[h])) {
          scenarioBusiness[h] = Number(levels[h]);
        }
      });
    } else if (hazard && ['flood', 'heat', 'water'].includes(hazard) && isScore(level)) {
      scenarioBusiness[hazard] = Number(level);
    } else {
      return res.status(400).json({ error: 'Provide a valid hazard and score level between 0 and 100.' });
    }

    const scenario = enriched(scenarioBusiness);
    const diff = scenario.score - baseline.score;

    const result = {
      id: `sim_${crypto.randomUUID().slice(0, 8)}`,
      businessId,
      businessName: business.name,
      hazard: hazard || 'multi-hazard',
      level: level !== undefined ? Number(level) : null,
      scenarioValues: {
        fin: scenarioBusiness.fin,
        flood: scenarioBusiness.flood,
        heat: scenarioBusiness.heat,
        water: scenarioBusiness.water
      },
      baselineScore: baseline.score,
      baselineBand: baseline.band,
      scenarioScore: scenario.score,
      scenarioBand: scenario.band,
      difference: diff,
      deltaText: diff > 0 ? `+${diff}` : String(diff),
      createdAt: new Date().toISOString(),
      note: 'Rule-based what-if scenario simulation; deterministic projection based on portfolio model.'
    };

    db.simulations.unshift(result);
    if (db.simulations.length > 50) db.simulations = db.simulations.slice(0, 50);
    writeDb(db);

    res.status(201).json({ data: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to run scenario simulation' });
  }
});

// Alerts
app.get('/api/alerts', (_req, res) => {
  try {
    const db = readDb();
    res.json({ data: db.alerts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve alerts' });
  }
});

app.patch('/api/alerts/:id', (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['Open', 'Monitoring', 'Resolved'].includes(status)) {
      return res.status(400).json({ error: 'Status must be Open, Monitoring, or Resolved.' });
    }
    const db = readDb();
    const alert = db.alerts.find(a => a.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found.' });

    alert.status = status;
    alert.updatedAt = new Date().toISOString();
    writeDb(db);
    res.json({ data: alert, message: `Alert status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// Dashboard summary
app.get('/api/dashboard/summary', (_req, res) => {
  try {
    const records = readDb().businesses.map(enriched);
    const scores = records.map(b => b.score);
    const counts = {
      low: records.filter(b => b.band === 'Low').length,
      moderate: records.filter(b => b.band === 'Moderate').length,
      elevated: records.filter(b => b.band === 'Elevated').length,
      high: records.filter(b => b.band === 'High').length
    };
    res.json({
      total: records.length,
      averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      highRisk: counts.high,
      elevatedOrHigh: counts.elevated + counts.high,
      counts,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Portfolio JSON report
app.get('/api/reports/portfolio', (_req, res) => {
  try {
    const db = readDb();
    const businesses = db.businesses.map(enriched);
    const avgScore = businesses.length ? Math.round(businesses.reduce((s, b) => s + b.score, 0) / businesses.length) : 0;
    res.json({
      generatedAt: new Date().toISOString(),
      methodology: 'Deterministic screening heuristic: 40% financial vulnerability + 60% climate hazard average (flood, heat, water).',
      summary: {
        total: businesses.length,
        averageScore: avgScore,
        highRisk: businesses.filter(b => b.band === 'High').length,
        elevatedRisk: businesses.filter(b => b.band === 'Elevated').length,
        moderateRisk: businesses.filter(b => b.band === 'Moderate').length,
        lowRisk: businesses.filter(b => b.band === 'Low').length
      },
      businesses,
      simulationsCount: db.simulations.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate portfolio report' });
  }
});

// Portfolio CSV report
app.get('/api/reports/portfolio.csv', (_req, res) => {
  try {
    const businesses = readDb().businesses.map(enriched);
    const columns = ['id', 'name', 'type', 'city', 'state', 'fin', 'flood', 'heat', 'water', 'score', 'band', 'climateAverage', 'assessed', 'isDemo'];
    const headers = ['ID', 'Business Name', 'Industry', 'City', 'State', 'Financial Vulnerability', 'Flood Risk', 'Heat Risk', 'Water Stress', 'Overall Score', 'Risk Classification', 'Climate Exposure Avg', 'Last Assessed Date', 'Demo Data'];
    
    const csvRows = [
      headers.join(','),
      ...businesses.map(b => columns.map(c => csvCell(b[c])).join(','))
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="climateshield-portfolio.csv"');
    // Prepend UTF-8 BOM so Excel opens it with proper encoding
    res.send('\uFEFF' + csvRows.join('\r\n'));
  } catch (err) {
    res.status(500).send('Error generating CSV report');
  }
});

// 404 for unknown API
app.use('/api', (req, res) => res.status(404).json({ error: `Unknown API route: ${req.method} ${req.path}` }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error. Check terminal logs for details.' });
});

ensureDb();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(` ClimateShield AI running at http://localhost:${PORT}`);
    console.log(` API Health Check:         http://localhost:${PORT}/api/health`);
    console.log(` Press Ctrl+C to stop.`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
