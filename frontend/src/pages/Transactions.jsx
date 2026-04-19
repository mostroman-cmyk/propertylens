import { useEffect, useState, useRef, useCallback } from 'react';
import { getTransactions, getProperties, getTenants, updateTransaction, assignTenant, autoMatchRent, bulkCategorize } from '../api';
import Modal from '../components/Modal';
import Toast, { useToast } from '../components/Toast';

const CATEGORIES = ['rent', 'Repairs', 'Insurance', 'Utilities', 'Maintenance', 'Property Tax', 'Landscaping', 'HOA', 'Mortgage', 'Other Income', 'Other'];

const PILL_STYLE = {
  exact:       { background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' },
  amount_only: { background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' },
  ambiguous:   { background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' },
};

function MatchPill({ tx, onAssign }) {
  if (tx.type !== 'income') return null;
  if (tx.match_confidence === 'exact' || tx.match_confidence === 'amount_only') {
    return (
      <span
        onClick={() => onAssign(tx)}
        style={{ ...PILL_STYLE[tx.match_confidence], borderRadius: 12, padding: '2px 8px', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
        title="Click to reassign"
      >
        {tx.tenant_name}
      </span>
    );
  }
  if (tx.match_confidence === 'ambiguous' || tx.needs_review) {
    return (
      <span
        onClick={() => onAssign(tx)}
        style={{ ...PILL_STYLE.ambiguous, borderRadius: 12, padding: '2px 8px', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
        title="Click to assign tenant"
      >
        Needs Review
      </span>
    );
  }
  return (
    <span
      onClick={() => onAssign(tx)}
      style={{ background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb', borderRadius: 12, padding: '2px 8px', fontSize: '0.75rem', cursor: 'pointer' }}
      title="Click to assign tenant"
    >
      Unmatched
    </span>
  );
}

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [properties, setProperties] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Edit modal
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ category: '', type: '', property_id: '' });
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState(null);

  // Assign tenant modal
  const [assignModal, setAssignModal] = useState(null);
  const [assignTenantId, setAssignTenantId] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);

  // Quick-learn rule modal
  const [ruleModal, setRuleModal] = useState(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);

  // Filters
  const [filter, setFilter] = useState('all'); // 'all' | 'unmatched' | 'ambiguous'

  const { toast, showToast } = useToast();

  const reload = useCallback(() =>
    getTransactions().then(setTransactions), []);

  useEffect(() => {
    Promise.all([getTransactions(), getProperties(), getTenants()])
      .then(([tx, p, t]) => { setTransactions(tx); setProperties(p); setTenants(t); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openEdit = (tx) => {
    setForm({ category: tx.category, type: tx.type, property_id: tx.property_id || '' });
    setModal(tx);
    setModalError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setModalError(null);
    try {
      const updated = await updateTransaction(modal.id, {
        category: form.category, type: form.type, property_id: form.property_id || null,
      });
      setTransactions(txs => txs.map(t => t.id === modal.id ? updated : t));
      showToast('Transaction updated');
      setModal(null);
    } catch (err) {
      setModalError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const openAssign = (tx) => {
    setAssignTenantId(tx.tenant_id ? String(tx.tenant_id) : '');
    setAssignModal(tx);
    setContextMenu(null);
  };

  const handleAssignSave = async () => {
    setAssignSaving(true);
    try {
      const updated = await assignTenant(assignModal.id, { tenant_id: assignTenantId ? parseInt(assignTenantId) : null });
      setTransactions(txs => txs.map(t => t.id === assignModal.id ? updated : t));
      showToast('Tenant assigned');
      setAssignModal(null);
    } catch (err) {
      showToast('Failed to assign tenant');
    } finally {
      setAssignSaving(false);
    }
  };

  const handleAutoMatch = async () => {
    try {
      const result = await autoMatchRent();
      await reload();
      showToast(`Matched: ${result.exact} exact, ${result.amount_only} amount-only, ${result.ambiguous} ambiguous, ${result.none} no match`);
    } catch (err) {
      showToast('Auto-match failed');
    }
  };

  const handleBulkCategorize = async (reapplyAll = false) => {
    try {
      const result = await bulkCategorize({ reapply_all: reapplyAll });
      await reload();
      const detail = Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(', ');
      showToast(`Categorized ${result.categorized} transactions${detail ? `: ${detail}` : ''}`);
    } catch {
      showToast('Bulk categorize failed');
    }
    setContextMenu(null);
  };

  const handleContextMenu = (e, tx) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tx });
  };

  const openRuleModal = (tx) => {
    setRuleModal({ keyword: tx.description, category: tx.category, type: tx.type });
    setContextMenu(null);
  };

  const filtered = transactions.filter(tx => {
    if (filter === 'unmatched') return tx.type === 'income' && !tx.tenant_id;
    if (filter === 'ambiguous') return tx.needs_review;
    return true;
  });

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const income   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
  const expenses = Math.abs(transactions.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
  const unmatched = transactions.filter(t => t.type === 'income' && !t.tenant_id).length;
  const ambiguous = transactions.filter(t => t.needs_review).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Transactions</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleAutoMatch}>Auto-Match Rent</button>
          <button className="btn-secondary" onClick={() => handleBulkCategorize(false)}>Apply Rules</button>
          <button className="btn-secondary" onClick={() => handleBulkCategorize(true)}>Re-Apply All Rules</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="label">Total Income</div><div className="value green">${income.toLocaleString()}</div></div>
        <div className="stat-card"><div className="label">Total Expenses</div><div className="value">${expenses.toLocaleString()}</div></div>
        <div className="stat-card"><div className="label">Net</div><div className={`value ${income - expenses >= 0 ? 'green' : ''}`}>${(income - expenses).toLocaleString()}</div></div>
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => setFilter(f => f === 'unmatched' ? 'all' : 'unmatched')}>
          <div className="label">Unmatched Rent</div>
          <div className="value" style={{ color: unmatched > 0 ? '#dc2626' : '#16a34a' }}>{unmatched}</div>
        </div>
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => setFilter(f => f === 'ambiguous' ? 'all' : 'ambiguous')}>
          <div className="label">Needs Review</div>
          <div className="value" style={{ color: ambiguous > 0 ? '#d97706' : '#16a34a' }}>{ambiguous}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'unmatched', 'ambiguous'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '4px 14px', borderRadius: 20, fontSize: '0.82rem', cursor: 'pointer',
              border: filter === f ? '2px solid #7c8ef7' : '1px solid #e5e7eb',
              background: filter === f ? '#eef0fe' : '#fff',
              color: filter === f ? '#4f46e5' : '#555', fontWeight: filter === f ? 600 : 400,
            }}
          >
            {f === 'all' ? `All (${transactions.length})` : f === 'unmatched' ? `Unmatched rent (${unmatched})` : `Needs review (${ambiguous})`}
          </button>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>Date</th><th>Description</th><th>Amount</th><th>Type</th>
            <th>Category</th><th>Property</th><th>Tenant Match</th><th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(tx => (
            <tr key={tx.id} onContextMenu={e => handleContextMenu(e, tx)}>
              <td>{new Date(tx.date).toLocaleDateString()}</td>
              <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description}</td>
              <td>${Math.abs(parseFloat(tx.amount)).toLocaleString()}</td>
              <td><span className={`badge ${tx.type}`}>{tx.type}</span></td>
              <td>{tx.category}</td>
              <td style={{ color: '#888', fontSize: '0.85em' }}>{tx.property_name || '—'}</td>
              <td><MatchPill tx={tx} onAssign={openAssign} /></td>
              <td style={{ width: 50 }}>
                <button className="btn-edit" onClick={() => openEdit(tx)}>Edit</button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={8} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No transactions match this filter.</td></tr>
          )}
        </tbody>
      </table>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed', top: contextMenu.y, left: contextMenu.x,
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 1000, minWidth: 200,
          }}
        >
          <div style={{ padding: '4px 0' }}>
            <div
              onClick={() => { openAssign(contextMenu.tx); }}
              style={{ padding: '8px 16px', cursor: 'pointer', fontSize: '0.9rem' }}
              onMouseEnter={e => e.target.style.background = '#f5f5f5'}
              onMouseLeave={e => e.target.style.background = ''}
            >
              Assign tenant
            </div>
            <div
              onClick={() => openRuleModal(contextMenu.tx)}
              style={{ padding: '8px 16px', cursor: 'pointer', fontSize: '0.9rem' }}
              onMouseEnter={e => e.target.style.background = '#f5f5f5'}
              onMouseLeave={e => e.target.style.background = ''}
            >
              Create rule from this
            </div>
            <div
              onClick={() => { openEdit(contextMenu.tx); setContextMenu(null); }}
              style={{ padding: '8px 16px', cursor: 'pointer', fontSize: '0.9rem' }}
              onMouseEnter={e => e.target.style.background = '#f5f5f5'}
              onMouseLeave={e => e.target.style.background = ''}
            >
              Edit transaction
            </div>
          </div>
        </div>
      )}

      {/* Edit transaction modal */}
      {modal !== null && (
        <Modal title="Edit Transaction" onClose={() => setModal(null)} onSave={handleSave} saving={saving} error={modalError}>
          <div style={{ color: '#555', fontSize: '0.9rem', marginBottom: 16, padding: '10px 12px', background: '#f5f6fa', borderRadius: 8 }}>
            <strong>{modal.description}</strong>
            <span style={{ marginLeft: 10, color: '#888' }}>{new Date(modal.date).toLocaleDateString()}</span>
            <span style={{ marginLeft: 10, fontWeight: 600 }}>${Math.abs(parseFloat(modal.amount)).toLocaleString()}</span>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Type</label>
              <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="income">income</option>
                <option value="expense">expense</option>
              </select>
            </div>
            <div className="form-group">
              <label>Category</label>
              <select className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Property</label>
            <select className="form-input" value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))}>
              <option value="">— None —</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </Modal>
      )}

      {/* Assign tenant modal */}
      {assignModal && (
        <Modal title="Assign Tenant" onClose={() => setAssignModal(null)} onSave={handleAssignSave} saving={assignSaving}>
          <div style={{ color: '#555', fontSize: '0.9rem', marginBottom: 16, padding: '10px 12px', background: '#f5f6fa', borderRadius: 8 }}>
            <strong>{assignModal.description}</strong>
            <span style={{ marginLeft: 10, fontWeight: 600 }}>${Math.abs(parseFloat(assignModal.amount)).toLocaleString()}</span>
          </div>
          <div className="form-group">
            <label>Tenant</label>
            <select className="form-input" value={assignTenantId} onChange={e => setAssignTenantId(e.target.value)}>
              <option value="">— Unassign —</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} (${parseFloat(t.monthly_rent).toLocaleString()}/mo)</option>)}
            </select>
          </div>
        </Modal>
      )}

      {/* Quick-learn rule modal */}
      {ruleModal && (
        <Modal
          title="Create Categorization Rule"
          onClose={() => setRuleModal(null)}
          onSave={async () => {
            try {
              const { createCategorizationRule } = await import('../api');
              await createCategorizationRule({ keyword: ruleModal.keyword, category: ruleModal.category, type: ruleModal.type });
              showToast(`Rule created: "${ruleModal.keyword}" → ${ruleModal.category}`);
              setRuleModal(null);
            } catch {
              showToast('Failed to create rule');
            }
          }}
        >
          <div className="form-group">
            <label>Keyword (case-insensitive match in description)</label>
            <input className="form-input" value={ruleModal.keyword} onChange={e => setRuleModal(r => ({ ...r, keyword: e.target.value }))} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <select className="form-input" value={ruleModal.category} onChange={e => setRuleModal(r => ({ ...r, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Type</label>
              <select className="form-input" value={ruleModal.type} onChange={e => setRuleModal(r => ({ ...r, type: e.target.value }))}>
                <option value="expense">expense</option>
                <option value="income">income</option>
              </select>
            </div>
          </div>
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  );
}
