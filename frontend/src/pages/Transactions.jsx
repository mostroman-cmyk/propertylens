import { useEffect, useState, useRef, useCallback } from 'react';
import { getTransactions, getProperties, getTenants, updateTransaction, assignTenant, autoMatchRent, bulkCategorize, backfillPropertyTenant, setRentMonth, resetAmbiguousRentMatches } from '../api';
import Modal from '../components/Modal';
import Toast, { useToast } from '../components/Toast';
import { useSortState, sortRows, TX_COL_DEFS } from '../utils/sort';
import { formatMoney, formatDate } from '../utils/format';

const CATEGORIES = ['rent', 'Repairs', 'Insurance', 'Utilities', 'Maintenance', 'Property Tax', 'Landscaping', 'HOA', 'Mortgage', 'Other Income', 'Other'];

function formatRentMonth(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase();
}

function getRentMonthOptions() {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i - 3, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { val, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  });
}
const RENT_MONTH_OPTIONS = getRentMonthOptions();

function MatchStatus({ tx, onAssign }) {
  if (tx.type !== 'income') return null;
  if (tx.match_confidence === 'exact') {
    return <span className="status-exact" onClick={() => onAssign(tx)} title="Click to reassign">● {tx.tenant_name}</span>;
  }
  if (tx.match_confidence === 'amount_only') {
    return <span className="status-amount" onClick={() => onAssign(tx)} title="Matched by amount only — click to reassign">● {tx.tenant_name}</span>;
  }
  if (tx.match_confidence === 'ambiguous' || tx.needs_review) {
    return (
      <span
        className="status-review"
        onClick={() => onAssign(tx)}
        title={tx.prediction_reasoning || 'Multiple tenants match — click to assign'}
        style={{ fontWeight: 700, letterSpacing: '0.02em' }}
      >
        ⚠ Needs Review
      </span>
    );
  }
  return <span className="status-none" onClick={() => onAssign(tx)} title="Click to assign">—</span>;
}

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [properties, setProperties] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ category: '', type: '', property_id: '', property_scope: 'single' });
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState(null);

  const [assignModal, setAssignModal] = useState(null);
  const [assignTenantId, setAssignTenantId] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [learnPattern, setLearnPattern] = useState(false);

  const [ruleModal, setRuleModal] = useState(null);

  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);

  const [editingCell, setEditingCell] = useState(null);
  const [filter, setFilter] = useState('all');
  const [tenantIdFilter] = useState(() => {
    const tid = new URLSearchParams(window.location.search).get('tenant_id');
    return tid ? parseInt(tid) : null;
  });
  const { sortCol, sortDir, handleSort, resetSort } = useSortState();

  // Inline assignment state for "Needs Rent Review" tab
  const [reviewSelections, setReviewSelections] = useState({}); // txId → tenantId string
  const [reviewSaving, setReviewSaving] = useState({}); // txId → bool

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
    setForm({ category: tx.category, type: tx.type, property_id: tx.property_id || '', property_scope: tx.property_scope || 'single' });
    setModal(tx);
    setModalError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setModalError(null);
    try {
      const updated = await updateTransaction(modal.id, {
        category: form.category, type: form.type,
        property_id: form.property_scope === 'portfolio' ? null : (form.property_id || null),
        property_scope: form.property_scope,
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
    // Only pre-select if a tenant is already assigned — never default to a guess
    setAssignTenantId(tx.tenant_id ? String(tx.tenant_id) : '');
    setLearnPattern(false);
    setAssignModal(tx);
    setContextMenu(null);
  };

  const handleAssignSave = async () => {
    setAssignSaving(true);
    try {
      const updated = await assignTenant(assignModal.id, {
        tenant_id: assignTenantId ? parseInt(assignTenantId) : null,
        learn_pattern: learnPattern,
      });
      setTransactions(txs => txs.map(t => t.id === assignModal.id ? updated : t));
      showToast(learnPattern ? 'Tenant assigned — payer pattern saved for future matching' : 'Tenant assigned');
      setAssignModal(null);
    } catch {
      showToast('Failed to assign tenant');
    } finally {
      setAssignSaving(false);
    }
  };

  const handleAutoMatch = async () => {
    try {
      const result = await autoMatchRent();
      await reload();
      const parts = [];
      if (result.pattern)     parts.push(`${result.pattern} via pattern`);
      if (result.exact)       parts.push(`${result.exact} exact`);
      if (result.amount_only) parts.push(`${result.amount_only} amount-only`);
      if (result.ambiguous)   parts.push(`${result.ambiguous} ambiguous`);
      showToast(`Matched ${result.matched} of ${result.total}: ${parts.join(', ')}`);
    } catch {
      showToast('Auto-match failed');
    }
  };

  const handleBackfill = async () => {
    try {
      const r = await backfillPropertyTenant();
      await reload();
      showToast(
        `Auto-fill: ${r.fromTenant} property from tenant, ${r.fromPropertyAmt} tenant from property+amount, ${r.fromUniqueAmt} from unique rent amount`
      );
    } catch {
      showToast('Auto-fill failed');
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

  const handleResetAmbiguous = async () => {
    const count = transactions.filter(t =>
      t.type === 'income' && t.tenant_id && ['amount_only', 'partial'].includes(t.match_confidence)
    ).length;
    if (!window.confirm(
      `This will un-assign tenant from ${count} rent transaction${count === 1 ? '' : 's'} that were matched with low confidence. You'll then manually review them. Continue?`
    )) return;
    try {
      const r = await resetAmbiguousRentMatches();
      await reload();
      showToast(`Reset ${r.reset} ambiguous auto-matches — review them in the Needs Rent Review tab`);
      if (r.reset > 0) setFilter('rent_review');
    } catch {
      showToast('Reset failed');
    }
  };

  const handleQuickAssign = async (tx) => {
    const tenantId = reviewSelections[tx.id];
    if (!tenantId) { showToast('Select a tenant first'); return; }
    setReviewSaving(s => ({ ...s, [tx.id]: true }));
    try {
      const updated = await assignTenant(tx.id, { tenant_id: parseInt(tenantId), learn_pattern: true });
      setTransactions(txs => txs.map(t => t.id === tx.id ? updated : t));
      showToast('Tenant assigned — payer pattern saved');
    } catch {
      showToast('Failed to assign tenant');
    } finally {
      setReviewSaving(s => ({ ...s, [tx.id]: false }));
    }
  };

  const handleContextMenu = (e, tx) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tx });
  };

  const openRuleModal = (tx) => {
    setRuleModal({ keyword: tx.description, category: tx.category, type: tx.type });
    setContextMenu(null);
  };

  const handleRentMonthEdit = async (tx, rent_month) => {
    try {
      const updated = await setRentMonth(tx.id, rent_month);
      setTransactions(txs => txs.map(t => t.id === tx.id ? { ...t, ...updated } : t));
      showToast('Rent month updated');
    } catch {
      showToast('Failed to update rent month');
    }
  };

  const tenantFilterName = tenantIdFilter
    ? (tenants.find(t => t.id === tenantIdFilter)?.name || `Tenant #${tenantIdFilter}`)
    : null;

  const needsRentReview = transactions.filter(t => t.type === 'income' && t.needs_review).length;
  const ambiguousAssignedCount = transactions.filter(t =>
    t.type === 'income' && t.tenant_id && ['amount_only', 'partial'].includes(t.match_confidence)
  ).length;

  const filtered = transactions.filter(tx => {
    if (tenantIdFilter && tx.tenant_id !== tenantIdFilter) return false;
    if (filter === 'unmatched')    return tx.type === 'income' && !tx.tenant_id;
    if (filter === 'ambiguous')    return tx.needs_review;
    if (filter === 'rent_review')  return tx.type === 'income' && tx.needs_review;
    if (filter === 'portfolio')    return tx.property_scope === 'portfolio';
    return true;
  });

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const income    = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
  const expenses  = Math.abs(transactions.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
  const unmatched = transactions.filter(t => t.type === 'income' && !t.tenant_id).length;
  const ambiguous = transactions.filter(t => t.needs_review).length;
  const portfolio = transactions.filter(t => t.property_scope === 'portfolio').length;

  const isReviewTab = filter === 'rent_review';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Transactions</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={handleAutoMatch}>Auto-Match Rent</button>
          <button className="btn-secondary" onClick={handleBackfill}>Auto-Fill Property &amp; Tenant</button>
          <button className="btn-secondary" onClick={() => handleBulkCategorize(false)}>Apply Rules</button>
          <button className="btn-secondary" onClick={() => handleBulkCategorize(true)}>Re-Apply All</button>
          {ambiguousAssignedCount > 0 && (
            <button className="btn-warning" onClick={handleResetAmbiguous}>
              Reset Ambiguous Tenant Assignments
            </button>
          )}
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi-item">
          <div className="kpi-label">Total Income</div>
          <div className="kpi-value">{formatMoney(income)}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Total Expenses</div>
          <div className="kpi-value">{formatMoney(expenses)}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Net</div>
          <div className={`kpi-value${income - expenses < 0 ? ' negative' : ''}`}>{formatMoney(income - expenses)}</div>
        </div>
        <div className="kpi-item" style={{ cursor: 'pointer' }} onClick={() => setFilter(f => f === 'unmatched' ? 'all' : 'unmatched')}>
          <div className="kpi-label">Unmatched Rent</div>
          <div className={`kpi-value${unmatched > 0 ? ' negative' : ' muted'}`}>{unmatched}</div>
        </div>
        <div className="kpi-item" style={{ cursor: 'pointer' }} onClick={() => setFilter(f => f === 'rent_review' ? 'all' : 'rent_review')}>
          <div className="kpi-label">Needs Review</div>
          <div className={`kpi-value${needsRentReview > 0 ? ' negative' : ' muted'}`}>{needsRentReview}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="filter-tabs">
          {[
            { key: 'all',         label: `All (${transactions.length})` },
            { key: 'portfolio',   label: `All Properties (${portfolio})` },
            { key: 'unmatched',   label: `Unmatched rent (${unmatched})` },
            { key: 'ambiguous',   label: `Needs review (${ambiguous})` },
            { key: 'rent_review', label: `Needs Rent Review (${needsRentReview})`, urgent: needsRentReview > 0 },
          ].map(({ key, label, urgent }) => (
            <button
              key={key}
              className={`filter-tab${filter === key ? ' active' : ''}`}
              onClick={() => setFilter(key)}
              style={urgent && filter !== key ? { color: '#DC2626', fontWeight: 600 } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        {sortCol && <button className="btn-edit" onClick={resetSort}>Reset sort</button>}
      </div>
      {tenantFilterName && (
        <div style={{ marginBottom: 8, padding: '6px 12px', background: '#F5F5F5', border: '1px solid #E5E5E5', borderRadius: 2, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
          Filtered by tenant: <strong>{tenantFilterName}</strong>
          <a href="/transactions" style={{ fontSize: 12, color: '#E30613', textDecoration: 'none' }}>✕ Clear filter</a>
        </div>
      )}

      {isReviewTab && needsRentReview === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: '#666', fontSize: 14, border: '1px solid #E5E5E5', borderRadius: 4, margin: '8px 0' }}>
          No rent deposits need review — all income has been matched or is unambiguous.
        </div>
      )}

      {isReviewTab && needsRentReview > 0 && (
        <div style={{ marginBottom: 8, padding: '8px 12px', background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 4, fontSize: 13, color: '#92400E' }}>
          <strong>⚠ {needsRentReview} rent deposit{needsRentReview === 1 ? '' : 's'} need review</strong> — select the correct tenant and click ✓ Assign &amp; Learn to confirm.
        </div>
      )}

      <table className="tx-table">
        <colgroup>
          <col style={{ width: 100 }} />
          <col />
          <col style={{ width: 100 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 140 }} />
          {isReviewTab && <col style={{ width: 260 }} />}
          <col style={{ width: 90 }} />
          <col style={{ width: 60 }} />
        </colgroup>
        <thead>
          <tr>
            {[
              { col: 'date',        label: 'Date' },
              { col: 'description', label: 'Description' },
              { col: 'amount',      label: 'Amount',   cls: 'num' },
              { col: 'type',        label: 'Type' },
              { col: 'category',    label: 'Category' },
              { col: 'property',    label: 'Property' },
              { col: 'tenant',      label: 'Tenant' },
            ].map(({ col, label, cls }) => (
              <th key={col} className={[cls, 'sortable', sortCol === col ? 'sort-active' : ''].filter(Boolean).join(' ')} onClick={() => handleSort(col)}>
                {label}{sortCol === col && <span className="sort-caret">{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
            {isReviewTab && <th>Assign Tenant</th>}
            <th>Rent Month</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sortRows(filtered, sortCol, sortDir, TX_COL_DEFS).map(tx => {
            const txAmt = parseFloat(tx.amount);
            // Candidate tenants: exact amount match first, fall back to within 10%
            const exactCandidates = tenants.filter(t => Math.abs(parseFloat(t.monthly_rent) - txAmt) <= 1);
            const reviewCandidates = exactCandidates.length > 0
              ? exactCandidates
              : tenants.filter(t => Math.abs(parseFloat(t.monthly_rent) - txAmt) / Math.max(txAmt, 1) <= 0.10);

            return (
              <tr
                key={tx.id}
                onContextMenu={e => handleContextMenu(e, tx)}
                style={isReviewTab ? { background: '#FFFBEB' } : undefined}
              >
                <td className="nowrap mono">{formatDate(tx.date)}</td>
                <td className="col-desc" title={tx.description}>{tx.display_description || tx.description}</td>
                <td className="num mono">{formatMoney(Math.abs(txAmt))}</td>
                <td className="nowrap"><span className={`badge ${tx.type}`}>{tx.type}</span></td>
                <td className="nowrap">{tx.category}</td>
                <td style={{ color: '#666' }}>
                  {tx.property_scope === 'portfolio'
                    ? <span style={{ fontStyle: 'italic', fontVariant: 'small-caps', fontWeight: 600, fontSize: 11, color: '#444' }}>🏘 All Properties</span>
                    : (tx.property_name || '—')
                  }
                </td>
                <td className="nowrap"><MatchStatus tx={tx} onAssign={openAssign} /></td>
                {isReviewTab && (
                  <td style={{ padding: '4px 8px' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select
                        className="form-input"
                        style={{ height: 26, padding: '0 4px', fontSize: 12, flex: 1 }}
                        value={reviewSelections[tx.id] || ''}
                        onChange={e => setReviewSelections(s => ({ ...s, [tx.id]: e.target.value }))}
                      >
                        <option value="">— Select tenant —</option>
                        {reviewCandidates.map(t => {
                          const delta = parseFloat(t.monthly_rent) - txAmt;
                          const tag = Math.abs(delta) <= 1 ? 'exact' : `${delta > 0 ? '+' : ''}$${Math.abs(delta).toFixed(0)}`;
                          const prop = properties.find(p => p.id === t.property_id);
                          return (
                            <option key={t.id} value={t.id}>
                              {t.name}{prop ? ` — ${prop.name}` : ''} ({tag})
                            </option>
                          );
                        })}
                        {reviewCandidates.length === 0 && tenants.map(t => {
                          const prop = properties.find(p => p.id === t.property_id);
                          return (
                            <option key={t.id} value={t.id}>
                              {t.name}{prop ? ` — ${prop.name}` : ''} ({formatMoney(t.monthly_rent)}/mo)
                            </option>
                          );
                        })}
                      </select>
                      <button
                        className="btn-secondary"
                        style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '2px 8px', height: 26 }}
                        disabled={!reviewSelections[tx.id] || reviewSaving[tx.id]}
                        onClick={() => handleQuickAssign(tx)}
                      >
                        {reviewSaving[tx.id] ? '…' : '✓ Assign & Learn'}
                      </button>
                    </div>
                  </td>
                )}
                <td className="nowrap" style={{ fontSize: 11 }}>
                  {tx.type === 'income' && tx.tenant_id ? (
                    editingCell?.txId === tx.id && editingCell?.field === 'rent_month' ? (
                      <select
                        autoFocus
                        className="form-input"
                        style={{ height: 24, padding: '0 4px', fontSize: 11 }}
                        value={tx.rent_month || ''}
                        onChange={e => { handleRentMonthEdit(tx, e.target.value); setEditingCell(null); }}
                        onBlur={() => setEditingCell(null)}
                      >
                        {RENT_MONTH_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span
                        onClick={() => setEditingCell({ txId: tx.id, field: 'rent_month' })}
                        style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
                        title="Click to change rent month"
                      >
                        {tx.needs_month_review && <span style={{ color: '#F59E0B', marginRight: 3 }}>●</span>}
                        {formatRentMonth(tx.rent_month)}
                      </span>
                    )
                  ) : <span style={{ color: '#ccc' }}>—</span>}
                </td>
                <td className="nowrap">
                  <button className="btn-edit" onClick={() => openEdit(tx)}>Edit</button>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && !isReviewTab && (
            <tr><td colSpan={isReviewTab ? 10 : 9} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No transactions match this filter.</td></tr>
          )}
        </tbody>
      </table>

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <div className="context-menu-item" onClick={() => openAssign(contextMenu.tx)}>Assign tenant</div>
          <div className="context-menu-item" onClick={() => openRuleModal(contextMenu.tx)}>Create rule from this</div>
          <div className="context-menu-item" onClick={() => { openEdit(contextMenu.tx); setContextMenu(null); }}>Edit transaction</div>
        </div>
      )}

      {modal !== null && (
        <Modal title="Edit Transaction" onClose={() => setModal(null)} onSave={handleSave} saving={saving} error={modalError}>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 16, padding: '8px 12px', border: '1px solid #E5E5E5', borderRadius: 2 }}>
            <strong>{modal.description}</strong>
            <span style={{ marginLeft: 10, color: '#888' }}>{formatDate(modal.date)}</span>
            <span className="mono" style={{ marginLeft: 10 }}>{formatMoney(Math.abs(parseFloat(modal.amount)))}</span>
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
            <select
              className="form-input"
              value={form.property_scope === 'portfolio' ? 'portfolio' : (form.property_id ? String(form.property_id) : '')}
              onChange={e => {
                if (e.target.value === 'portfolio') {
                  setForm(f => ({ ...f, property_scope: 'portfolio', property_id: '' }));
                } else {
                  setForm(f => ({ ...f, property_scope: 'single', property_id: e.target.value }));
                }
              }}
            >
              <option value="">— Select Property —</option>
              <option value="portfolio">🏘 ALL PROPERTIES (Portfolio)</option>
              <option disabled>──────────────</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </Modal>
      )}

      {assignModal && (() => {
        const txAmt = parseFloat(assignModal.amount);
        const sortedTenants = [...tenants].sort((a, b) =>
          Math.abs(parseFloat(a.monthly_rent) - txAmt) - Math.abs(parseFloat(b.monthly_rent) - txAmt)
        );
        return (
          <Modal title="Assign Tenant" onClose={() => setAssignModal(null)} onSave={handleAssignSave} saving={assignSaving}>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 16, padding: '8px 12px', border: '1px solid #E5E5E5', borderRadius: 2 }}>
              <strong>{assignModal.description}</strong>
              <span className="mono" style={{ marginLeft: 10 }}>{formatMoney(Math.abs(txAmt))}</span>
            </div>
            <div className="form-group">
              <label>Tenant</label>
              <select className="form-input" value={assignTenantId} onChange={e => setAssignTenantId(e.target.value)}>
                <option value="">— Unassign —</option>
                {sortedTenants.map(t => {
                  const delta = parseFloat(t.monthly_rent) - txAmt;
                  const deltaLabel = Math.abs(delta) < 1 ? 'exact match' : `${delta > 0 ? '+' : ''}$${Math.abs(delta).toFixed(0)} from rent`;
                  return (
                    <option key={t.id} value={t.id}>
                      {t.name} — {formatMoney(t.monthly_rent)}/mo ({deltaLabel})
                    </option>
                  );
                })}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" checked={learnPattern} onChange={e => setLearnPattern(e.target.checked)} />
              Remember this payer — auto-match future deposits from this description to this tenant
            </label>
          </Modal>
        );
      })()}

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
