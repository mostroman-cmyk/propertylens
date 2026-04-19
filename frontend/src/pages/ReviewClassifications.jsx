import { useEffect, useState, useCallback } from 'react';
import { getTransactions, getProperties, getTenants, updateTransaction, assignTenant, bulkUpdateTransactions } from '../api';
import Toast, { useToast } from '../components/Toast';

const CATEGORIES = ['rent', 'Repairs', 'Insurance', 'Utilities', 'Maintenance', 'Property Tax', 'Landscaping', 'HOA', 'Mortgage', 'Other Income', 'Other'];

function normalizeDesc(desc) {
  return desc.toUpperCase()
    .replace(/#\s*\d+/g, '')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '')
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMerchant(desc) {
  const norm = normalizeDesc(desc);
  const words = norm.split(/\s+/).filter(w => w.length > 1 && !/^\d+$/.test(w));
  return words.slice(0, 2).join(' ') || norm.slice(0, 20);
}

export default function ReviewClassifications() {
  const [transactions, setTransactions] = useState([]);
  const [properties, setProperties]     = useState([]);
  const [tenants, setTenants]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);

  const [filterCategory,   setFilterCategory]   = useState('All');
  const [filterProperty,   setFilterProperty]   = useState('All');
  const [filterType,       setFilterType]       = useState('All');
  const [filterConfidence, setFilterConfidence] = useState('All');
  const [search,           setSearch]           = useState('');
  const [similarFilter,    setSimilarFilter]    = useState(null);

  const [editingCell,  setEditingCell]  = useState(null); // { txId, field }
  const [selectedIds,  setSelectedIds]  = useState(new Set());
  const [bulkCategory, setBulkCategory] = useState('');

  const { toast, showToast } = useToast();

  useEffect(() => {
    Promise.all([getTransactions(), getProperties(), getTenants()])
      .then(([tx, p, t]) => { setTransactions(tx); setProperties(p); setTenants(t); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const reload = useCallback(() => getTransactions().then(setTransactions), []);

  const handleInlineEdit = async (tx, field, value) => {
    setEditingCell(null);
    try {
      let updated;
      if (field === 'category') {
        updated = await updateTransaction(tx.id, { category: value, type: tx.type, property_id: tx.property_id });
      } else if (field === 'tenant_id') {
        updated = await assignTenant(tx.id, { tenant_id: value ? parseInt(value) : null });
      } else if (field === 'property_id') {
        updated = await updateTransaction(tx.id, { category: tx.category, type: tx.type, property_id: value || null });
      }
      if (updated) setTransactions(txs => txs.map(t => t.id === tx.id ? { ...t, ...updated } : t));
      showToast('Updated');
    } catch {
      showToast('Update failed');
    }
  };

  const handleBulkAction = async (updates) => {
    const ids = [...selectedIds];
    try {
      await bulkUpdateTransactions({ ids, ...updates });
      await reload();
      setSelectedIds(new Set());
      setBulkCategory('');
      showToast(`Updated ${ids.length} transaction${ids.length !== 1 ? 's' : ''}`);
    } catch {
      showToast('Bulk update failed');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids) => {
    const allSelected = ids.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      allSelected ? ids.forEach(id => next.delete(id)) : ids.forEach(id => next.add(id));
      return next;
    });
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error)   return <div className="error">Error: {error}</div>;

  const total       = transactions.length;
  const categorized = transactions.filter(t => !['Other', 'Other Income'].includes(t.category)).length;
  const uncategorized = total - categorized;
  const withTenant  = transactions.filter(t => t.tenant_id).length;
  const withProperty = transactions.filter(t => t.property_id).length;

  let filtered = transactions;
  if (similarFilter)               filtered = filtered.filter(tx => extractMerchant(tx.description) === similarFilter);
  if (filterCategory !== 'All')    filtered = filtered.filter(tx => tx.category === filterCategory);
  if (filterProperty !== 'All')    filtered = filtered.filter(tx => String(tx.property_id) === filterProperty);
  if (filterType     !== 'All')    filtered = filtered.filter(tx => tx.type === filterType);
  if (filterConfidence !== 'All') {
    if (filterConfidence === 'none') filtered = filtered.filter(tx => !tx.match_confidence);
    else filtered = filtered.filter(tx => tx.match_confidence === filterConfidence);
  }
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(tx => tx.description.toLowerCase().includes(s));
  }
  filtered = [...filtered].sort((a, b) => a.category.localeCompare(b.category) || a.date.localeCompare(b.date));

  const filteredIds = filtered.map(tx => tx.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id));

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Review</h1>
        <span className="label">{categorized}/{total} categorized</span>
      </div>

      <div className="kpi-row" style={{ marginBottom: 20 }}>
        <div className="kpi-item">
          <div className="kpi-label">Total</div>
          <div className="kpi-value muted">{total}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Categorized</div>
          <div className="kpi-value">{categorized}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Uncategorized</div>
          <div className={`kpi-value${uncategorized > 0 ? ' negative' : ' muted'}`}>{uncategorized}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">With Tenant</div>
          <div className="kpi-value muted">{withTenant}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">With Property</div>
          <div className="kpi-value muted">{withProperty}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <select className="form-input form-input-sm" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="All">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="form-input form-input-sm" value={filterProperty} onChange={e => setFilterProperty(e.target.value)}>
          <option value="All">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="form-input form-input-sm" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="All">All types</option>
          <option value="income">income</option>
          <option value="expense">expense</option>
        </select>
        <select className="form-input form-input-sm" value={filterConfidence} onChange={e => setFilterConfidence(e.target.value)}>
          <option value="All">All confidence</option>
          <option value="exact">exact</option>
          <option value="amount_only">amount only</option>
          <option value="ambiguous">ambiguous</option>
          <option value="none">none</option>
        </select>
        <input
          className="form-input form-input-sm"
          placeholder="Search description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
      </div>

      {similarFilter && (
        <div className="alert alert-info" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Showing {filtered.length} transactions similar to "<strong>{similarFilter}</strong>"</span>
          <button className="btn-sm" onClick={() => setSimilarFilter(null)}>Clear</button>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', border: '1px solid #000', borderRadius: 2, marginBottom: 12, background: '#F5F5F5', flexWrap: 'wrap' }}>
          <span className="label">{selectedIds.size} selected</span>
          <select className="form-input form-input-sm" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}>
            <option value="">Pick category...</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn-sm" disabled={!bulkCategory} onClick={() => handleBulkAction({ category: bulkCategory })}>
            Apply Category
          </button>
          <button className="btn-sm" onClick={() => handleBulkAction({ clear: true })}>
            Clear Classification
          </button>
          <button className="btn-edit" onClick={() => setSelectedIds(new Set())}>Deselect all</button>
        </div>
      )}

      <table className="tx-table">
        <colgroup>
          <col style={{ width: 28 }} />
          <col style={{ width: 90 }} />
          <col />
          <col style={{ width: 100 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 60 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={() => toggleSelectAll(filteredIds)}
                style={{ accentColor: '#000' }}
              />
            </th>
            <th>Date</th>
            <th>Description</th>
            <th className="num">Amount</th>
            <th>Type</th>
            <th>Category</th>
            <th>Property</th>
            <th>Tenant</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(tx => {
            const isUncategorized = ['Other', 'Other Income'].includes(tx.category);
            return (
              <tr key={tx.id} style={{ background: selectedIds.has(tx.id) ? '#F5F5F5' : undefined }}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(tx.id)}
                    onChange={() => toggleSelect(tx.id)}
                    style={{ accentColor: '#000' }}
                  />
                </td>
                <td className="nowrap mono" style={{ fontSize: 11 }}>
                  {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                </td>
                <td className="col-desc" title={tx.description}>{tx.description}</td>
                <td className="num mono">${Math.abs(parseFloat(tx.amount)).toLocaleString()}</td>
                <td className="nowrap"><span className={`badge ${tx.type}`}>{tx.type}</span></td>

                <td className="nowrap">
                  {editingCell?.txId === tx.id && editingCell?.field === 'category' ? (
                    <select
                      autoFocus
                      className="form-input"
                      style={{ height: 24, padding: '0 4px', fontSize: 12 }}
                      value={tx.category}
                      onChange={e => handleInlineEdit(tx, 'category', e.target.value)}
                      onBlur={() => setEditingCell(null)}
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <span
                      onClick={() => setEditingCell({ txId: tx.id, field: 'category' })}
                      style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3, color: isUncategorized ? '#E30613' : '#000' }}
                      title="Click to edit"
                    >
                      {tx.category}
                    </span>
                  )}
                </td>

                <td className="nowrap">
                  {editingCell?.txId === tx.id && editingCell?.field === 'property_id' ? (
                    <select
                      autoFocus
                      className="form-input"
                      style={{ height: 24, padding: '0 4px', fontSize: 12 }}
                      value={tx.property_id || ''}
                      onChange={e => handleInlineEdit(tx, 'property_id', e.target.value)}
                      onBlur={() => setEditingCell(null)}
                    >
                      <option value="">— None —</option>
                      {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <span
                      onClick={() => setEditingCell({ txId: tx.id, field: 'property_id' })}
                      style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3, color: tx.property_name ? '#000' : '#ccc' }}
                      title="Click to assign property"
                    >
                      {tx.property_name || '—'}
                    </span>
                  )}
                </td>

                <td className="nowrap">
                  {editingCell?.txId === tx.id && editingCell?.field === 'tenant_id' ? (
                    <select
                      autoFocus
                      className="form-input"
                      style={{ height: 24, padding: '0 4px', fontSize: 12 }}
                      value={tx.tenant_id || ''}
                      onChange={e => handleInlineEdit(tx, 'tenant_id', e.target.value)}
                      onBlur={() => setEditingCell(null)}
                    >
                      <option value="">— None —</option>
                      {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  ) : (
                    <span
                      onClick={() => setEditingCell({ txId: tx.id, field: 'tenant_id' })}
                      style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3, color: tx.tenant_name ? '#000' : '#ccc' }}
                      title="Click to assign tenant"
                    >
                      {tx.tenant_name || '—'}
                    </span>
                  )}
                </td>

                <td className="nowrap">
                  <button
                    className="btn-edit"
                    onClick={() => setSimilarFilter(extractMerchant(tx.description))}
                    title="Show similar transactions"
                  >
                    ≈
                  </button>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No transactions match this filter.</td></tr>
          )}
        </tbody>
      </table>

      <Toast message={toast} />
    </div>
  );
}
