import { useEffect, useState } from 'react';
import { getProperties, getTenants, createProperty, updateProperty } from '../api';
import { formatMoney } from '../utils/format';
import Modal from '../components/Modal';
import Toast, { useToast } from '../components/Toast';

const EMPTY_FORM = { name: '', address: '' };

export default function Properties() {
  const [properties, setProperties] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState(null);
  const { toast, showToast } = useToast();

  useEffect(() => {
    Promise.all([getProperties(), getTenants()])
      .then(([p, t]) => { setProperties(p); setTenants(t); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const openEdit = (prop) => {
    setForm({ name: prop.name, address: prop.address });
    setModal(prop);
    setModalError(null);
  };

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setModal({});
    setModalError(null);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.address.trim()) {
      setModalError('Name and address are required.');
      return;
    }
    setSaving(true);
    setModalError(null);
    try {
      if (modal.id) {
        const updated = await updateProperty(modal.id, form);
        setProperties(ps => ps.map(p => p.id === modal.id ? updated : p));
        showToast('Property updated');
      } else {
        const created = await createProperty(form);
        setProperties(ps => [...ps, created]);
        showToast('Property added');
      }
      setModal(null);
    } catch (err) {
      setModalError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Properties</h1>
        <button className="btn-primary" onClick={openAdd}>+ Add Property</button>
      </div>

      {properties.map(prop => {
        const propTenants = tenants.filter(t => t.property_id === prop.id);
        const monthlyRent = propTenants.reduce((s, t) => s + parseFloat(t.monthly_rent), 0);
        return (
          <div key={prop.id} className="property-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div className="property-name">{prop.name}</div>
                <div className="property-address">{prop.address}</div>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <span className="label">{propTenants.length} units · <span className="mono">{formatMoney(monthlyRent, { noCents: true })}/mo</span></span>
                <button className="btn-edit" onClick={() => openEdit(prop)}>Edit</button>
              </div>
            </div>
            <table>
              <thead>
                <tr><th>Unit</th><th>Tenant</th><th className="num">Monthly Rent</th></tr>
              </thead>
              <tbody>
                {propTenants.map(t => (
                  <tr key={t.id}>
                    <td className="nowrap">{t.unit}</td>
                    <td>{t.name}</td>
                    <td className="num mono">{formatMoney(t.monthly_rent)}</td>
                  </tr>
                ))}
                {propTenants.length === 0 && (
                  <tr><td colSpan={3} style={{ color: '#888', padding: '8px 12px' }}>No tenants.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}

      {modal !== null && (
        <Modal
          title={modal.id ? 'Edit Property' : 'Add Property'}
          onClose={() => setModal(null)}
          onSave={handleSave}
          saving={saving}
          error={modalError}
        >
          <div className="form-group">
            <label>Property Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. 142 Maple St Duplex"
            />
          </div>
          <div className="form-group">
            <label>Address</label>
            <input
              className="form-input"
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="e.g. 142 Maple St"
            />
          </div>
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  );
}
