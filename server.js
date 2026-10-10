'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const crypto = require('crypto');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const BUSINESS_COLUMNS = 'id,name,type,city,state,fin,flood,heat,water,context,is_demo,assessed,created_at';
const SIMULATION_COLUMNS = 'id,business_id,business_name,hazard,baseline_score,scenario_score,difference,created_at';
const HAZARDS = ['flood', 'heat', 'water'];
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configuredClient = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  })
  : null;

function riskFor(business) {
  const climateAverage = Math.round((Number(business.flood) + Number(business.heat) + Number(business.water)) / 3);
  const score = Math.min(100, Math.max(0, Math.round(0.4 * Number(business.fin) + 0.6 * climateAverage)));
  const band = score >= 70 ? 'High' : score >= 50 ? 'Elevated' : score >= 30 ? 'Moderate' : 'Low';
  return { score, band, bandKey: band.toLowerCase(), climateAverage };
}

function enrichBusiness(row) {
  return {
    ...row,
    ...riskFor(row),
    fin: Number(row.fin),
    flood: Number(row.flood),
    heat: Number(row.heat),
    water: Number(row.water),
    isDemo: Boolean(row.is_demo),
    location: [row.city, row.state].filter(Boolean).join(', ')
  };
}

function mapSimulation(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_name,
    hazard: row.hazard,
    baselineScore: row.baseline_score,
    scenarioScore: row.scenario_score,
    difference: row.difference,
    createdAt: row.created_at
  };
}

