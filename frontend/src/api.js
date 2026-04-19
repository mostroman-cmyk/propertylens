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

export const getCategorizationRules    = ()      => api.get('/categorization-rules').then(r => r.data);
export const createCategorizationRule  = (data)  => api.post('/categorization-rules', data).then(r => r.data);
export const deleteCategorizationRule  = (id)    => api.delete(`/categorization-rules/${id}`).then(r => r.data);
