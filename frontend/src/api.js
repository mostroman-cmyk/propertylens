import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
export const api = axios.create({ baseURL: `${BASE_URL}/api` });

export const getProperties   = ()         => api.get('/properties').then(r => r.data);
export const createProperty  = (data)     => api.post('/properties', data).then(r => r.data);
export const updateProperty  = (id, data) => api.put(`/properties/${id}`, data).then(r => r.data);

export const getTenants      = ()         => api.get('/tenants').then(r => r.data);
export const createTenant    = (data)     => api.post('/tenants', data).then(r => r.data);
export const updateTenant    = (id, data) => api.put(`/tenants/${id}`, data).then(r => r.data);

export const getTransactions    = ()         => api.get('/transactions').then(r => r.data);
export const createTransaction  = (data)     => api.post('/transactions', data).then(r => r.data);
export const updateTransaction  = (id, data) => api.put(`/transactions/${id}`, data).then(r => r.data);

export const getSettings    = ()     => api.get('/settings').then(r => r.data);
export const updateSettings = (data) => api.post('/settings', data).then(r => r.data);

export const autoMatchRent            = ()         => api.post('/transactions/auto-match').then(r => r.data);
export const assignTenant             = (id, data) => api.put(`/transactions/${id}/assign-tenant`, data).then(r => r.data);
export const bulkCategorize           = (data)     => api.post('/transactions/bulk-categorize', data).then(r => r.data);
export const backfillPropertyTenant   = ()         => api.post('/transactions/backfill-property-tenant').then(r => r.data);
export const bulkUpdateTransactions   = (data)     => api.post('/transactions/bulk-update', data).then(r => r.data);
export const setRentMonth             = (id, rent_month) => api.put(`/transactions/${id}/rent-month`, { rent_month }).then(r => r.data);
export const recalculateRentMonths    = ()         => api.post('/transactions/recalculate-rent-months').then(r => r.data);

export const getPredictions           = ()         => api.get('/predictions').then(r => r.data);
export const runPredictions           = ()         => api.post('/predictions/predict-all').then(r => r.data);
export const acceptPrediction         = (id, data) => api.post(`/predictions/${id}/accept`, data || {}).then(r => r.data);
export const rejectPrediction         = (id)       => api.post(`/predictions/${id}/reject`).then(r => r.data);
export const acceptAllHighConfidence  = ()         => api.post('/predictions/accept-all-high').then(r => r.data);

export const getCategorizationRules    = ()      => api.get('/categorization-rules').then(r => r.data);
export const createCategorizationRule  = (data)  => api.post('/categorization-rules', data).then(r => r.data);
export const deleteCategorizationRule  = (id)    => api.delete(`/categorization-rules/${id}`).then(r => r.data);

export const getPropertyPL = (year) => api.get('/reports/property-pl', { params: { year } }).then(r => r.data);
