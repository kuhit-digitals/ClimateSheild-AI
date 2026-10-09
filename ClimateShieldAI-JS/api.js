/**
 * ClimateShield AI — Central Data Service Layer
 * 
 * Provides an abstracted data access layer for all climate risk operations.
 * Separates UI rendering from data transport.
 * 
 * SUPABASE READINESS NOTE:
 * When connecting Supabase in Phase 3/future migration:
 * 1. Initialize Supabase client:
 *    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
 * 2. Swap the method implementations below from fetch() calls to supabase.from('businesses')...
 *    - getBusinesses() -> await supabase.from('businesses').select('*').order('created_at', { ascending: false });
 *    - createBusiness(data) -> await supabase.from('businesses').insert(data).select().single();
 *    - updateBusiness(id, data) -> await supabase.from('businesses').update(data).eq('id', id).select().single();
 *    - deleteBusiness(id) -> await supabase.from('businesses').delete().eq('id', id);
 * 3. The UI components will not need any changes because they solely interact with window.dataService!
 */

(() => {
  'use strict';

  // Deterministic scoring calculation utility
  const RiskCalculator = {
    calculateClimateAverage(flood, heat, water) {
      return Math.round((Number(flood) + Number(heat) + Number(water)) / 3);
    },
    calculateScore(fin, flood, heat, water) {
      const climate = this.calculateClimateAverage(flood, heat, water);
      const raw = Math.round(0.4 * Number(fin) + 0.6 * climate);
      return Math.min(100, Math.max(0, raw));
    },
    getBand(score) {
      if (score >= 70) return { key: 'high', label: 'High', range: '70–100', desc: 'Significant exposure; priority review' };
      if (score >= 50) return { key: 'elevated', label: 'Elevated', range: '50–69', desc: 'Material exposure; review mitigation' };
      if (score >= 30) return { key: 'moderate', label: 'Moderate', range: '30–49', desc: 'Some exposure; routine monitoring' };
      return { key: 'low', label: 'Low', range: '0–29', desc: 'Limited sample vulnerability and exposure' };
    }
  };

  // Helper for safe fetch requests
  async function request(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const response = await fetch(endpoint, { ...options, headers });
    let body;
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) {
      const message = body.error || `HTTP error ${response.status} (${response.statusText})`;
      const err = new Error(message);
      err.status = response.status;
      err.details = body;
      throw err;
    }
    return body;
  }

  // Proper CSV cell escaping conforming to RFC 4180
  function escapeCsvCell(val) {
    if (val === null || val === undefined) return '""';
    const s = String(val);
    return `"${s.replace(/"/g, '""')}"`;
  }

  const dataService = {
    isOnline: false,

    async checkHealth() {
      try {
        const res = await request('/api/health');
        this.isOnline = true;
        return { ok: true, connected: true, data: res };
      } catch (err) {
        this.isOnline = false;
        return { ok: false, connected: false, error: err.message };
      }
    },

    async getBusinesses() {
      const res = await request('/api/businesses');
      return res.data || [];
    },

    async getBusiness(id) {
      const res = await request(`/api/businesses/${encodeURIComponent(id)}`);
      return res.data;
    },

    async createBusiness(businessData) {
      // Client-side pre-validation
      if (!businessData.name || !businessData.name.trim()) throw new Error('Business name is required.');
      if (!businessData.type || !businessData.type.trim()) throw new Error('Business industry/type is required.');
      if (!businessData.city || !businessData.city.trim()) throw new Error('City is required.');
      
      const payload = {
        name: businessData.name.trim(),
        type: businessData.type.trim(),
        city: businessData.city.trim(),
        state: (businessData.state || '').trim(),
        fin: Number(businessData.fin),
        flood: Number(businessData.flood),
        heat: Number(businessData.heat),
        water: Number(businessData.water),
        context: (businessData.context || '').trim()
      };

      const res = await request('/api/businesses', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return res.data;
    },

    async updateBusiness(id, businessData) {
      if (!id) throw new Error('Business ID is required for update.');
      if (businessData.name && !businessData.name.trim()) throw new Error('Business name cannot be blank.');
      if (businessData.type && !businessData.type.trim()) throw new Error('Industry/type cannot be blank.');
      if (businessData.city && !businessData.city.trim()) throw new Error('City cannot be blank.');

      const payload = {
        ...businessData,
        fin: Number(businessData.fin),
        flood: Number(businessData.flood),
        heat: Number(businessData.heat),
        water: Number(businessData.water)
      };

      const res = await request(`/api/businesses/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return res.data;
    },

    async deleteBusiness(id) {
      if (!id) throw new Error('Business ID is required for deletion.');
      const res = await request(`/api/businesses/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      return res;
    },

    async getSimulations() {
      try {
        const res = await request('/api/simulations');
        return res.data || [];
      } catch {
        return [];
      }
    },

    async runSimulation(simulationData) {
      const res = await request('/api/simulations', {
        method: 'POST',
        body: JSON.stringify(simulationData)
      });
      return res.data;
    },

    async getAlerts() {
      try {
        const res = await request('/api/alerts');
        return res.data || [];
      } catch {
        return [];
      }
    },

    async updateAlert(id, status) {
      const res = await request(`/api/alerts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      return res.data;
    },

    async getSummary() {
      return await request('/api/dashboard/summary');
    },

    async getPortfolioReport() {
      return await request('/api/reports/portfolio');
    },

    getExportCsvUrl() {
      return '/api/reports/portfolio.csv';
    },

    // Client-side fallback / direct CSV export with proper UTF-8 BOM and RFC 4180 escaping
    exportCsvClient(businesses) {
      const headers = ['ID', 'Business Name', 'Industry', 'City', 'State', 'Financial Vulnerability', 'Flood Risk', 'Heat Risk', 'Water Stress', 'Overall Risk Score', 'Risk Classification', 'Climate Exposure Average', 'Last Assessed Date', 'Data Type'];
      const fields = ['id', 'name', 'type', 'city', 'state', 'fin', 'flood', 'heat', 'water', 'score', 'band', 'climateAverage', 'assessed', 'isDemo'];

      const rows = [
        headers.join(','),
        ...businesses.map(b => fields.map(f => {
          if (f === 'isDemo') return escapeCsvCell(b.isDemo ? 'DEMO' : 'SAVED');
          if (f === 'climateAverage') return escapeCsvCell(b.climateAverage ?? RiskCalculator.calculateClimateAverage(b.flood, b.heat, b.water));
          return escapeCsvCell(b[f]);
        }).join(','))
      ];

      const csvContent = '\uFEFF' + rows.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `climateshield-portfolio-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },

    calculator: RiskCalculator
  };

  window.dataService = dataService;
})();
