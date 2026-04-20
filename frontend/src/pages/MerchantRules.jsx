import { useEffect, useState, useCallback } from 'react';
import { getProperties, getTenants, getMerchantRules, createMerchantRule, updateMerchantRule, deleteMerchantRule, runPredictions } from '../api';
import { formatMoney } from '../utils/format';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import Toast, { useToast } from '../components/Toast';

const CATEGORIES = ['Mortgage', 'Repairs', 'Insurance', 'Utilities', 'Maintenance', 'Property Tax',
  'Landscaping', 'HOA', 'Legal', 'Software', 'Professional Services', 'rent', 'Other Income', 'Other'];

const EMPTY_FORM = {
  merchant_pattern: '', amount: '', amount_tolerance: '2',
  category: 'Mortgage', property_scope: 'single', property_id: '', tenant_id: '', note: '',
};

function RuleForm({ form, setForm, properties, tenants, onSave, saving, saveLabel }) {
  return (
    <>
      <div className="form-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        <div className="form-group" style={{ flex: '2 1 200px', minWidth: 0 }}>
          <label>Keyword in Description</label>
          <input
            className="form-input"
            placeholder="e.g. JMJ MTG GROUP"
            value={form.merchant_pattern}
            onChange={e => setForm(f => ({ ...f, merchant_pattern: e.target.value }))}
          />
        </div>
        <div className="form-group" style={{ width: 110 }}>
          <label>Exact Amount</label>
          <input
            className="form-input"
            type="number"
            step="0.01"
            placeholder="e.g. 1618.33"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
          />
        </div>
        <div className="form-group" style={{ width: 80 }}>
          <label>± Tolerance</label>
          <input
            className="form-input"
            type="number"
            step="0.01"
            value={form.amount_tolerance}
            onChange={e => setForm(f => ({ ...f, amount_tolerance: e.target.value }))}
          />
        </div>
        <div className="form-group" style={{ width: 130 }}>
          <label>Category</label>
          <select className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            <option value="">— None —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: '1 1 160px', minWidth: 0 }}>
          <label>Property</label>
          <select
            className="form-input"
            value={form.property_scope === 'portfolio' ? 'portfolio' : (form.property_id || '')}
            onChange={e => {
              if (e.target.value === 'portfolio') {
                setForm(f => ({ ...f, property_scope: 'portfolio', property_id: '' }));
              } else {
                setForm(f => ({ ...f, property_scope: 'single', property_id: e.target.value }));
              }
            }}
          >
            <option value="">— Any Property —</option>
            <option value="portfolio">🏘 All Properties (Portfolio)</option>
            <option disabled>──────────────</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: '1 1 140px', minWidth: 0 }}>
          <label>Tenant</label>
          <select className="form-input" value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}>
            <option value="">— Any Tenant —</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: '2 1 160px', minWidth: 0 }}>
          <label>Note (optional)</label>
          <input
            className="form-input"
            placeholder="e.g. 8971 Singing Wood mortgage"
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          />
        </div>
      </div>
      <button className="btn-primary" onClick={onSave} disabled={saving || !form.merchant_pattern.trim()}>
        {saving ? 'Saving...' : saveLabel || '+ Add Rule'}
      </button>
    </>
  );
}