function isText(value, min = 1, max = 120) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function isScore(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100;
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function createApp(client = configuredClient) {
  const app = express();
  const alertStatuses = new Map();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(['/data', '/server.js', '/package.json', '/.env'], (_req, res) => res.status(404).send('Not found'));
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], dotfiles: 'deny' }));

  function requireSupabase() {
    if (!client) {
      const error = new Error('Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.');
      error.status = 503;
      throw error;
    }
    return client;
  }

  function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  }

  function handleError(error, _req, res, _next) {
    const status = error.status || 500;
    const message = status === 503 ? error.message : (error.message || 'Database request failed.');
    if (status >= 500) {
      console.error(`[ClimateShield API] ${status === 503 ? 'configuration' : 'request'} error: ${message}`);
    }
    res.status(status).json({ error: message });
  }

  async function getBusinesses() {
    const { data, error } = await requireSupabase()
      .from('businesses')
      .select(BUSINESS_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  function getAlerts(businesses) {
    const groups = new Map();
    for (const business of businesses) {
      for (const hazard of HAZARDS) {
        if (Number(business[hazard]) < 70) continue;
        const region = [business.city, business.state].filter(Boolean).join(', ');
        const id = `hazard-${hazard}-${region.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        if (!groups.has(id)) {
          groups.set(id, {
            id,
            hazard,
            level: 'high',
            title: `High ${hazard} exposure — ${business.city}`,
            region,
            summary: `Saved business assessments indicate high ${hazard} exposure in this location.`,
            status: alertStatuses.get(id) || 'Open',
            businessIds: [],
            createdAt: new Date().toISOString()
          });
        }
        groups.get(id).businessIds.push(business.id);
      }
    }
    return [...groups.values()];
  }

  app.get('/api/health', asyncRoute(async (_req, res) => {
    const db = requireSupabase();
    const [businessesResult, simulationsResult] = await Promise.all([
      db.from('businesses').select(BUSINESS_COLUMNS, { count: 'exact', head: true }),
      db.from('simulations').select(SIMULATION_COLUMNS, { count: 'exact', head: true })
    ]);
    if (businessesResult.error) throw businessesResult.error;
    if (simulationsResult.error) throw simulationsResult.error;
    res.json({
      ok: true,
      service: 'ClimateShield API',
      storage: 'Supabase',
      businesses: businessesResult.count || 0,
      simulations: simulationsResult.count || 0,
      timestamp: new Date().toISOString()
    });
  }));

  app.get('/api/businesses', asyncRoute(async (_req, res) => {
    const businesses = await getBusinesses();
    res.json({
      data: businesses.map(enrichBusiness),
      count: businesses.length,
      dataNote: 'Deterministic rule-based scoring (40% financial + 60% climate exposure).'
    });
  }));

  app.get('/api/businesses/:id', asyncRoute(async (req, res) => {
    const { data, error } = await requireSupabase()
      .from('businesses')
      .select(BUSINESS_COLUMNS)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Business not found.' });
    res.json({ data: enrichBusiness(data) });
  }));

  app.post('/api/businesses', asyncRoute(async (req, res) => {
    const { name, type, city, state = '', fin, flood, heat, water, context = '' } = req.body || {};
    if (!isText(name, 2, 120)) return res.status(400).json({ error: 'Business name is required (2–120 characters).' });
    if (!isText(type, 2, 80)) return res.status(400).json({ error: 'Business industry/type is required (2–80 characters).' });
    if (!isText(city, 2, 80)) return res.status(400).json({ error: 'City is required (2–80 characters).' });
    if (![fin, flood, heat, water].every(isScore)) {
      return res.status(400).json({ error: 'Financial vulnerability, flood, heat, and water scores must be integers between 0 and 100.' });
    }
    if (typeof state !== 'string' || typeof context !== 'string') {
      return res.status(400).json({ error: 'State and context must be text.' });
    }

    const record = {
      id: `biz_${crypto.randomUUID()}`,
      name: name.trim(),
      type: type.trim(),
      city: city.trim(),
      state: state.trim().slice(0, 80),
      fin: Number(fin),
      flood: Number(flood),
      heat: Number(heat),
      water: Number(water),
      context: context.trim().slice(0, 500),
      is_demo: false,
      assessed: new Date().toISOString().slice(0, 10)
    };
    const { data, error } = await requireSupabase()
      .from('businesses')
      .insert(record)
      .select(BUSINESS_COLUMNS)
      .single();
    if (error) throw error;
    res.status(201).json({ data: enrichBusiness(data), message: 'Business assessment saved successfully.' });
  }));

  const updateBusiness = asyncRoute(async (req, res) => {
    const body = req.body || {};
    const updates = {};
    for (const field of ['name', 'type', 'city']) {
      if (body[field] !== undefined) {
        const limits = field === 'name' ? [2, 120] : [2, 80];
        if (!isText(body[field], ...limits)) {
          return res.status(400).json({ error: `${field[0].toUpperCase()}${field.slice(1)} must be ${limits[0]}–${limits[1]} characters.` });
        }
        updates[field] = body[field].trim();
      }
    }
    for (const field of ['fin', ...HAZARDS]) {
      if (body[field] !== undefined) {
        if (!isScore(body[field])) return res.status(400).json({ error: 'All risk scores must be integers between 0 and 100.' });
        updates[field] = Number(body[field]);
      }
    }
    for (const field of ['state', 'context']) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'string') return res.status(400).json({ error: `${field} must be text.` });
        updates[field] = body[field].trim().slice(0, field === 'state' ? 80 : 500);
      }
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Provide at least one business field to update.' });
    updates.assessed = new Date().toISOString().slice(0, 10);

    const { data, error } = await requireSupabase()
      .from('businesses')
      .update(updates)
      .eq('id', req.params.id)
      .select(BUSINESS_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Business not found.' });
    res.json({ data: enrichBusiness(data), message: 'Business assessment updated successfully.' });
  });
  app.put('/api/businesses/:id', updateBusiness);
  app.patch('/api/businesses/:id', updateBusiness);

  app.delete('/api/businesses/:id', asyncRoute(async (req, res) => {
    const { data, error } = await requireSupabase()
      .from('businesses')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Business not found.' });
    res.json({ ok: true, message: 'Business removed from portfolio.', id: req.params.id });
  }));

  app.get('/api/simulations', asyncRoute(async (_req, res) => {
    const { data, error } = await requireSupabase()
      .from('simulations')
      .select(SIMULATION_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ data: (data || []).map(mapSimulation) });
  }));

  app.post('/api/simulations', asyncRoute(async (req, res) => {
    const { businessId, hazard, level, levels } = req.body || {};
    if (typeof businessId !== 'string' || !businessId) {
      return res.status(400).json({ error: 'A business ID is required.' });
    }
    const db = requireSupabase();
    const { data: business, error: businessError } = await db
      .from('businesses')
      .select(BUSINESS_COLUMNS)
      .eq('id', businessId)
      .maybeSingle();
    if (businessError) throw businessError;
    if (!business) return res.status(404).json({ error: 'Business not found. Please select a valid business.' });

    const scenario = { ...business };
    let changed = false;
    if (levels && typeof levels === 'object' && !Array.isArray(levels)) {
      for (const key of HAZARDS) {
        if (levels[key] !== undefined) {
          if (!isScore(levels[key])) return res.status(400).json({ error: `Scenario ${key} score must be an integer between 0 and 100.` });
          scenario[key] = Number(levels[key]);
          changed = true;
        }
      }
    } else if (HAZARDS.includes(hazard) && isScore(level)) {
      scenario[hazard] = Number(level);
      changed = true;
    }
    if (!changed) return res.status(400).json({ error: 'Provide a valid hazard and score level between 0 and 100.' });

    const baselineScore = riskFor(business).score;
    const scenarioScore = riskFor(scenario).score;
    const simulation = {
      id: `sim_${crypto.randomUUID()}`,
      business_id: business.id,
      business_name: business.name,
      hazard: hazard || (levels ? 'multi-hazard' : hazard),
      baseline_score: baselineScore,
      scenario_score: scenarioScore,
      difference: scenarioScore - baselineScore
    };
    const { data, error } = await db
      .from('simulations')
      .insert(simulation)
      .select(SIMULATION_COLUMNS)
      .single();
    if (error) throw error;
    res.status(201).json({ data: mapSimulation(data) });
  }));

  app.get('/api/alerts', asyncRoute(async (_req, res) => {
    res.json({ data: getAlerts(await getBusinesses()) });
  }));

  app.patch('/api/alerts/:id', asyncRoute(async (req, res) => {
    const { status } = req.body || {};
    if (!['Open', 'Monitoring', 'Resolved'].includes(status)) {
      return res.status(400).json({ error: 'Status must be Open, Monitoring, or Resolved.' });
    }
    const alert = getAlerts(await getBusinesses()).find(item => item.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found.' });
    alertStatuses.set(req.params.id, status);
    res.json({ data: { ...alert, status, updatedAt: new Date().toISOString() } });
  }));

  app.get('/api/dashboard/summary', asyncRoute(async (_req, res) => {
    const businesses = (await getBusinesses()).map(enrichBusiness);
    const counts = {
      low: businesses.filter(business => business.band === 'Low').length,
      moderate: businesses.filter(business => business.band === 'Moderate').length,
      elevated: businesses.filter(business => business.band === 'Elevated').length,
      high: businesses.filter(business => business.band === 'High').length
    };
    const scores = businesses.map(business => business.score);
    res.json({
      total: businesses.length,
      averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
      highRisk: counts.high,
      elevatedOrHigh: counts.elevated + counts.high,
      counts,
      timestamp: new Date().toISOString()
    });
  }));

  app.get('/api/reports/portfolio', asyncRoute(async (_req, res) => {
    const db = requireSupabase();
    const [businesses, simulationsResult] = await Promise.all([
      getBusinesses(),
      db.from('simulations').select('id', { count: 'exact', head: true })
    ]);
    if (simulationsResult.error) throw simulationsResult.error;
    const records = businesses.map(enrichBusiness);
    const averageScore = records.length
      ? Math.round(records.reduce((sum, business) => sum + business.score, 0) / records.length)
      : 0;
    res.json({
      generatedAt: new Date().toISOString(),
      methodology: 'Deterministic screening heuristic: 40% financial vulnerability + 60% climate hazard average (flood, heat, water).',
      summary: {
        total: records.length,
        averageScore,
        highRisk: records.filter(business => business.band === 'High').length,
        elevatedRisk: records.filter(business => business.band === 'Elevated').length,
        moderateRisk: records.filter(business => business.band === 'Moderate').length,
        lowRisk: records.filter(business => business.band === 'Low').length
      },
      businesses: records,
      simulationsCount: simulationsResult.count || 0
    });
  }));

  app.get('/api/reports/portfolio.csv', asyncRoute(async (_req, res) => {
    const businesses = (await getBusinesses()).map(enrichBusiness);
    const columns = ['id', 'name', 'type', 'city', 'state', 'fin', 'flood', 'heat', 'water', 'score', 'band', 'climateAverage', 'assessed', 'isDemo'];
    const headers = ['ID', 'Business Name', 'Industry', 'City', 'State', 'Financial Vulnerability', 'Flood Risk', 'Heat Risk', 'Water Stress', 'Overall Score', 'Risk Classification', 'Climate Exposure Avg', 'Last Assessed Date', 'Demo Data'];
    const rows = [headers.join(','), ...businesses.map(business => columns.map(column => csvCell(business[column])).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="climateshield-portfolio.csv"');
    res.send('\uFEFF' + rows.join('\r\n'));
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: `Unknown API route: ${req.method} ${req.path}` }));
  app.use(handleError);
  return app;
}

const app = createApp();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ClimateShield AI running at http://localhost:${PORT}`);
  });
}

Object.assign(app, { app, createApp, enrichBusiness, mapSimulation, riskFor });
module.exports = app;
