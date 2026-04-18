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