export default function MerchantRules() {
  const [rules, setRules]         = useState([]);
  const [properties, setProperties] = useState([]);
  const [tenants, setTenants]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const { toast, showToast }      = useToast();

  useEffect(() => {
    Promise.all([getMerchantRules(), getProperties(), getTenants()])
      .then(([r, p, t]) => { setRules(r); setProperties(p); setTenants(t); })
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    if (!form.merchant_pattern.trim()) return;
    setSaving(true);
    try {
      const created = await createMerchantRule({
        merchant_pattern: form.merchant_pattern.trim(),
        amount: form.amount !== '' ? parseFloat(form.amount) : null,
        amount_tolerance: parseFloat(form.amount_tolerance || 2),
        category: form.category || null,
        property_id: form.property_id || null,
        property_scope: form.property_scope || 'single',
        tenant_id: form.tenant_id || null,
        note: form.note || null,
      });
      setRules(rs => [...rs, created]);
      setForm(EMPTY_FORM);
      showToast(`Rule added: "${created.merchant_pattern}"${created.amount != null ? ` @ $${created.amount}` : ''}`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to add rule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteMerchantRule(id);
      setRules(rs => rs.filter(r => r.id !== id));
      showToast('Rule deleted');
    } catch {
      showToast('Failed to delete rule');
    }
  };

  const openEdit = (rule) => {
    setEditModal({
      ...rule,
      amount: rule.amount != null ? String(parseFloat(rule.amount)) : '',
      amount_tolerance: rule.amount_tolerance != null ? String(parseFloat(rule.amount_tolerance)) : '2',
      property_id: rule.property_id ? String(rule.property_id) : '',
      tenant_id: rule.tenant_id ? String(rule.tenant_id) : '',
    });
  };

  const handleEditSave = async () => {
    if (!editModal.merchant_pattern.trim()) return;
    setSaving(true);
    try {
      const updated = await updateMerchantRule(editModal.id, {
        merchant_pattern: editModal.merchant_pattern.trim(),
        amount: editModal.amount !== '' ? parseFloat(editModal.amount) : null,
        amount_tolerance: parseFloat(editModal.amount_tolerance || 2),
        category: editModal.category || null,
        property_id: editModal.property_id || null,
        property_scope: editModal.property_scope || 'single',
        tenant_id: editModal.tenant_id || null,
        note: editModal.note || null,
      });
      setRules(rs => rs.map(r => r.id === updated.id ? { ...r, ...updated } : r));
      setEditModal(null);
      showToast('Rule updated');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update rule');
    } finally {
      setSaving(false);
    }
  };

  const handleRerun = async () => {
    setRerunning(true);
    try {
      const result = await runPredictions();
      showToast(`Re-predicted: ${result.predicted} transactions — ${result.counts.HIGH} HIGH, ${result.counts.MEDIUM} MED, ${result.counts.LOW} LOW`);
    } catch {
      showToast('Re-predict failed');
    } finally {
      setRerunning(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Merchant Rules</h1>
        <button className="btn-secondary" onClick={handleRerun} disabled={rerunning}>
          {rerunning ? 'Running...' : 'Apply Rules & Re-predict'}
        </button>
      </div>

      <div style={{ color: '#666', fontSize: 13, marginBottom: 20, maxWidth: 700, lineHeight: 1.6 }}>
        Define explicit keyword + amount rules that override all similarity-based prediction.
        Ideal for mortgage payments, property taxes, and insurance premiums where the same
        servicer sends different amounts for different properties.
        <br />
        <strong>Priority:</strong> Merchant Rules → Payer Patterns → Fuzzy Similarity
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Add New Rule</h3>
        <RuleForm
          form={form} setForm={setForm}
          properties={properties} tenants={tenants}
          onSave={handleAdd} saving={saving}
        />
      </div>

      <table className="tx-table mobile-cards">
        <colgroup>
          <col style={{ width: 180 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 110 }} />
          <col />
          <col style={{ width: 140 }} />
          <col />
          <col style={{ width: 80 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Keyword</th>
            <th className="num">Amount</th>
            <th className="num">± Tol</th>
            <th>Category</th>
            <th>Property</th>
            <th>Tenant</th>
            <th>Note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map(rule => (
            <tr key={rule.id}>
              <td data-label="Keyword">
                <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 2, fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}>
                  {rule.merchant_pattern}
                </code>
              </td>
              <td data-label="Amount" className="num mono" style={{ fontSize: 12 }}>
                {rule.amount != null ? formatMoney(rule.amount) : <span style={{ color: '#bbb' }}>any</span>}
              </td>
              <td data-label="± Tol" className="num mono" style={{ fontSize: 11, color: '#888' }}>
                ±${parseFloat(rule.amount_tolerance || 2).toFixed(0)}
              </td>
              <td data-label="Category" style={{ fontSize: 12 }}>{rule.category || <span style={{ color: '#bbb' }}>—</span>}</td>
              <td data-label="Property" style={{ fontSize: 12 }}>
                {rule.property_scope === 'portfolio'
                  ? '🏘 All Properties'
                  : (rule.property_name || <span style={{ color: '#bbb' }}>—</span>)}
              </td>
              <td data-label="Tenant" style={{ fontSize: 12 }}>{rule.tenant_name || <span style={{ color: '#bbb' }}>—</span>}</td>
              <td data-label="Note" style={{ fontSize: 11, color: '#888' }}>{rule.note || ''}</td>
              <td data-label="">
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn-edit" onClick={() => openEdit(rule)} title="Edit">✎</button>
                  <button className="btn-danger" onClick={() => handleDelete(rule.id)} title="Delete">✕</button>
                </div>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr>
              <td colSpan={8} style={{ padding: 0 }}>
                <EmptyState
                  icon="list"
                  title="No merchant rules yet"
                  description='Lock a merchant + amount to a specific property. e.g. "JMJ MTG GROUP" at $1,618.33 → 8971 Singing Wood.'
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editModal && (
        <Modal
          title={`Edit Rule: ${editModal.merchant_pattern}`}
          onClose={() => setEditModal(null)}
          onSave={handleEditSave}
          saveLabel="Save Changes"
          width={760}
        >
          <RuleForm
            form={editModal} setForm={setEditModal}
            properties={properties} tenants={tenants}
            onSave={handleEditSave} saving={saving}
            saveLabel="Save Changes"
          />
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  );
}
