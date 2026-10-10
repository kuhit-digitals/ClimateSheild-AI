/* ClimateShield AI — Enterprise Climate Risk Intelligence Dashboard
 * Full-stack implementation using centralized dataService abstraction.
 * All score calculations are 100% deterministic and auditable.
 */

(() => {
  'use strict';

  // Core weights and risk classifications
  const WEIGHTS = { fin: 0.4, climate: 0.6 };

  const BANDS = [
    { key: 'low',      label: 'Low',      range: '0–29',   desc: 'Limited vulnerability and exposure' },
    { key: 'moderate', label: 'Moderate', range: '30–49',  desc: 'Moderate exposure; routine monitoring' },
    { key: 'elevated', label: 'Elevated', range: '50–69',  desc: 'Elevated exposure; mitigation review recommended' },
    { key: 'high',     label: 'High',     range: '70–100', desc: 'High exposure; immediate underwriting review' }
  ];

  const HAZARD_KEYS = ['flood', 'heat', 'water'];

  const FACTOR_INFO = {
    fin: {
      label: 'Financial vulnerability',
      short: 'Thin financial buffer',
      impact: 'Limited cash reserves restrict ability to absorb property damage, business interruption, and inventory loss.',
      mitigation: 'Establish a contingency emergency credit facility, evaluate debt restructuring, and build working-capital reserves.'
    },
    flood: {
      label: 'Flood exposure',
      short: 'Riverine & urban flood risk',
      impact: 'Physical site inundation can destroy equipment, damage stock, and disrupt operations for multiple weeks.',
      mitigation: 'Elevate critical machinery, install perimeter flood barriers, verify adequate commercial flood insurance coverage.'
    },
    heat: {
      label: 'Extreme heat exposure',
      short: 'Extreme thermal stress',
      impact: 'Sustained heat waves degrade cooling efficiency, endanger worker safety, and spoil heat-sensitive perishable goods.',
      mitigation: 'Upgrade industrial thermal insulation, schedule shifts around peak heat hours, install redundant backup power.'
    },
    water: {
      label: 'Water scarcity exposure',
      short: 'Severe water stress & drought',
      impact: 'Regional water shortages constrain processing volume, escalate tanker logistics costs, and interrupt supply chains.',
      mitigation: 'Invest in onsite wastewater recycling, closed-loop water chillers, rainwater harvesting, and alternative utility sourcing.'
    }
  };

  const VIEWS = {
    overview:    { nav: 'overview',    title: 'Risk Overview',               subtitle: 'Portfolio climate vulnerability snapshot and underwriter metrics.' },
    assessments: { nav: 'assessments', title: 'Business Assessments',        subtitle: 'Manage borrower profiles, risk ratings, and localized hazard scores.' },
    simulator:   { nav: 'simulator',   title: 'Risk Simulator',              subtitle: 'Simulate climate stress-testing scenarios and quantify risk score changes.' },
    climate:     { nav: 'climate',     title: 'Climate Intelligence',        subtitle: 'Geographic and multi-hazard exposure across industrial clusters.' },
    alerts:      { nav: 'alerts',      title: 'Climate Alerts',              subtitle: 'Active portfolio hazard alerts generated from borrower vulnerability data.' },
    reports:     { nav: 'reports',     title: 'Portfolio Reports',           subtitle: 'Executive risk reports and RFC 4180 compliant CSV export.' },
    settings:    { nav: 'settings',    title: 'Settings & Methodology',      subtitle: 'Deterministic scoring algorithm reference and Supabase cloud setup.' }
  };

  // State management
  let BUSINESSES = [];
  let SIMULATIONS = [];
  let ALERTS = [];
  let STATS = {};
  let isEditing = false;
  let activeDetailId = null;
  let deleteTargetId = null;

  const state = {
    view: 'overview',
    query: '',
    type: 'all',
    risk: 'all',
    sort: 'score-desc',
    alertStatusFilter: 'all'
  };

  // DOM Helpers
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const show = v => (num(v) === null ? '—' : String(v));
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  function bandOf(score) {
    if (num(score) === null) return null;
    return score >= 70 ? BANDS[3] : score >= 50 ? BANDS[2] : score >= 30 ? BANDS[1] : BANDS[0];
  }

  function badge(band) {
    const b = band || { key: 'none', label: 'Not scored' };
    return `<span class="badge b-${b.key}"><span class="badge-dot" aria-hidden="true"></span>${esc(b.label)}</span>`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function meterCell(value) {
    const band = bandOf(value);
    if (!band) return '<span class="muted">—</span>';
    return `<div class="meter-cell b-${band.key}">
      <div class="meter-top"><span class="meter-num">${value}</span><span class="meter-word">${band.label}</span></div>
      <div class="meter" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, value))}%"></i></div>
    </div>`;
  }

  // Toast Notification System
  function showToast(message, type = 'info') {
    const container = $('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${esc(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'opacity 0.25s, transform 0.25s';
      setTimeout(() => toast.remove(), 250);
    }, 3800);
  }

  // Compute aggregate metrics from live BUSINESSES dataset
  function computeStats() {
    const scored = BUSINESSES.filter(b => b.score !== null);
    const alertedIds = new Set(ALERTS.filter(a => a.status !== 'Resolved').flatMap(a => a.businessIds || []));
    const counts = Object.fromEntries(BANDS.map(b => [b.key, scored.filter(x => x.band && x.band.key === b.key).length]));
    const avg = scored.length ? Math.round(scored.reduce((s, b) => s + b.score, 0) / scored.length) : null;

    const hazards = HAZARD_KEYS.map(k => {
      const vals = BUSINESSES.map(b => b[k]).filter(v => v !== null);
      const bandCounts = Object.fromEntries(BANDS.map(b => [b.key, vals.filter(v => bandOf(v) && bandOf(v).key === b.key).length]));
      return {
        key: k,
        n: vals.length,
        avg: vals.length ? Math.round(vals.reduce((a, c) => a + c, 0) / vals.length) : null,
        bandCounts
      };
    });

    const cities = [...new Set(BUSINESSES.map(b => b.city).filter(Boolean))];
    const types = [...new Set(BUSINESSES.map(b => b.type).filter(Boolean))];

    return {
      total: BUSINESSES.length,
      assessed: scored.length,
      high: counts.high || 0,
      elevated: counts.elevated || 0,
      moderate: counts.moderate || 0,
      low: counts.low || 0,
      alerted: BUSINESSES.filter(b => alertedIds.has(b.id)).length,
      avg,
      counts,
      hazards,
      cities,
      types
    };
  }

  // Enrich raw business object with computed scores and relations
  function enrich(b) {
    const values = HAZARD_KEYS.map(k => num(b[k])).filter(v => v !== null);
    const exposure = values.length ? Math.round(values.reduce((a, c) => a + c, 0) / values.length) : null;
    const fin = num(b.fin);
    const score = fin !== null && exposure !== null ? Math.min(100, Math.max(0, Math.round(WEIGHTS.fin * fin + WEIGHTS.climate * exposure))) : null;
    return {
      ...b,
      fin,
      exposure,
      score,
      flood: num(b.flood),
      heat: num(b.heat),
      water: num(b.water),
      band: bandOf(score),
      isDemo: Boolean(b.isDemo),
      location: [b.city, b.state].filter(Boolean).join(', '),
      alerts: ALERTS.filter(a => Array.isArray(a.businessIds) && a.businessIds.includes(b.id))
    };
  }

  // ---------------------------------------------------------------------------
  // Data Loading and Refreshing
  // ---------------------------------------------------------------------------

  async function loadData() {
    try {
      const health = await window.dataService.checkHealth();
      updateApiStatus(health);

      const [businessesData, simulationsData, alertsData] = await Promise.all([
        window.dataService.getBusinesses(),
        window.dataService.getSimulations(),
        window.dataService.getAlerts()
      ]);

      
ALERTS = alertsData;
BUSINESSES = businessesData.map(enrich);
SIMULATIONS = simulationsData;
STATS = computeStats();

refreshAllUI();

// Ensure the simulator receives the loaded business records.
renderSimulator();
    } catch (err) {
      console.error('Data loading error:', err);
      updateApiStatus({ ok: false, error: err.message });
      showToast('Could not load portfolio data from the backend.', 'error');
    }
  }

  function updateApiStatus(health) {
    const pill = $('apiStatusPill');
    const text = $('apiStatusText');
    if (!pill || !text) return;
    if (health && health.ok) {
      pill.className = 'api-pill is-connected';
      text.textContent = `Live API Connected (${health.data?.businesses ?? BUSINESSES.length})`;
      pill.title = 'Backend API is available on this deployment.';
    } else {
      pill.className = 'api-pill is-offline';
      text.textContent = 'Supabase API Offline';
      pill.title = 'Check the backend and local Supabase configuration.';
    }
  }

  function refreshAllUI() {
    STATS = computeStats();
    renderMetrics();
    renderLegend();
    renderGaugeAndWatchlist();
    renderDistribution();
    renderHazards();
    renderLocations();
    renderAssessmentsTable();
    renderOverviewAlerts();
    renderFullAlerts();
    renderSimulator();
    renderReports();
    syncControls();
  }

  // ---------------------------------------------------------------------------
  // UI Renderers
  // ---------------------------------------------------------------------------

  function renderMetrics() {
    const avgBand = bandOf(STATS.avg);
    const cards = [
      { cls: 'is-neutral', label: 'Businesses Assessed', value: STATS.assessed, sub: `${STATS.cities.length} locations · ${STATS.types.length} sectors` },
      { cls: 'is-high',    label: 'High-Risk MSMEs',    value: STATS.high, sub: `${pct(STATS.high, STATS.assessed)}% of assessed portfolio` },
      { cls: 'is-alert',   label: 'With Climate Alerts', value: STATS.alerted, sub: `${ALERTS.filter(a => a.status !== 'Resolved').length} active alerts · ${pct(STATS.alerted, STATS.assessed)}% affected` },
      { cls: 'is-avg',     label: 'Average Risk Score',  value: show(STATS.avg), suffix: '/100', sub: avgBand ? badge(avgBand) + '<span>portfolio avg</span>' : '' }
    ];

    const html = cards.map(c => `
      <article class="card metric ${c.cls}">
        <div class="metric-top"><span class="metric-label">${c.label}</span><span class="tag-demo">Live</span></div>
        <div class="metric-value">${c.value}${c.suffix ? `<small>${c.suffix}</small>` : ''}</div>
        <div class="metric-sub">${c.sub}</div>
      </article>`).join('');

    $('metricCards').innerHTML = html;
    if ($('reportMetricCards')) $('reportMetricCards').innerHTML = html;

    const notifCount = ALERTS.filter(a => a.status !== 'Resolved').length;
    $('notifCount').textContent = notifCount;
    $('notifBtn').setAttribute('aria-label', `Notifications: ${notifCount} active climate alerts`);
  }

  function renderLegend() {
    $('legend').innerHTML = `<span class="legend-title">Risk Scale (0–100):</span>` +
      BANDS.map(b => `<span class="legend-item b-${b.key}"><span class="sw" aria-hidden="true"></span><strong>${b.label}</strong> ${b.range}</span>`).join('') +
      `<span>Formula: 40% financial vulnerability + 60% average climate hazard.</span>`;
  }

  function renderGaugeAndWatchlist() {
    const avg = STATS.avg ?? 0;
    const avgBand = bandOf(avg);
    const P = s => { const t = Math.PI * (1 - s / 100); return `${(100 + 80 * Math.cos(t)).toFixed(1)} ${(100 - 80 * Math.sin(t)).toFixed(1)}`; };
    const arc = (a, b, c) => `<path class="g-arc" d="M${P(a)} A80 80 0 0 1 ${P(b)}" stroke="var(--${c}-bar)"/>`;

    const gaugeHtml = Number.isFinite(avg) ? `
      <div class="gauge">
        <svg viewBox="0 0 200 118" role="img" aria-label="Average portfolio risk score ${avg} out of 100">
          ${arc(0, 29.5, 'low')}${arc(30.5, 49.5, 'mod')}${arc(50.5, 69.5, 'elev')}${arc(70.5, 100, 'high')}
          <g class="needle" style="transform:rotate(${(avg / 100) * 180 - 90}deg)"><line x1="100" y1="100" x2="100" y2="34"/><circle cx="100" cy="100" r="5"/></g>
          <text x="16" y="116">0</text><text x="184" y="116" text-anchor="end">100</text>
        </svg>
        <div class="gauge-val">${avg}<small>/100</small></div>
        ${avgBand ? badge(avgBand) : ''}
        <p class="hint">Weighted portfolio average across all assessed accounts.</p>
      </div>` : '<div class="empty">No scored businesses available.</div>';

    $('gaugeMount').innerHTML = gaugeHtml;

    // Top 5 highest risk businesses
    const sorted = [...BUSINESSES].filter(b => b.score !== null).sort((a, b) => b.score - a.score).slice(0, 5);
    const watchHtml = sorted.length ? sorted.map((b, i) => `
      <li>
        <button type="button" class="watch-row b-${b.band?.key || 'none'}" data-detail="${esc(b.id)}">
          <span class="watch-rank">${i + 1}</span>
          <span class="watch-main">
            <strong>${esc(b.name)} ${b.isDemo ? '<span class="tag-source-demo">DEMO</span>' : '<span class="tag-saved">SAVED</span>'}</strong>
            <small>${esc(b.type)} · ${esc(b.location || b.city)}</small>
            <span class="meter" aria-hidden="true"><i style="width:${b.score}%"></i></span>
          </span>
          <span class="watch-score">
            ${badge(b.band)}<b>${b.score}</b>
          </span>
        </button>
      </li>`).join('') : '<li class="empty">No businesses scored yet.</li>';

    $('watchlistMount').innerHTML = watchHtml;
  }

  function renderDistribution() {
    $('distSub').textContent = `Overall risk category · ${STATS.assessed} assessed MSMEs`;
    if (!STATS.assessed) {
      $('distChart').innerHTML = '<div class="empty">No scored businesses.</div>';
      return;
    }

    const R = 48, C = 2 * Math.PI * R, gap = 2;
    let offset = 0;
    const segs = BANDS.map(b => {
      const n = STATS.counts[b.key] || 0;
      if (!n) return '';
      const len = (n / STATS.assessed) * C;
      const draw = Math.max(len - gap, 0.5);
      const svg = `<circle class="seg b-${b.key}" cx="60" cy="60" r="${R}" stroke-dasharray="${draw.toFixed(2)} ${(C - draw).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${b.label}: ${n} of ${STATS.assessed} businesses (${pct(n, STATS.assessed)}%)</title></circle>`;
      offset += len;
      return svg;
    }).join('');

    const rows = BANDS.map(b => `
      <button type="button" class="dist-row b-${b.key}" data-filter-risk="${b.key}" title="Filter table to ${b.label} risk">
        <span class="sw" aria-hidden="true"></span>
        <span class="name">${b.label}<small>Score ${b.range}</small></span>
        <span class="count">${STATS.counts[b.key] || 0}</span>
        <span class="pct">${pct(STATS.counts[b.key] || 0, STATS.assessed)}%</span>
      </button>`).join('');

    $('distChart').innerHTML = `
      <div class="dist">
        <svg class="donut" viewBox="0 0 120 120" role="img" aria-label="Donut chart of ${STATS.assessed} businesses by overall risk category">
          <circle class="track" cx="60" cy="60" r="${R}"/>
          <g transform="rotate(-90 60 60)">${segs}</g>
          <text class="d-total" x="60" y="62">${STATS.assessed}</text>
          <text class="d-label" x="60" y="75">MSMEs</text>
        </svg>
        <div class="dist-list">${rows}</div>
      </div>
      <p class="hint">Click any category to filter the business table below.</p>`;
  }

  function renderHazards() {
    const rows = STATS.hazards.map(h => {
      const info = FACTOR_INFO[h.key];
      const band = bandOf(h.avg);
      const segs = BANDS.filter(b => h.bandCounts[b.key]).map(b =>
        `<i class="b-${b.key}" style="flex:${h.bandCounts[b.key]}" title="${info.label}: ${h.bandCounts[b.key]} of ${h.n} businesses at ${b.label} exposure"></i>`).join('');
      const caption = BANDS.map(b => `<span class="b-${b.key}"><span class="sw" aria-hidden="true"></span>${b.label} <b>${h.bandCounts[b.key]}</b></span>`).join('');
      return `<div>
        <div class="haz-head">
          <span class="haz-name">${info.label}</span>
          <span class="haz-avg">Portfolio Average: <strong>${show(h.avg)}</strong> ${band ? badge(band) : ''}</span>
        </div>
        <div class="stack" role="img" aria-label="${info.label}: ${BANDS.map(b => `${h.bandCounts[b.key]} ${b.label}`).join(', ')}">${segs}</div>
        <div class="stack-caption">${caption}</div>
      </div>`;
    }).join('');

    const top = [...STATS.hazards].filter(h => h.avg !== null).sort((a, b) => b.avg - a.avg)[0];
    const insight = top ? `<p class="insight">Critical Portfolio Driver: <strong>${FACTOR_INFO[top.key].label}</strong> exhibits the highest mean vulnerability across borrower facilities (${top.avg}/100).</p>` : '';
    
    $('hazardChart').innerHTML = `<div class="haz-list">${rows}</div>${insight}`;
    if ($('climateHazardChart')) $('climateHazardChart').innerHTML = `<div class="haz-list">${rows}</div>`;
  }

  function renderLocations() {
    const avg = (arr, k) => {
      const v = arr.map(b => b[k]).filter(x => x !== null);
      return v.length ? Math.round(v.reduce((a, c) => a + c, 0) / v.length) : null;
    };

    const rows = STATS.cities.map(city => {
      const list = BUSINESSES.filter(b => b.city === city);
      const sc = avg(list, 'score');
      return `<tr>
        <td class="cell-name" data-label="Location"><span class="biz-name">${esc(city)}</span></td>
        <td data-label="Businesses" class="num">${list.length}</td>
        <td data-label="Flood Exposure">${meterCell(avg(list, 'flood'))}</td>
        <td data-label="Extreme Heat">${meterCell(avg(list, 'heat'))}</td>
        <td data-label="Water Scarcity">${meterCell(avg(list, 'water'))}</td>
        <td data-label="Avg Risk Score">${sc === null ? '—' : `<span class="score-pair">${badge(bandOf(sc))}<span class="muted num">Score ${sc}</span></span>`}</td>
      </tr>`;
    }).join('');

    $('locationTable').innerHTML = `<div class="table-wrap"><table class="data-table">
      <caption class="sr-only">Average hazard exposure by geographic location</caption>
      <thead><tr>
        <th scope="col">Geographic Cluster</th>
        <th scope="col">Borrowers</th>
        <th scope="col">Flood Exposure</th>
        <th scope="col">Extreme Heat</th>
        <th scope="col">Water Scarcity</th>
        <th scope="col">Average Risk</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">No location data.</td></tr>'}</tbody>
    </table></div>`;
  }

  // Filter and sort businesses
  function visibleBusinesses() {
    const terms = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = BUSINESSES.filter(b => {
      if (state.risk !== 'all' && (!b.band || b.band.key !== state.risk)) return false;
      if (state.type !== 'all' && b.type !== state.type) return false;
      const hay = [b.name, b.type, b.city, b.state].join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });

    const nullsLast = (a, b, dir) => (a === null ? 1 : b === null ? -1 : dir * (a - b));
    const sorters = {
      'score-desc': (a, b) => nullsLast(a.score, b.score, -1),
      'score-asc':  (a, b) => nullsLast(a.score, b.score, 1),
      'name':       (a, b) => (a.name || '').localeCompare(b.name || ''),
      'date':       (a, b) => (b.assessed || '').localeCompare(a.assessed || '')
    };
    return rows.sort(sorters[state.sort] || sorters['score-desc']);
  }

  function renderAssessmentsTable() {
    // Populate Industry / Sector Filter dropdown dynamically
    const typeSelect = $('typeFilter');
    if (typeSelect) {
      const currentVal = state.type;
      const types = [...new Set(BUSINESSES.map(b => b.type).filter(Boolean))].sort();
      typeSelect.innerHTML = `<option value="all">All Sectors (${BUSINESSES.length})</option>` +
        types.map(t => `<option value="${esc(t)}" ${t === currentVal ? 'selected' : ''}>${esc(t)} (${BUSINESSES.filter(b => b.type === t).length})</option>`).join('');
    }

    const rows = visibleBusinesses();
    $('tblSub').textContent = `${BUSINESSES.length} Total Accounts · Deterministic Risk Classification`;
    $('resultCount').textContent = `Showing ${rows.length} of ${BUSINESSES.length} businesses in portfolio`;

    if (!rows.length) {
      const q = state.query.trim();
      $('tableMount').innerHTML = `<div class="empty">
        <strong>No businesses match criteria</strong>
        <span>${q ? `Nothing matches “${esc(q)}”` : 'No businesses meet the selected category or sector filters'}.</span>
        <button type="button" class="btn btn-sm btn-primary" data-clear-filters style="margin-top:8px;">Clear Search &amp; Filters</button>
      </div>`;
      return;
    }

    const body = rows.map(b => `<tr>
      <td class="cell-name" data-label="Business">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="biz-name">${esc(b.name)}</span>
          ${b.isDemo ? '<span class="tag-source-demo" title="Seed sample business">DEMO</span>' : '<span class="tag-saved" title="Saved borrower record">SAVED</span>'}
        </div>
        ${b.alerts.length ? `<span class="biz-alert">${b.alerts.length} active alert${b.alerts.length > 1 ? 's' : ''}</span>` : ''}
      </td>
      <td data-label="Industry">${esc(b.type || '—')}</td>
      <td data-label="Location">${esc(b.location || b.city || '—')}</td>
      <td data-label="Financial Vulnerability">${meterCell(b.fin)}</td>
      <td data-label="Climate Exposure">${meterCell(b.exposure)}</td>
      <td data-label="Overall Risk">
        <span class="score-pair">${badge(b.band)}<span class="muted num">Score <b>${show(b.score)}</b>/100</span></span>
      </td>
      <td data-label="Last Assessed" class="num">${fmtDate(b.assessed)}</td>
      <td data-label="Actions">
        <div class="action-group">
          <button type="button" class="btn btn-sm btn-outline" data-detail="${esc(b.id)}" title="Inspect detailed assessment">View</button>
          <button type="button" class="btn btn-sm btn-outline" data-edit="${esc(b.id)}" title="Edit assessment inputs">Edit</button>
          <button type="button" class="btn btn-sm btn-outline btn-icon is-delete" data-delete="${esc(b.id)}" title="Delete business assessment" aria-label="Delete ${esc(b.name)}">
            <svg class="icon"><use href="#i-trash"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');

    $('tableMount').innerHTML = `<div class="table-wrap"><table class="data-table">
      <caption class="sr-only">MSME Climate Risk Portfolio Assessments</caption>
      <thead><tr>
        <th scope="col">Borrower Entity</th>
        <th scope="col">Industry / Sector</th>
        <th scope="col">Location</th>
        <th scope="col">Financial Vulnerability</th>
        <th scope="col">Climate Exposure Avg</th>
        <th scope="col">Overall Risk</th>
        <th scope="col">Last Assessed</th>
        <th scope="col"><span class="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  function renderOverviewAlerts() {
    const list = $('overviewAlertsList');
    if (!list) return;
    const active = ALERTS.filter(a => a.status !== 'Resolved').slice(0, 3);
    if (!active.length) {
      list.innerHTML = '<li class="empty">No active climate risk alerts.</li>';
      return;
    }
    list.innerHTML = active.map(a => {
      const band = BANDS.find(b => b.key === a.level) || BANDS[1];
      const count = Array.isArray(a.businessIds) ? a.businessIds.length : 0;
      return `<li class="alert b-${a.level || 'moderate'}">
        <div class="alert-top">${badge(band)}<span class="tag-demo">${esc(a.status || 'Open')}</span></div>
        <p class="alert-title">${esc(a.title)}</p>
        <p class="alert-meta">${esc(a.region || 'Portfolio')} · ${count} affected MSME borrower${count === 1 ? '' : 's'}</p>
        <p>${esc(a.summary)}</p>
      </li>`;
    }).join('');
  }

  function renderFullAlerts() {
    const list = $('fullAlertsList');
    if (!list) return;

    let items = [...ALERTS];
    if (state.alertStatusFilter !== 'all') {
      items = items.filter(a => a.status === state.alertStatusFilter);
    }

    if (!items.length) {
      list.innerHTML = '<li class="empty">No alerts match the selected status filter.</li>';
      return;
    }

    list.innerHTML = items.map(a => {
      const band = BANDS.find(b => b.key === a.level) || BANDS[1];
      const linked = (a.businessIds || []).map(id => BUSINESSES.find(b => b.id === id)).filter(Boolean);
      const bizLinks = linked.map(b => `<button type="button" class="link-btn" data-detail="${esc(b.id)}">${esc(b.name)}</button>`).join(', ');

      return `<li class="alert b-${a.level || 'moderate'}">
        <div class="alert-top" style="justify-content:space-between;width:100%;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${badge(band)}
            <span class="tag-demo">Status: <b>${esc(a.status || 'Open')}</b></span>
          </div>
          <div class="action-group">
            <button type="button" class="btn btn-sm ${a.status === 'Open' ? 'btn-primary' : 'btn-outline'}" data-alert-status="${esc(a.id)}" data-new-status="Open">Open</button>
            <button type="button" class="btn btn-sm ${a.status === 'Monitoring' ? 'btn-primary' : 'btn-outline'}" data-alert-status="${esc(a.id)}" data-new-status="Monitoring">Monitoring</button>
            <button type="button" class="btn btn-sm ${a.status === 'Resolved' ? 'btn-primary' : 'btn-outline'}" data-alert-status="${esc(a.id)}" data-new-status="Resolved">Resolved</button>
          </div>
        </div>
        <p class="alert-title">${esc(a.title)}</p>
        <p class="alert-meta">${esc(a.region)} · Dimension: ${FACTOR_INFO[a.hazard]?.label || 'General'}</p>
        <p>${esc(a.summary)}</p>
        <div class="alert-biz" style="margin-top:6px;">
          <span>Affected MSME Borrowers (${linked.length}):</span>
          ${bizLinks || '<span class="muted">None currently linked</span>'}
        </div>
      </li>`;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Risk Simulator View
  // ---------------------------------------------------------------------------

  let currentSimBusiness = null;

  function renderSimulator() {
    const select = $('simSelectBusiness');
    if (!select) return;

    const previousId = select.value;
    select.innerHTML = '<option value="">-- Select an MSME Borrower --</option>' +
      BUSINESSES.map(b => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(b.type)} - ${esc(b.city)}) — Baseline: ${b.score}/100</option>`).join('');

    if (previousId && BUSINESSES.some(b => b.id === previousId)) {
      select.value = previousId;
      selectBusinessForSim(previousId);
    } else if (BUSINESSES.length) {
      select.value = BUSINESSES[0].id;
      selectBusinessForSim(BUSINESSES[0].id);
    }

    renderSimHistory();
  }

  function selectBusinessForSim(id) {
    currentSimBusiness = BUSINESSES.find(b => b.id === id);
    if (!currentSimBusiness) return;

    $('simBizNameDisplay').textContent = `${currentSimBusiness.name} — Stress Test`;
    $('simBizMetaDisplay').textContent = `${currentSimBusiness.type} · ${currentSimBusiness.location} (Baseline: ${currentSimBusiness.score}/100)`;

    // Set sliders to baseline values
    $('simFlood').value = currentSimBusiness.flood ?? 50;
    $('simFloodVal').textContent = currentSimBusiness.flood ?? 50;

    $('simHeat').value = currentSimBusiness.heat ?? 50;
    $('simHeatVal').textContent = currentSimBusiness.heat ?? 50;

    $('simWater').value = currentSimBusiness.water ?? 50;
    $('simWaterVal').textContent = currentSimBusiness.water ?? 50;

    $('simFin').value = currentSimBusiness.fin ?? 50;
    $('simFinVal').textContent = currentSimBusiness.fin ?? 50;

    updateSimScenarioProjection();
  }

  function updateSimScenarioProjection() {
    if (!currentSimBusiness) return;

    const fin = Number($('simFin').value);
    const flood = Number($('simFlood').value);
    const heat = Number($('simHeat').value);
    const water = Number($('simWater').value);

    // Sync labels
    $('simFinVal').textContent = fin;
    $('simFloodVal').textContent = flood;
    $('simHeatVal').textContent = heat;
    $('simWaterVal').textContent = water;

    // Calculate baseline
    const baseScore = currentSimBusiness.score ?? 0;
    const baseBand = currentSimBusiness.band || bandOf(baseScore);

    // Calculate scenario
    const scenClimate = Math.round((flood + heat + water) / 3);
    const scenScore = Math.min(100, Math.max(0, Math.round(0.4 * fin + 0.6 * scenClimate)));
    const scenBand = bandOf(scenScore);

    $('simBaseScore').innerHTML = `${baseScore}<small>/100</small>`;
    $('simBaseBand').innerHTML = badge(baseBand);

    $('simScenScore').innerHTML = `${scenScore}<small>/100</small>`;
    $('simScenBand').innerHTML = badge(scenBand);

    const delta = scenScore - baseScore;
    const deltaBadge = $('simDeltaBadge');
    if (delta > 0) {
      deltaBadge.className = 'sim-delta-badge is-increase';
      deltaBadge.textContent = `▲ +${delta} Points Risk Increase (${scenBand.label})`;
    } else if (delta < 0) {
      deltaBadge.className = 'sim-delta-badge is-decrease';
      deltaBadge.textContent = `▼ ${delta} Points Risk Reduction (${scenBand.label})`;
    } else {
      deltaBadge.className = 'sim-delta-badge is-neutral';
      deltaBadge.textContent = `No Variance from Baseline (${scenBand.label})`;
    }

    let drivers = [];
    if (flood > (currentSimBusiness.flood ?? 0)) drivers.push(`Flood exposure heightened to ${flood}`);
    if (heat > (currentSimBusiness.heat ?? 0)) drivers.push(`Extreme heat heightened to ${heat}`);
    if (water > (currentSimBusiness.water ?? 0)) drivers.push(`Water scarcity heightened to ${water}`);
    if (fin > (currentSimBusiness.fin ?? 0)) drivers.push(`Financial vulnerability expanded to ${fin}`);

    $('simInsightText').innerHTML = drivers.length
      ? `<strong>Projected Drivers:</strong> ${drivers.join('; ')}. Under this stress-test scenario, overall borrower vulnerability shifts from ${baseScore} to ${scenScore}/100.`
      : `Baseline values loaded. Move sliders to evaluate hazard stress-testing.`;
  }

  function renderSimHistory() {
    const mount = $('simHistoryMount');
    if (!mount) return;
    if (!SIMULATIONS.length) {
      mount.innerHTML = '<p class="muted" style="font-size:12px;padding:8px 0;">No stress-test scenarios saved yet.</p>';
      return;
    }

    const html = SIMULATIONS.slice(0, 6).map(s => {
      const deltaClass = s.difference > 0 ? 'color:var(--high-fg);font-weight:700;' : s.difference < 0 ? 'color:var(--low-fg);font-weight:700;' : 'color:var(--muted);';
      const deltaStr = s.difference > 0 ? `+${s.difference}` : String(s.difference);
      return `<div class="sim-history-item">
        <div>
          <strong>${esc(s.businessName)}</strong>
          <small class="muted" style="display:block;">${fmtDate(s.createdAt)} · Tested: ${esc(s.hazard)}</small>
        </div>
        <div style="text-align:right;">
          <span>${s.baselineScore} ➔ <b>${s.scenarioScore}</b></span>
          <span style="${deltaClass};display:block;font-size:11px;">${deltaStr} pts</span>
        </div>
      </div>`;
    }).join('');

    mount.innerHTML = `<div class="sim-history-list">${html}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Reports View
  // ---------------------------------------------------------------------------

  function renderReports() {
    const tableMount = $('reportSectorTable');
    if (!tableMount) return;

    const sectors = [...new Set(BUSINESSES.map(b => b.type).filter(Boolean))];
    const sectorStats = sectors.map(sec => {
      const list = BUSINESSES.filter(b => b.type === sec);
      const scores = list.map(b => b.score).filter(s => s !== null);
      const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      const highCount = list.filter(b => b.band?.key === 'high').length;
      return { sector: sec, count: list.length, avg, highCount, band: bandOf(avg) };
    }).sort((a, b) => b.avg - a.avg);

    const rows = sectorStats.map(s => `<tr>
      <td class="cell-name"><strong>${esc(s.sector)}</strong></td>
      <td class="num">${s.count}</td>
      <td>${badge(s.band)}</td>
      <td class="num"><strong>${s.avg}</strong>/100</td>
      <td class="num">${s.highCount} (${pct(s.highCount, s.count)}%)</td>
    </tr>`).join('');

    tableMount.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Sector / Industry</th>
        <th>Portfolio MSMEs</th>
        <th>Average Risk Band</th>
        <th>Mean Risk Score</th>
        <th>High Risk Accounts</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">No sector data.</td></tr>'}</tbody>
    </table></div>`;
  }

  // ---------------------------------------------------------------------------
  // Business Detail Drawer
  // ---------------------------------------------------------------------------

  function renderDetail(b) {
    activeDetailId = b.id;
    const factors = rankFactors(b);
    const score = b.score;
    const band = b.band;

    const scale = score === null ? '' : `
      <div class="scale" aria-hidden="true">
        <span class="b-low" style="flex:30"></span><span class="b-moderate" style="flex:20"></span>
        <span class="b-elevated" style="flex:20"></span><span class="b-high" style="flex:30"></span>
        <span class="scale-marker" style="left:${score}%"></span>
      </div>
      <div class="scale-labels" aria-hidden="true">
        <span style="left:0">0</span><span style="left:30%">30</span><span style="left:50%">50</span><span style="left:70%">70</span><span style="left:100%">100</span>
      </div>`;

    const meterRow = (key, value) => {
      const bd = bandOf(value);
      return `<div class="meter-row ${bd ? 'b-' + bd.key : 'b-none'}">
        <span class="lbl">${FACTOR_INFO[key].label}</span>
        <span class="val"><span class="meter-num">${show(value)}</span><span class="meter-word">${bd ? bd.label : 'No data'}</span></span>
        <div class="meter" aria-hidden="true"><i style="width:${value ?? 0}%"></i></div>
      </div>`;
    };

    const explanation = score === null
      ? 'Insufficient inputs recorded to calculate deterministic risk score.'
      : `${b.name} carries a deterministic overall score of ${score}/100 (${band.label}). Calculated as 40% Financial Vulnerability (${b.fin}) + 60% Average Climate Exposure (${b.exposure}). ` +
        (factors.length >= 2 ? `Primary risk drivers are ${FACTOR_INFO[factors[0].key].label.toLowerCase()} and ${FACTOR_INFO[factors[1].key].label.toLowerCase()}. ` : '') +
        (b.context ? b.context : '');

    const factorHtml = factors.length ? factors.map(f => `
      <li class="factor"><div><strong>${FACTOR_INFO[f.key].short} · ${f.value}/100</strong>
        <span>≈ ${f.pts.toFixed(1)} of the ${score ?? '—'} points. Impact: ${FACTOR_INFO[f.key].impact}</span></div></li>`).join('')
      : '<li class="muted">No contributing factors available.</li>';

    const mitigations = factors.map(f => FACTOR_INFO[f.key].mitigation)
      .concat('Underwriters should verify asset elevation certificates and insurance exclusions.');

    const alertsHtml = b.alerts.length ? `
      <section class="d-section"><h3>Linked Portfolio Alerts</h3>
        <ul class="d-list">${b.alerts.map(a => `<li><strong>${esc(a.title)}</strong> (${esc(a.status || 'Open')})</li>`).join('')}</ul>
      </section>` : '';

    $('drawerTitle').textContent = b.name;
    $('drawerEyebrow').innerHTML = `Business Assessment · ${b.isDemo ? '<span class="tag-source-demo">DEMO DATA</span>' : '<span class="tag-saved">SAVED RECORD</span>'}`;
    $('drawerMeta').textContent = [b.type, b.location].filter(Boolean).join(' · ') || '—';

    $('drawerBody').innerHTML = `
      <div class="notice">${icon('info')}<span>Deterministic screening analysis. Calculated using 40% financial buffer + 60% hazard exposure average.</span></div>

      <section class="d-section" aria-label="Overall risk score">
        <div class="score-block ${band ? 'b-' + band.key : 'b-none'}">
          <div class="score-big">${show(score)}<small>/100</small></div>
          <div class="score-caption">${badge(band)}<span>Deterministic Portfolio Risk Score</span></div>
        </div>
        ${scale}
      </section>

      <section class="d-section">
        <h3>Component Vulnerabilities &amp; Climate Hazards</h3>
        <div class="meter-rows">
          ${meterRow('fin', b.fin)}
          ${meterRow('flood', b.flood)}
          ${meterRow('heat', b.heat)}
          ${meterRow('water', b.water)}
        </div>
      </section>

      <section class="d-section">
        <h3>Top Contributing Risk Drivers</h3>
        <ol class="factor-list">${factorHtml}</ol>
      </section>

      <section class="d-section">
        <h3>Underwriting Analysis &amp; Explanation</h3>
        <p class="d-text">${esc(explanation)}</p>
      </section>

      <section class="d-section">
        <h3>Recommended Risk Mitigation Actions</h3>
        <ul class="d-list">${mitigations.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
      </section>

      ${alertsHtml}

      <div style="margin-top:14px;display:flex;gap:10px;">
        <button type="button" class="btn btn-primary" id="drawerTestSimBtn">Test in Risk Simulator</button>
      </div>`;

    $('drawerTestSimBtn')?.addEventListener('click', () => {
      closeDetail();
      setView('simulator');
      selectBusinessForSim(b.id);
      $('simSelectBusiness').value = b.id;
    });
  }

  function rankFactors(b) {
    const nHaz = HAZARD_KEYS.filter(k => b[k] !== null).length || 1;
    const items = [];
    if (b.fin !== null) items.push({ key: 'fin', value: b.fin, pts: WEIGHTS.fin * b.fin });
    HAZARD_KEYS.forEach(k => {
      if (b[k] !== null) items.push({ key: k, value: b[k], pts: (WEIGHTS.climate / nHaz) * b[k] });
    });
    return items.sort((a, c) => c.pts - a.pts).slice(0, 3);
  }

  // ---------------------------------------------------------------------------
  // Modal: Add / Edit Business
  // ---------------------------------------------------------------------------

  function openAddModal() {
    isEditing = false;
    $('formBizId').value = '';
    $('businessModalTitle').textContent = 'Add Business Assessment';
    $('businessModalSubtitle').textContent = 'Create a new borrower risk profile with deterministic scoring.';
    $('modalSubmitBtn').textContent = 'Save Assessment';

    $('formBizName').value = '';
    $('formBizType').value = '';
    $('formBizCity').value = '';
    $('formBizState').value = '';
    $('formBizFin').value = 45;
    $('formBizFlood').value = 40;
    $('formBizHeat').value = 50;
    $('formBizWater').value = 35;
    $('formBizContext').value = '';

    updateModalScorePreview();
    hideModalFeedback();

    $('businessModal').hidden = false;
    $('formBizName').focus();
  }

  function openEditModal(id) {
    const b = BUSINESSES.find(x => x.id === id);
    if (!b) return;

    isEditing = true;
    $('formBizId').value = b.id;
    $('businessModalTitle').textContent = 'Edit Business Assessment';
    $('businessModalSubtitle').textContent = `Updating portfolio assessment for ${b.name}`;
    $('modalSubmitBtn').textContent = 'Update Assessment';

    $('formBizName').value = b.name || '';
    $('formBizType').value = b.type || '';
    $('formBizCity').value = b.city || '';
    $('formBizState').value = b.state || '';
    $('formBizFin').value = b.fin ?? 45;
    $('formBizFlood').value = b.flood ?? 40;
    $('formBizHeat').value = b.heat ?? 50;
    $('formBizWater').value = b.water ?? 35;
    $('formBizContext').value = b.context || '';

    updateModalScorePreview();
    hideModalFeedback();

    $('businessModal').hidden = false;
    $('formBizName').focus();
  }

  function closeBusinessModal() {
    $('businessModal').hidden = true;
    hideModalFeedback();
  }

  function updateModalScorePreview() {
    const fin = Number($('formBizFin').value);
    const flood = Number($('formBizFlood').value);
    const heat = Number($('formBizHeat').value);
    const water = Number($('formBizWater').value);

    $('formBizFinVal').textContent = fin;
    $('formBizFloodVal').textContent = flood;
    $('formBizHeatVal').textContent = heat;
    $('formBizWaterVal').textContent = water;

    const climateAvg = Math.round((flood + heat + water) / 3);
    const score = Math.min(100, Math.max(0, Math.round(0.4 * fin + 0.6 * climateAvg)));
    const band = bandOf(score);

    $('formPreviewScore').innerHTML = `${score}<small>/100</small>`;
    $('formPreviewBadge').innerHTML = badge(band);
    $('formPreviewFormula').textContent = `40% Financial (${fin}) + 60% Climate Avg (${climateAvg}) = ${score}/100`;
  }

  function showModalFeedback(msg, isError = true) {
    const fb = $('modalFeedback');
    fb.textContent = msg;
    fb.className = `modal-feedback is-visible ${isError ? 'is-error' : 'is-success'}`;
  }

  function hideModalFeedback() {
    const fb = $('modalFeedback');
    fb.textContent = '';
    fb.className = 'modal-feedback';
  }

  // ---------------------------------------------------------------------------
  // Delete Confirmation Modal
  // ---------------------------------------------------------------------------

  function openDeleteConfirm(id) {
    const b = BUSINESSES.find(x => x.id === id);
    if (!b) return;
    deleteTargetId = id;
    $('deleteBizNamePreview').textContent = `${b.name} (${b.type} · ${b.location || b.city})`;
    $('deleteConfirmModal').hidden = false;
  }

  function closeDeleteConfirm() {
    $('deleteConfirmModal').hidden = true;
    deleteTargetId = null;
  }

  // ---------------------------------------------------------------------------
  // View Navigation & Drawer
  // ---------------------------------------------------------------------------

  function setView(name) {
    const view = VIEWS[name] ? name : 'overview';
    state.view = view;
    document.body.dataset.view = view;

    document.querySelectorAll('[data-views]').forEach(el => {
      el.hidden = !el.dataset.views.split(/\s+/).includes(view);
    });

    document.querySelectorAll('.nav-link').forEach(btn => {
      if (btn.dataset.nav === VIEWS[view].nav) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });

    $('pageTitle').textContent = VIEWS[view].title;
    $('pageSubtitle').textContent = VIEWS[view].subtitle;
    document.title = `ClimateShield AI — ${VIEWS[view].title}`;

    closeNav();
    window.scrollTo(0, 0);
  }

  function openNav() {
    $('sidebar').classList.add('is-open');
    $('menuBtn').setAttribute('aria-expanded', 'true');
    $('scrim').hidden = false;
    $('scrim').dataset.for = 'nav';
  }

  function closeNav() {
    $('sidebar').classList.remove('is-open');
    $('menuBtn').setAttribute('aria-expanded', 'false');
    if ($('scrim').dataset.for === 'nav') {
      $('scrim').hidden = true;
      $('scrim').dataset.for = '';
    }
  }

  function openDetail(id) {
    const b = BUSINESSES.find(x => x.id === id);
    if (!b) return;
    closeNav();
    renderDetail(b);
    $('drawer').hidden = false;
    $('scrim').hidden = false;
    $('scrim').dataset.for = 'drawer';
    $('app').inert = true;
    document.body.classList.add('no-scroll');
    $('drawerBody').scrollTop = 0;
    $('drawerClose').focus();
  }

  function closeDetail() {
    if ($('drawer').hidden) return;
    $('drawer').hidden = true;
    $('scrim').hidden = true;
    $('scrim').dataset.for = '';
    $('app').inert = false;
    document.body.classList.remove('no-scroll');
    activeDetailId = null;
  }

  function syncControls() {
    if ($('globalSearch')) $('globalSearch').value = state.query;
    if ($('tableSearch')) $('tableSearch').value = state.query;
    if ($('riskFilter')) $('riskFilter').value = state.risk;
    if ($('typeFilter')) $('typeFilter').value = state.type;
    if ($('sortSelect')) $('sortSelect').value = state.sort;
  }

  function setQuery(value, source) {
    state.query = value;
    if (source !== $('globalSearch')) $('globalSearch').value = value;
    if (source !== $('tableSearch')) $('tableSearch').value = value;
    if (source === $('globalSearch') && value.trim() && !['overview', 'assessments'].includes(state.view)) {
      setView('assessments');
    }
    renderAssessmentsTable();
  }

  function filterByRisk(key) {
    state.risk = key;
    syncControls();
    renderAssessmentsTable();
    if (state.view === 'overview') {
      setView('assessments');
    }
  }

  // ---------------------------------------------------------------------------
  // Event Bindings & Initialization
  // ---------------------------------------------------------------------------

  function bindEvents() {
    // Search inputs
    $('globalSearch').addEventListener('input', e => setQuery(e.target.value, $('globalSearch')));
    $('tableSearch').addEventListener('input', e => setQuery(e.target.value, $('tableSearch')));

    // Filters & Sort
    $('riskFilter').addEventListener('change', e => {
      state.risk = e.target.value;
      renderAssessmentsTable();
    });

    $('typeFilter').addEventListener('change', e => {
      state.type = e.target.value;
      renderAssessmentsTable();
    });

    $('sortSelect').addEventListener('change', e => {
      state.sort = e.target.value;
      renderAssessmentsTable();
    });

    // Alert status filter
    $('alertStatusFilter')?.addEventListener('change', e => {
      state.alertStatusFilter = e.target.value;
      renderFullAlerts();
    });

    // Topbar Add Business
    $('topbarAddBtn').addEventListener('click', openAddModal);
    $('assessmentsAddBtn')?.addEventListener('click', openAddModal);
    $('qaAddBizBtn')?.addEventListener('click', openAddModal);

    // CSV Exports
    $('exportCsvBtn')?.addEventListener('click', () => {
      window.dataService.exportCsvClient(BUSINESSES);
      showToast('Exporting portfolio CSV…', 'success');
    });

    $('reportExportCsvBtn')?.addEventListener('click', () => {
      window.dataService.exportCsvClient(BUSINESSES);
      showToast('Exporting portfolio CSV…', 'success');
    });

    $('reportPrintBtn')?.addEventListener('click', () => window.print());

    // Navigation and drawer toggle
    $('notifBtn').addEventListener('click', () => setView('alerts'));
    $('menuBtn').addEventListener('click', () => ($('sidebar').classList.contains('is-open') ? closeNav() : openNav()));
    $('drawerClose').addEventListener('click', closeDetail);
    $('drawerEditBtn')?.addEventListener('click', () => {
      if (activeDetailId) {
        closeDetail();
        openEditModal(activeDetailId);
      }
    });

    $('scrim').addEventListener('click', () => {
      if ($('scrim').dataset.for === 'drawer') closeDetail();
      else closeNav();
    });

    // Business Modal Events
    $('modalCloseBtn').addEventListener('click', closeBusinessModal);
    $('modalCancelBtn').addEventListener('click', closeBusinessModal);

    ['formBizFin', 'formBizFlood', 'formBizHeat', 'formBizWater'].forEach(id => {
      $(id).addEventListener('input', updateModalScorePreview);
    });

    $('businessForm').addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('formBizName').value.trim();
      const type = $('formBizType').value.trim();
      const city = $('formBizCity').value.trim();
      const stateVal = $('formBizState').value.trim();
      const fin = Number($('formBizFin').value);
      const flood = Number($('formBizFlood').value);
      const heat = Number($('formBizHeat').value);
      const water = Number($('formBizWater').value);
      const context = $('formBizContext').value.trim();

      if (!name) return showModalFeedback('Please enter business name.');
      if (!type) return showModalFeedback('Please enter industry sector.');
      if (!city) return showModalFeedback('Please enter city.');

      const payload = { name, type, city, state: stateVal, fin, flood, heat, water, context };
      const submitBtn = $('modalSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = isEditing ? 'Updating…' : 'Saving…';

      try {
        if (isEditing) {
          const id = $('formBizId').value;
          await window.dataService.updateBusiness(id, payload);
          showToast(`Updated assessment for ${name}`, 'success');
        } else {
          await window.dataService.createBusiness(payload);
          showToast(`Saved new assessment for ${name}`, 'success');
        }
        closeBusinessModal();
        await loadData();
      } catch (err) {
        showModalFeedback(err.message || 'Error saving assessment. Check backend connection.', true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isEditing ? 'Update Assessment' : 'Save Assessment';
      }
    });

    // Delete Modal Events
    $('deleteCancelBtn').addEventListener('click', closeDeleteConfirm);
    $('deleteCancelIconBtn').addEventListener('click', closeDeleteConfirm);

    $('deleteExecuteBtn').addEventListener('click', async () => {
      if (!deleteTargetId) return;
      const id = deleteTargetId;
      const b = BUSINESSES.find(x => x.id === id);
      const name = b ? b.name : 'Business';
      const btn = $('deleteExecuteBtn');
      btn.disabled = true;
      btn.textContent = 'Deleting…';

      try {
        await window.dataService.deleteBusiness(id);
        closeDeleteConfirm();
        showToast(`Deleted ${name} from portfolio`, 'info');
        await loadData();
      } catch (err) {
        showToast(err.message || 'Failed to delete business', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Delete Business';
      }
    });

    // Simulator Controls
    $('simSelectBusiness')?.addEventListener('change', e => {
      if (e.target.value) selectBusinessForSim(e.target.value);
    });

    ['simFlood', 'simHeat', 'simWater', 'simFin'].forEach(id => {
      $(id)?.addEventListener('input', updateSimScenarioProjection);
    });

    $('presetFloodBtn')?.addEventListener('click', () => {
      if (!currentSimBusiness) return;
      $('simFlood').value = Math.min(100, (currentSimBusiness.flood ?? 50) + 35);
      updateSimScenarioProjection();
    });

    $('presetHeatBtn')?.addEventListener('click', () => {
      if (!currentSimBusiness) return;
      $('simHeat').value = Math.min(100, (currentSimBusiness.heat ?? 50) + 30);
      updateSimScenarioProjection();
    });

    $('presetDroughtBtn')?.addEventListener('click', () => {
      if (!currentSimBusiness) return;
      $('simWater').value = Math.min(100, (currentSimBusiness.water ?? 50) + 40);
      updateSimScenarioProjection();
    });

    $('presetResetBtn')?.addEventListener('click', () => {
      if (currentSimBusiness) selectBusinessForSim(currentSimBusiness.id);
    });

    $('simSaveBtn')?.addEventListener('click', async () => {
      if (!currentSimBusiness) return;
      const btn = $('simSaveBtn');
      btn.disabled = true;
      btn.textContent = 'Saving Scenario…';

      try {
        const payload = {
          businessId: currentSimBusiness.id,
          levels: {
            flood: Number($('simFlood').value),
            heat: Number($('simHeat').value),
            water: Number($('simWater').value)
          }
        };
        const res = await window.dataService.runSimulation(payload);
        SIMULATIONS.unshift(res);
        renderSimHistory();
        showToast(`Saved stress-test scenario for ${currentSimBusiness.name}`, 'success');
      } catch (err) {
        showToast(err.message || 'Error saving simulation', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Scenario Run';
      }
    });

    $('simApplyBaselineBtn')?.addEventListener('click', async () => {
      if (!currentSimBusiness) return;
      const confirmed = confirm(`Apply scenario values as the permanent baseline for ${currentSimBusiness.name}?`);
      if (!confirmed) return;

      try {
        await window.dataService.updateBusiness(currentSimBusiness.id, {
          fin: Number($('simFin').value),
          flood: Number($('simFlood').value),
          heat: Number($('simHeat').value),
          water: Number($('simWater').value)
        });
        showToast(`Baseline updated for ${currentSimBusiness.name}`, 'success');
        await loadData();
        selectBusinessForSim(currentSimBusiness.id);
      } catch (err) {
        showToast(err.message || 'Error updating baseline', 'error');
      }
    });

    // Keyboard navigation (Escape to close modals)
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!$('businessModal').hidden) closeBusinessModal();
        else if (!$('deleteConfirmModal').hidden) closeDeleteConfirm();
        else if (!$('drawer').hidden) closeDetail();
        else closeNav();
      }
    });

    // Delegated actions for dynamically rendered buttons
    document.addEventListener('click', async e => {
      const t = e.target.closest('[data-nav],[data-detail],[data-edit],[data-delete],[data-filter-risk],[data-clear-filters],[data-alert-status]');
      if (!t) return;

      if (t.dataset.nav) {
        setView(t.dataset.nav);
      } else if (t.dataset.detail) {
        openDetail(t.dataset.detail);
      } else if (t.dataset.edit) {
        openEditModal(t.dataset.edit);
      } else if (t.dataset.delete) {
        openDeleteConfirm(t.dataset.delete);
      } else if (t.dataset.filterRisk) {
        filterByRisk(t.dataset.filterRisk);
      } else if (t.hasAttribute('data-clear-filters')) {
        state.query = '';
        state.risk = 'all';
        state.type = 'all';
        syncControls();
        renderAssessmentsTable();
      } else if (t.dataset.alertStatus) {
        const id = t.dataset.alertStatus;
        const newStatus = t.dataset.newStatus;
        try {
          await window.dataService.updateAlert(id, newStatus);
          const found = ALERTS.find(a => a.id === id);
          if (found) found.status = newStatus;
          renderOverviewAlerts();
          renderFullAlerts();
          renderMetrics();
          showToast(`Alert status updated to ${newStatus}`, 'success');
        } catch (err) {
          showToast(err.message || 'Error updating alert status', 'error');
        }
      }
    });
  }

  async function init() {
    $('riskFilter').innerHTML = '<option value="all">All Classifications</option>' +
      BANDS.map(b => `<option value="${b.key}">${b.label} (${b.range})</option>`).join('');

    bindEvents();
    setView('overview');
    await loadData();
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();