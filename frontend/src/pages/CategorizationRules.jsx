import { useEffect, useState } from 'react';
import { getCategorizationRules, createCategorizationRule, deleteCategorizationRule, bulkCategorize } from '../api';
import Toast, { useToast } from '../components/Toast';

const CATEGORIES = ['Repairs', 'Insurance', 'Utilities', 'Maintenance', 'Property Tax', 'Landscaping', 'HOA', 'Mortgage', 'Legal', 'Software', 'Professional Services', 'Other Income', 'Other'];
const EMPTY_FORM = { keyword: '', category: 'Other', type: 'expense', priority: '0', property_scope: 'single' };

export default function CategorizationRules() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const { toast, showToast } = useToast();

  useEffect(() => {
    getCategorizationRules()
      .then(setRules)
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    if (!form.keyword.trim()) return;
    setSaving(true);
    try {
      const created = await createCategorizationRule({
        keyword: form.keyword.trim(),
        category: form.category,
        type: form.type,
        priority: parseInt(form.priority) || 0,
        property_scope: form.property_scope,
      });
      setRules(rs => [created, ...rs]);
      setForm(EMPTY_FORM);
      showToast(`Rule added: "${created.keyword}" → ${created.category}`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to add rule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteCategorizationRule(id);
      setRules(rs => rs.filter(r => r.id !== id));
      showToast('Rule deleted');
    } catch {
      showToast('Failed to delete rule');
    }
  };

  const handleApply = async (reapplyAll) => {
    setApplying(true);
    try {
      const result = await bulkCategorize({ reapply_all: reapplyAll });
      const detail = Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(', ');
      showToast(`Categorized ${result.categorized} transactions${detail ? `: ${detail}` : ''}`);
    } catch {
      showToast('Failed to apply rules');
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Rules</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => handleApply(false)} disabled={applying}>
            {applying ? 'Applying...' : 'Apply to Uncategorized'}
          </button>
          <button className="btn-secondary" onClick={() => handleApply(true)} disabled={applying}>
            {applying ? 'Applying...' : 'Re-Apply to All'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Add New Rule</h3>
        <p style={{ color: '#888', fontSize: '0.85rem', marginTop: -8, marginBottom: 16 }}>
          If a transaction description contains the keyword (case-insensitive), it gets assigned the category.
        </p>
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label>Keyword</label>
            <input
              className="form-input"
              placeholder="e.g. HOME DEPOT"
              value={form.keyword}
              onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="form-group">
            <label>Category</label>
            <select className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Type</label>
            <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="expense">expense</option>
              <option value="income">income</option>
            </select>
          </div>
          <div className="form-group" style={{ width: 80 }}>
            <label>Priority</label>
            <input className="form-input" type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Scope</label>
            <select className="form-input" value={form.property_scope} onChange={e => setForm(f => ({ ...f, property_scope: e.target.value }))}>
              <option value="single">Single property</option>
              <option value="portfolio">🏘 Portfolio-wide</option>
            </select>
          </div>
        </div>
        <button className="btn-primary" onClick={handleAdd} disabled={saving || !form.keyword.trim()}>
          {saving ? 'Adding...' : '+ Add Rule'}
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Category</th>
            <th>Type</th>
            <th>Scope</th>
            <th>Priority</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map(rule => (
            <tr key={rule.id}>
              <td><code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontSize: '0.85rem' }}>{rule.keyword}</code></td>
              <td>{rule.category}</td>
              <td><span className={`badge ${rule.type}`}>{rule.type}</span></td>
              <td style={{ fontSize: 11, color: rule.property_scope === 'portfolio' ? '#444' : '#aaa' }}>
                {rule.property_scope === 'portfolio' ? '🏘 Portfolio' : 'Single'}
              </td>
              <td style={{ color: '#888' }}>{rule.priority}</td>
              <td style={{ width: 70 }}>
                <button className="btn-danger" onClick={() => handleDelete(rule.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No rules yet. Add one above.</td></tr>
          )}
        </tbody>
      </table>

      <Toast message={toast} />
    </div>
  );
}
