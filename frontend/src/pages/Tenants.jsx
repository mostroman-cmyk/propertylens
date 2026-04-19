import { useEffect, useState } from 'react';
import { getTenants, getProperties, createTenant, updateTenant, getTenantAliases, addTenantAlias, deleteTenantAlias } from '../api';
import Modal from '../components/Modal';
import Toast, { useToast } from '../components/Toast';

const EMPTY_FORM = { name: '', unit: '', monthly_rent: '', property_id: '' };

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState(null);

  const [aliases, setAliases] = useState([]);
  const [newAlias, setNewAlias] = useState('');
  const [aliasError, setAliasError] = useState(null);

  const { toast, showToast } = useToast();

  useEffect(() => {
    Promise.all([getTenants(), getProperties()])
      .then(([t, p]) => { setTenants(t); setProperties(p); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const openEdit = async (tenant) => {
    setForm({ name: tenant.name, unit: tenant.unit, monthly_rent: tenant.monthly_rent, property_id: tenant.property_id });
    setModal(tenant);
    setModalError(null);
    setNewAlias('');
    setAliasError(null);
    setAliases([]);
    try {
      const data = await getTenantAliases(tenant.id);
      setAliases(data);
    } catch { /* show empty list */ }
  };

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, property_id: properties[0]?.id || '' });
    setModal({});
    setModalError(null);
    setAliases([]);
    setNewAlias('');
    setAliasError(null);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.unit.trim() || !form.monthly_rent || !form.property_id) {
      setModalError('All fields are required.');
      return;
    }
    setSaving(true);
    setModalError(null);
    try {
      const payload = { ...form, monthly_rent: parseFloat(form.monthly_rent), property_id: parseInt(form.property_id) };
      if (modal.id) {
        const updated = await updateTenant(modal.id, payload);
        setTenants(ts => ts.map(t => t.id === modal.id ? updated : t));
        showToast('Tenant updated successfully');
      } else {
        const created = await createTenant(payload);
        setTenants(ts => [...ts, created]);
        showToast('Tenant added successfully');
      }
      setModal(null);
    } catch (err) {
      setModalError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddAlias = async () => {
    if (!newAlias.trim()) return;
    setAliasError(null);
    try {
      const created = await addTenantAlias(modal.id, newAlias.trim());
      setAliases(a => [...a, created]);
      setNewAlias('');
    } catch (err) {
      setAliasError(err.response?.data?.error || 'Failed to add alias');
    }
  };

  const handleDeleteAlias = async (aliasId) => {
    try {
      await deleteTenantAlias(modal.id, aliasId);
      setAliases(a => a.filter(x => x.id !== aliasId));
    } catch {
      setAliasError('Failed to remove alias');
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Tenants</h1>
        <button className="btn-primary" onClick={openAdd}>+ Add Tenant</button>
      </div>

      <table>
        <thead>
          <tr><th>Name</th><th>Property</th><th>Unit</th><th className="num">Monthly Rent</th><th></th></tr>
        </thead>
        <tbody>
          {tenants.map(t => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.property_name}</td>
              <td className="nowrap">{t.unit}</td>
              <td className="num mono">${parseFloat(t.monthly_rent).toLocaleString()}</td>
              <td className="nowrap">
                <button className="btn-edit" onClick={() => openEdit(t)}>Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal !== null && (
        <Modal
          title={modal.id ? 'Edit Tenant' : 'Add Tenant'}
          onClose={() => setModal(null)}
          onSave={handleSave}
          saving={saving}
          error={modalError}
        >
          <div className="form-group">
            <label>Full Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Marcus Johnson"
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Unit</label>
              <input
                className="form-input"
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="e.g. 1A"
              />
            </div>
            <div className="form-group">
              <label>Monthly Rent ($)</label>
              <input
                className="form-input"
                type="number"
                value={form.monthly_rent}
                onChange={e => setForm(f => ({ ...f, monthly_rent: e.target.value }))}
                placeholder="e.g. 1450"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Property</label>
            <select
              className="form-input"
              value={form.property_id}
              onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))}
            >
              <option value="">Select a property</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {modal.id && (
            <div style={{ borderTop: '1px solid #E5E5E5', paddingTop: 14, marginTop: 8 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>Payment Aliases</label>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 8px' }}>
                Alternate names that appear in bank descriptions for this tenant (e.g. "J Smith", "Jose Rodriguez"). Used for auto-matching rent deposits.
              </p>
              {aliases.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="mono" style={{ flex: 1, fontSize: 13, background: '#F5F5F5', padding: '2px 6px', borderRadius: 2 }}>{a.alias}</span>
                  <button className="btn-edit" style={{ fontSize: 11 }} onClick={() => handleDeleteAlias(a.id)}>Remove</button>
                </div>
              ))}
              {aliasError && <div style={{ color: '#E30613', fontSize: 12, marginBottom: 6 }}>{aliasError}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input
                  className="form-input"
                  value={newAlias}
                  onChange={e => setNewAlias(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddAlias()}
                  placeholder="e.g. Carlos Carrillo"
                  style={{ flex: 1 }}
                />
                <button className="btn-secondary" onClick={handleAddAlias}>Add Alias</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  );
}
