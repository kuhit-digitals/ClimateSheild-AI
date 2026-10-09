'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../server');

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.operation = 'select';
    this.filters = [];
    this.columns = '*';
    this.options = {};
    this.values = null;
    this.sort = null;
    this.singleResult = null;
  }

  select(columns = '*', options = {}) {
    this.columns = columns;
    this.options = options;
    return this;
  }

  insert(values) {
    this.operation = 'insert';
    this.values = values;
    return this;
  }

  update(values) {
    this.operation = 'update';
    this.values = values;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  order(column, { ascending }) {
    this.sort = [column, ascending];
    return this;
  }

  maybeSingle() {
    this.singleResult = 'maybe';
    return this.execute();
  }

  single() {
    this.singleResult = 'single';
    return this.execute();
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    const rows = this.database[this.table];
    const matches = row => this.filters.every(([column, value]) => row[column] === value);
    let result = [];

    if (this.operation === 'insert') {
      const values = Array.isArray(this.values) ? this.values : [this.values];
      result = values.map(value => {
        const row = {
          ...value,
          created_at: value.created_at || new Date().toISOString()
        };
        rows.push(row);
        return row;
      });
    } else if (this.operation === 'update') {
      result = rows.filter(matches);
      result.forEach(row => Object.assign(row, this.values));
    } else if (this.operation === 'delete') {
      result = rows.filter(matches);
      this.database[this.table] = rows.filter(row => !matches(row));
      if (this.table === 'businesses') {
        const deleted = new Set(result.map(row => row.id));
        this.database.simulations = this.database.simulations.filter(row => !deleted.has(row.business_id));
      }
    } else {
      result = rows.filter(matches);
    }

    if (this.sort) {
      const [column, ascending] = this.sort;
      result.sort((a, b) => String(a[column] || '').localeCompare(String(b[column] || '')) * (ascending ? 1 : -1));
    }

    if (this.options.head) return { data: null, count: result.length, error: null };
    const projected = result.map(row => {
      if (this.columns === '*') return { ...row };
      const columns = this.columns.split(',').map(column => column.trim());
      return Object.fromEntries(columns.filter(column => column in row).map(column => [column, row[column]]));
    });
    if (this.singleResult) {
      return { data: projected[0] || null, error: null };
    }
    return { data: projected, count: result.length, error: null };
  }
}

class FakeSupabase {
  constructor() {
    this.database = { businesses: [], simulations: [] };
  }

  from(table) {
    return new FakeQuery(this.database, table);
  }
}

let server;
let baseUrl;
let database;

before(async () => {
  database = new FakeSupabase();
  server = createApp(database).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function request(endpoint, options) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) }
  });
  const body = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

test('business create, list, read, update, summaries, export, and delete use the saved table rows', async () => {
  const created = await request('/api/businesses', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Northwind Foods',
      type: 'Food processing',
      city: 'Pune',
      state: 'Maharashtra',
      fin: 50,
      flood: 80,
      heat: 60,
      water: 40,
      context: 'Ground-floor inventory'
    })
  });

  assert.equal(created.response.status, 201);
  assert.match(created.body.data.id, /^biz_[0-9a-f-]{36}$/);
  assert.equal(created.body.data.score, 56);
  assert.equal(created.body.data.climateAverage, 60);
  assert.equal(created.body.data.band, 'Elevated');
  assert.equal(created.body.data.isDemo, false);
  const health = await request('/api/health');
  assert.equal(health.body.storage, 'Supabase');
  assert.equal(health.body.businesses, 1);
  assert.deepEqual(Object.keys(database.database.businesses[0]).sort(), [
    'assessed', 'city', 'context', 'created_at', 'fin', 'flood', 'heat', 'id',
    'is_demo', 'name', 'state', 'type', 'water'
  ]);

  const id = created.body.data.id;
  const listed = await request('/api/businesses');
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.data[0].id, id);

  const read = await request(`/api/businesses/${id}`);
  assert.equal(read.response.status, 200);
  assert.equal(read.body.data.name, 'Northwind Foods');

  const updated = await request(`/api/businesses/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ flood: 100, name: 'Northwind Foods Updated' })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.data.name, 'Northwind Foods Updated');
  assert.equal(updated.body.data.flood, 100);

  const alerts = await request('/api/alerts');
  assert.equal(alerts.body.data[0].businessIds[0], id);
  const alertId = alerts.body.data[0].id;
  const alertUpdate = await request(`/api/alerts/${encodeURIComponent(alertId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Monitoring' })
  });
  assert.equal(alertUpdate.body.data.status, 'Monitoring');

  const summary = await request('/api/dashboard/summary');
  const report = await request('/api/reports/portfolio');
  const csv = await request('/api/reports/portfolio.csv');
  assert.equal(summary.body.total, listed.body.count);
  assert.equal(report.body.summary.total, listed.body.count);
  assert.equal(report.body.businesses[0].id, id);
  assert.match(csv.body, /Northwind Foods Updated/);
  assert.match(csv.body, /Climate Exposure Avg/);

  const removed = await request(`/api/businesses/${id}`, { method: 'DELETE' });
  assert.equal(removed.response.status, 200);
  assert.equal((await request('/api/businesses')).body.count, 0);
  assert.equal((await request(`/api/businesses/${id}`)).response.status, 404);
});

test('simulations persist only existing schema columns and return the window.dataService shape', async () => {
  const business = await request('/api/businesses', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Scenario Test',
      type: 'Manufacturing',
      city: 'Surat',
      state: 'Gujarat',
      fin: 40,
      flood: 30,
      heat: 50,
      water: 70
    })
  });

  const simulation = await request('/api/simulations', {
    method: 'POST',
    body: JSON.stringify({ businessId: business.body.data.id, levels: { flood: 90, water: 80 } })
  });
  assert.equal(simulation.response.status, 201);
  assert.equal(simulation.body.data.businessId, business.body.data.id);
  assert.equal(simulation.body.data.baselineScore, 46);
  assert.equal(simulation.body.data.scenarioScore, 60);
  assert.equal(simulation.body.data.difference, 14);
  assert.deepEqual(Object.keys(database.database.simulations[0]).sort(), [
    'baseline_score', 'business_id', 'business_name', 'created_at', 'difference',
    'hazard', 'id', 'scenario_score'
  ]);

  const simulations = await request('/api/simulations');
  assert.equal(simulations.body.data[0].id, simulation.body.data.id);
  assert.equal(simulations.body.data[0].businessName, 'Scenario Test');

  await request(`/api/businesses/${business.body.data.id}`, { method: 'DELETE' });
  assert.equal((await request('/api/simulations')).body.data.length, 0);
});

test('invalid business input is rejected and missing credentials are reported explicitly', async () => {
  const invalid = await request('/api/businesses', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bad Scores', type: 'Retail', city: 'Pune', fin: 101, flood: 0, heat: 0, water: 0 })
  });
  assert.equal(invalid.response.status, 400);
  const envFile = await fetch(`${baseUrl}/.env`);
  assert.equal(envFile.status, 404);

  const unconfigured = createApp(null);
  const temporaryServer = unconfigured.listen(0);
  await new Promise(resolve => temporaryServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${temporaryServer.address().port}/api/health`);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    await new Promise((resolve, reject) => temporaryServer.close(error => error ? reject(error) : resolve()));
  }
});
