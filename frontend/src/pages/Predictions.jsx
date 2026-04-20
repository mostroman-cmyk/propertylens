import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getProperties, getTenants, getPredictions, runPredictions,
  acceptPrediction, rejectPrediction, acceptAllHighConfidence,
  bulkAcceptPredictions, getPredictionActivity,
  getSimilarTraining, getMisclassifiedPatterns, bulkFixPredictions,
} from '../api';
import { formatMoney, formatDate } from '../utils/format';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import Toast, { useToast } from '../components/Toast';

const CATEGORIES = ['rent', 'Repairs', 'Insurance', 'Utilities', 'Maintenance', 'Property Tax', 'Landscaping', 'HOA', 'Mortgage', 'Other Income', 'Other'];

function groupByNormalized(txs) {
  const map = new Map();
  for (const tx of txs) {
    const key = tx.normalized_description || tx.description;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tx);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, items]) => ({ key, items }));
}

function predictingFields(tx) {
  const f = [];
  if (tx.predicted_category) f.push('CATEGORY');
  if (tx.predicted_property_id || tx.predicted_property_scope === 'portfolio') f.push('PROPERTY');
  if (tx.predicted_tenant_id) f.push('TENANT');
  return f;
}

function ConfBadge({ level }) {
  return <span className={`conf-badge conf-${level}`}>{level === 'MEDIUM' ? 'MED' : level}</span>;
}

function PredCell({ value, empty }) {
  if (!value) return <span style={{ color: '#ccc', fontSize: 12 }}>{empty || '—'}</span>;
  return <span className="pred-cell">{value}</span>;
}

// Info popover: fetches live similar training data
function SimilarTrainingPopover({ tx, onClose }) {
  const ref = useRef(null);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  useEffect(() => {
    const norm = tx.normalized_description || tx.description;
    getSimilarTraining(norm)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [tx]);

  // Stored examples (from prediction_examples JSON)
  let storedExamples = [];
  try { storedExamples = JSON.parse(tx.prediction_examples || '[]'); } catch {}

  return (
    <div ref={ref} style={{
      position: 'absolute', zIndex: 1000, right: 0, top: '100%',
      background: '#fff', border: '1px solid #E5E5E5', borderRadius: 4,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 14, minWidth: 420, maxWidth: 560,
    }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Why this prediction?</div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>{tx.prediction_reasoning}</div>

      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Similar past classifications
      </div>
      {loading && <div style={{ fontSize: 12, color: '#aaa', padding: '6px 0' }}>Loading...</div>}
      {!loading && rows && rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E5E5' }}>
              <th style={{ padding: '3px 6px', textAlign: 'left', color: '#888', fontWeight: 600 }}>Date</th>
              <th style={{ padding: '3px 6px', textAlign: 'left', color: '#888', fontWeight: 600 }}>Description</th>
              <th style={{ padding: '3px 6px', textAlign: 'right', color: '#888', fontWeight: 600 }}>Amount</th>
              <th style={{ padding: '3px 6px', textAlign: 'left', color: '#888', fontWeight: 600 }}>Category</th>
              <th style={{ padding: '3px 6px', textAlign: 'left', color: '#888', fontWeight: 600 }}>Property</th>
              <th style={{ padding: '3px 6px', textAlign: 'left', color: '#888', fontWeight: 600 }}>Tenant</th>
              <th style={{ padding: '3px 6px', textAlign: 'right', color: '#888', fontWeight: 600 }}>Sim</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i} style={{ borderBottom: '1px solid #F5F5F5' }}>
                <td style={{ padding: '3px 6px', color: '#999', whiteSpace: 'nowrap' }}>
                  {formatDate(r.date)}
                </td>
                <td style={{ padding: '3px 6px', color: '#333', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={r.description}>
                  {r.display_description || r.description}
                </td>
                <td style={{ padding: '3px 6px', color: '#555', whiteSpace: 'nowrap', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace' }}>
                  {formatMoney(Math.abs(parseFloat(r.amount)))}
                </td>
                <td style={{ padding: '3px 6px', color: '#555' }}>{r.category}</td>
                <td style={{ padding: '3px 6px', color: '#555', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={r.property_name}>
                  {r.property_name || <span style={{ color: '#ccc' }}>—</span>}
                </td>
                <td style={{ padding: '3px 6px', color: '#555' }}>{r.tenant_name || <span style={{ color: '#ccc' }}>—</span>}</td>
                <td style={{ padding: '3px 6px', color: '#999', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {Math.round(r.similarity * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && (!rows || rows.length === 0) && (
        <div style={{ fontSize: 11, color: '#999', fontStyle: 'italic' }}>
          {storedExamples.length > 0
            ? 'No similar transactions found (prediction may be from a keyword rule).'
            : 'No similar classified transactions found. Prediction is based on keyword/amount rule or payer history.'}
        </div>
      )}
      {!loading && storedExamples.length > 0 && rows && rows.length === 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', margin: '8px 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Contributing (stored)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <tbody>
              {storedExamples.map((ex, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F5F5F5' }}>
                  <td style={{ padding: '3px 6px', color: '#333', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={ex.description}>
                    {ex.description || ex.normalized}
                  </td>
                  <td style={{ padding: '3px 6px', color: '#555' }}>{ex.category}</td>
                  <td style={{ padding: '3px 6px', color: '#999', textAlign: 'right' }}>{ex.similarity}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// Modal for bulk-fixing a prediction group
function BulkFixModal({ group, properties, tenants, onClose, onFixed }) {
  const { key, items } = group;
  const first = items[0];
  const dispDesc = first.display_description || first.description;

  // Detect whether amounts vary in this group
  const amounts = [...new Set(items.map(tx => Math.abs(parseFloat(tx.amount))))].sort((a, b) => a - b);
  const amountsVary = amounts.length > 1;

  const [form, setForm] = useState({
    category:           first.predicted_category || '',
    property_scope:     first.predicted_property_scope || 'single',
    property_id:        first.predicted_property_id ? String(first.predicted_property_id) : '',
    tenant_id:          first.predicted_tenant_id   ? String(first.predicted_tenant_id)   : '',
    amount_filter:      amountsVary ? String(Math.abs(parseFloat(first.amount))) : '',
    apply_to_group:     true,
    fix_historical:     true,
    save_as_rule:       true,
    rerun_predictions:  true,
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError]   = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await bulkFixPredictions({
        norm_key:          key,
        category:          form.category || null,
        property_id:       form.property_scope === 'portfolio' ? null : (form.property_id || null),
        property_scope:    form.property_scope,
        tenant_id:         form.tenant_id || null,
        fix_historical:    form.fix_historical,
        save_as_rule:      form.save_as_rule,
        rerun_predictions: form.rerun_predictions,
        amount_filter:     form.amount_filter !== '' ? parseFloat(form.amount_filter) : null,
      });
      setResult(res);
      setTimeout(() => { onFixed(res); onClose(); }, 1500);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to apply fix');
      setSaving(false);
    }
  };

  const sectionLabel = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#888', marginBottom: 10, marginTop: 18, borderBottom: '1px solid #E5E5E5', paddingBottom: 4,
  };
  const checkRow = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 8 };
  const checkNote = { fontSize: 11, color: '#888', paddingLeft: 22, marginTop: -4, marginBottom: 8 };

  return (
    <Modal
      title={`Fix Group: ${dispDesc} — ${items.length} transaction${items.length !== 1 ? 's' : ''}`}
      onClose={onClose}
      onSave={result ? null : handleSave}
      saveLabel="Apply Fix"
      saving={saving}
      width={600}
    >
      {/* SUMMARY */}
      <div style={sectionLabel}>Summary</div>
      <div style={{ fontSize: 13, color: '#333', padding: '8px 12px', background: '#F5F5F5', borderRadius: 2, marginBottom: 4 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span><strong>{items.length}</strong> pending prediction{items.length !== 1 ? 's' : ''}</span>
          {first.predicted_category && <span>Category: <strong>{first.predicted_category}</strong></span>}
          {(first.predicted_property_name || first.predicted_property_scope === 'portfolio') && (
            <span>Property: <strong>{first.predicted_property_scope === 'portfolio' ? 'All Properties' : first.predicted_property_name}</strong></span>
          )}
          {first.predicted_tenant_name && <span>Tenant: <strong>{first.predicted_tenant_name}</strong></span>}
        </div>
        {amountsVary && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#B45309', background: '#FEF9C3', padding: '4px 8px', borderRadius: 2 }}>
            ⚠ {amounts.length} different amounts: {amounts.map(a => `$${a.toLocaleString()}`).join(', ')}.
            Use <strong>Merchant Rules</strong> to route each amount to a different property.
            Or filter below to fix one amount at a time.
          </div>
        )}
      </div>

      {/* SET CORRECT VALUES */}
      <div style={sectionLabel}>Set Correct Values</div>

      {amountsVary && (
        <div className="form-group">
          <label>Filter to Specific Amount</label>
          <select className="form-input" value={form.amount_filter}
            onChange={e => setForm(f => ({ ...f, amount_filter: e.target.value }))}>
            <option value="">All amounts (fix entire group)</option>
            {amounts.map(a => <option key={a} value={a}>${a.toLocaleString()}</option>)}
          </select>
        </div>
      )}

      <div className="form-row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: '1 1 140px', minWidth: 0 }}>
          <label>Category</label>
          <select className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            <option value="">— Keep current —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: '2 1 180px', minWidth: 0 }}>
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
            <option value="">— Keep current —</option>
            <option value="portfolio">🏘 All Properties (Portfolio)</option>
            <option disabled>──────────────</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: '1 1 140px', minWidth: 0 }}>
          <label>Tenant</label>
          <select className="form-input" value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}>
            <option value="">— Keep current —</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* OPTIONS */}
      <div style={sectionLabel}>Options</div>

      <label style={checkRow}>
        <input type="checkbox" checked={form.apply_to_group}
          onChange={e => setForm(f => ({ ...f, apply_to_group: e.target.checked }))} />
        Apply to all {items.length} transaction{items.length !== 1 ? 's' : ''} in this group
      </label>

      <label style={checkRow}>
        <input type="checkbox" checked={form.fix_historical}
          onChange={e => setForm(f => ({ ...f, fix_historical: e.target.checked }))} />
        Update past classified transactions with this pattern too
      </label>
      <div style={checkNote}>Corrects bad training data so the model learns the right answer.</div>

      <label style={checkRow}>
        <input type="checkbox" checked={form.save_as_rule}
          onChange={e => setForm(f => ({ ...f, save_as_rule: e.target.checked }))} />
        Save as permanent rule for future transactions
      </label>
      <div style={checkNote}>Creates a Merchant Rule entry that overrides all prediction logic going forward.</div>

      <label style={checkRow}>
        <input type="checkbox" checked={form.rerun_predictions}
          onChange={e => setForm(f => ({ ...f, rerun_predictions: e.target.checked }))} />
        Re-run predictions after applying
      </label>
      <div style={checkNote}>Updates all pending predictions immediately using the corrected data.</div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#FEE2E2', borderRadius: 2, fontSize: 13, color: '#DC2626', marginTop: 8 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ padding: '8px 12px', background: '#DCFCE7', borderRadius: 2, fontSize: 13, color: '#16A34A', marginTop: 8 }}>
          Fixed {result.predictions_updated} prediction{result.predictions_updated !== 1 ? 's' : ''}
          {result.historical_updated > 0 ? ` + ${result.historical_updated} historical` : ''}
          {result.rule_created ? ' · Rule saved' : ''}.
          {form.rerun_predictions ? ' Re-predicting...' : ''}
        </div>
      )}
    </Modal>
  );
}

// Misclassified patterns modal
function MisclassifiedPatternsModal({ properties, tenants, onClose, onFixed }) {
  const [patterns, setPatterns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fixTarget, setFixTarget] = useState(null);

  useEffect(() => {
    getMisclassifiedPatterns().then(setPatterns).finally(() => setLoading(false));
  }, []);

  if (fixTarget) {
    return (
      <BulkFixModal
        group={{ key: fixTarget.normalized_description, items: [{ display_description: fixTarget.normalized_description, description: fixTarget.normalized_description, predicted_category: fixTarget.categories?.[0], predicted_property_scope: 'single', predicted_property_id: null, predicted_tenant_id: null, amount: fixTarget.min_amount }] }}
        properties={properties} tenants={tenants}
        onClose={() => setFixTarget(null)}
        onFixed={(res) => {
          onFixed(res);
          setFixTarget(null);
          // Refresh list
          setLoading(true);
          getMisclassifiedPatterns().then(setPatterns).finally(() => setLoading(false));
        }}
      />
    );
  }

  return (
    <Modal title="Misclassified Patterns" onClose={onClose} width={740}>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        Merchants where the same normalized description has been assigned to different properties or categories.
        These are likely bad training data causing prediction errors.
      </div>
      {loading && <div style={{ color: '#888', fontSize: 13 }}>Loading...</div>}
      {!loading && patterns && patterns.length === 0 && (
        <div style={{ color: '#888', fontSize: 13 }}>No inconsistencies found — training data looks clean!</div>
      )}
      {!loading && patterns && patterns.length > 0 && (
        <table className="tx-table" style={{ fontSize: 12 }}>
          <colgroup>
            <col /><col style={{ width: 55 }} /><col style={{ width: 200 }} /><col style={{ width: 150 }} /><col style={{ width: 100 }} /><col style={{ width: 80 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Pattern</th>
              <th className="num">Count</th>
              <th>Properties Assigned</th>
              <th>Categories</th>
              <th>Amounts</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p, i) => (
              <tr key={i}>
                <td style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={p.normalized_description}>
                  {p.normalized_description}
                </td>
                <td className="num mono">{p.count}</td>
                <td style={{ fontSize: 11 }}>
                  {(p.properties || []).map((prop, j) => (
                    <span key={j} style={{ display: 'inline-block', marginRight: 4, marginBottom: 2, background: '#FEE2E2', color: '#DC2626', padding: '1px 5px', borderRadius: 2, fontSize: 10, fontWeight: 600 }}>
                      {prop}
                    </span>
                  ))}
                </td>
                <td style={{ fontSize: 11 }}>
                  {(p.categories || []).join(', ')}
                </td>
                <td className="mono" style={{ fontSize: 11, color: '#888' }}>
                  ${Math.abs(parseFloat(p.min_amount)).toLocaleString()}
                  {p.min_amount !== p.max_amount ? `–$${Math.abs(parseFloat(p.max_amount)).toLocaleString()}` : ''}
                </td>
                <td>
                  <button className="btn-warning" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setFixTarget(p)}>
                    Fix
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function ActivityLog({ activity }) {
  if (!activity || activity.length === 0) return null;
  const eventLabel = (type) => ({
    manual_classify: 'Manual classify',
    accept:          'Prediction accepted',
    bulk_accept:     'Bulk accept',
    accept_all_high: 'Accept all HIGH',
    manual_retrain:  'Manual re-train',
  }[type] || type);

  return (
    <div style={{ marginTop: 40, borderTop: '1px solid #E5E5E5', paddingTop: 24 }}>
      <h2 className="section-title" style={{ marginBottom: 12 }}>Recent Learning Activity</h2>
      <table className="tx-table">
        <colgroup>
          <col style={{ width: 140 }} /><col style={{ width: 130 }} /><col />
          <col style={{ width: 70 }} /><col style={{ width: 70 }} /><col style={{ width: 70 }} /><col style={{ width: 70 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Time</th><th>Event</th><th>Transaction</th>
            <th className="num">Similar</th><th className="num">HIGH</th>
            <th className="num">MED</th><th className="num">LOW</th>
          </tr>
        </thead>
        <tbody>
          {activity.map(row => (
            <tr key={row.id}>
              <td className="mono nowrap" style={{ fontSize: 11 }}>
                {new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                {new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </td>
              <td style={{ fontSize: 12, color: '#555' }}>{eventLabel(row.event_type)}</td>
              <td className="col-desc" style={{ fontSize: 12 }} title={row.tx_desc}>{row.tx_desc || '—'}</td>
              <td className="num mono" style={{ fontSize: 12 }}>{row.affected}</td>
              <td className="num mono" style={{ fontSize: 12, color: row.high_count > 0 ? '#16A34A' : '#ccc' }}>{row.high_count}</td>
              <td className="num mono" style={{ fontSize: 12, color: '#555' }}>{row.medium_count}</td>
              <td className="num mono" style={{ fontSize: 12, color: row.low_count > 0 ? '#F59E0B' : '#ccc' }}>{row.low_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PredColGroup() {
  return (
    <colgroup>
      <col style={{ width: 80 }} /><col /><col style={{ width: 90 }} />
      <col style={{ width: 110 }} /><col style={{ width: 150 }} /><col style={{ width: 130 }} />
      <col style={{ width: 58 }} /><col style={{ width: 170 }} /><col style={{ width: 120 }} />
    </colgroup>
  );
}

function PredTableHead() {
  return (
    <thead>
      <tr>
        <th>Date</th><th>Description</th><th className="num">Amount</th>
        <th>→ Category</th><th>→ Property</th><th>→ Tenant</th>
        <th>Conf</th><th>Reasoning</th><th></th>
      </tr>
    </thead>
  );
}

export default function Predictions() {
  const [predictions, setPredictions]   = useState([]);
  const [properties, setProperties]     = useState([]);
  const [tenants, setTenants]           = useState([]);
  const [activity, setActivity]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [running, setRunning]           = useState(false);
  const [accepting, setAccepting]       = useState(false);
  const [bulkAccepting, setBulkAccepting] = useState(null);
  const [editModal, setEditModal]       = useState(null);
  const [fixModal, setFixModal]         = useState(null);
  const [activePopover, setActivePopover] = useState(null);
  const [showMisclassified, setShowMisclassified] = useState(false);
  const { toast, showToast } = useToast();

  const reload = useCallback(async () => {
    const [data, act] = await Promise.all([getPredictions(), getPredictionActivity()]);
    setPredictions(data);
    setActivity(act);
  }, []);

  useEffect(() => {
    Promise.all([getPredictions(), getProperties(), getTenants(), getPredictionActivity()])
      .then(([pred, props, tens, act]) => {
        setPredictions(pred);
        setProperties(props);
        setTenants(tens);
        setActivity(act);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleRunPredictions = async () => {
    setRunning(true);
    try {
      const result = await runPredictions();
      await reload();
      showToast(`Re-trained: ${result.predicted} updated — ${result.counts.HIGH} HIGH, ${result.counts.MEDIUM} MED, ${result.counts.LOW} LOW`);
    } catch { showToast('Prediction failed'); }
    finally { setRunning(false); }
  };

  const handleAcceptAllHigh = async () => {
    setAccepting(true);
    try {
      const result = await acceptAllHighConfidence();
      await reload();
      showToast(`Accepted ${result.accepted} HIGH confidence predictions`);
    } catch { showToast('Failed to accept predictions'); }
    finally { setAccepting(false); }
  };

  const handleBulkAccept = async (ids, label) => {
    setBulkAccepting(label);
    try {
      const result = await bulkAcceptPredictions(ids);
      setPredictions(prev => prev.filter(p => !ids.includes(p.id)));
      showToast(`Accepted ${result.accepted} predictions`);
      setTimeout(() => reload(), 2000);
    } catch { showToast('Failed to accept'); }
    finally { setBulkAccepting(null); }
  };

  const handleAccept = async (tx, overrides = {}) => {
    try {
      await acceptPrediction(tx.id, overrides);
      setPredictions(prev => prev.filter(p => p.id !== tx.id));
      showToast('Accepted');
      setTimeout(() => reload(), 2000);
    } catch { showToast('Failed to accept'); }
  };

  const handleReject = async (tx) => {
    try {
      await rejectPrediction(tx.id);
      setPredictions(prev => prev.filter(p => p.id !== tx.id));
      showToast('Rejected');
    } catch { showToast('Failed to reject'); }
  };

  const openEdit = (tx) => {
    setEditModal({
      tx,
      category:       tx.predicted_category || '',
      property_scope: tx.predicted_property_scope || 'single',
      property_id:    tx.predicted_property_id ? String(tx.predicted_property_id) : '',
      tenant_id:      tx.predicted_tenant_id  ? String(tx.predicted_tenant_id)    : '',
    });
  };

  const handleEditAccept = async () => {
    const overrides = {};
    if (editModal.category) overrides.category = editModal.category;
    if (editModal.property_scope === 'portfolio') {
      overrides.property_scope = 'portfolio';
      overrides.property_id = null;
    } else if (editModal.property_id) {
      overrides.property_scope = 'single';
      overrides.property_id = parseInt(editModal.property_id);
    }
    if (editModal.tenant_id) overrides.tenant_id = parseInt(editModal.tenant_id);
    await handleAccept(editModal.tx, overrides);
    setEditModal(null);
  };

  if (loading) return <div className="loading">Loading...</div>;

  const highCount = predictions.filter(p => p.prediction_confidence === 'HIGH').length;

  const confidenceTiers = [
    { label: 'HIGH',   txs: predictions.filter(p => p.prediction_confidence === 'HIGH')   },
    { label: 'MEDIUM', txs: predictions.filter(p => p.prediction_confidence === 'MEDIUM') },
    { label: 'LOW',    txs: predictions.filter(p => p.prediction_confidence === 'LOW')    },
  ].filter(g => g.txs.length > 0);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Predictions</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => setShowMisclassified(true)}>
            Fix Misclassified Patterns
          </button>
          <button className="btn-secondary" onClick={handleRunPredictions} disabled={running}>
            {running ? 'Running...' : 'Re-train & Re-predict'}
          </button>
          {highCount > 0 && (
            <button className="btn-primary" onClick={handleAcceptAllHigh} disabled={accepting}>
              {accepting ? 'Accepting...' : `Accept All HIGH (${highCount})`}
            </button>
          )}
        </div>
      </div>

      <div className="kpi-row" style={{ marginBottom: 24 }}>
        <div className="kpi-item">
          <div className="kpi-label">Pending</div>
          <div className="kpi-value muted">{predictions.length}</div>
        </div>
        {confidenceTiers.map(({ label, txs }) => (
          <div className="kpi-item" key={label}>
            <div className="kpi-label">{label}</div>
            <div className={`kpi-value${label === 'LOW' && txs.length > 0 ? ' negative' : label === 'HIGH' ? '' : ' muted'}`}>{txs.length}</div>
          </div>
        ))}
      </div>

      {predictions.length === 0 && (
        <EmptyState
          icon="check"
          title="All caught up"
          description="No predictions waiting for review. New transactions will appear here after each sync."
          primaryAction={{ label: 'Sync Transactions', onClick: async () => { await handleRunPredictions(); } }}
          secondaryAction={{ label: 'Re-train & Re-predict', onClick: handleRunPredictions }}
        />
      )}

      {confidenceTiers.map(({ label, txs }) => {
        const groups = groupByNormalized(txs);
        return (
          <div key={label} style={{ marginBottom: 40 }}>
            <h2 className="section-title" style={{ marginBottom: 12 }}>
              {label} — {txs.length} transaction{txs.length !== 1 ? 's' : ''}
            </h2>

            {groups.map(({ key, items }, groupIdx) => {
              const first = items[0];
              const dispDesc = first.display_description || first.description;
              const predFields = predictingFields(first);
              const propDisplay = first.predicted_property_scope === 'portfolio'
                ? '🏘 All Properties'
                : (first.predicted_property_name || null);

              return (
                <div key={key} style={{ marginBottom: 20 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 12px', background: '#F5F5F5',
                    border: '1px solid #E5E5E5', borderBottom: 'none',
                    borderRadius: '2px 2px 0 0',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0, overflow: 'hidden' }}>
                      {first.predicted_category && (
                        <span style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
                          {first.predicted_category}
                        </span>
                      )}
                      <span style={{ fontSize: 13, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={first.description}>
                        {dispDesc}
                      </span>
                      {propDisplay && (
                        <span style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>· {propDisplay}</span>
                      )}
                      {first.predicted_tenant_name && (
                        <span style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>· {first.predicted_tenant_name}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
                      {predFields.length > 0 && (
                        <span style={{ fontSize: 11, color: '#888' }}>
                          Predicting: {predFields.join(' · ')}
                        </span>
                      )}
                      <button
                        className="btn-warning"
                        style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={() => setFixModal({ key, items })}
                      >
                        Fix Group
                      </button>
                      {items.length > 1 && (
                        <button
                          className="btn-primary"
                          onClick={() => handleBulkAccept(items.map(i => i.id), key)}
                          disabled={bulkAccepting === key}
                        >
                          {bulkAccepting === key ? 'Accepting...' : `Accept all ${items.length}`}
                        </button>
                      )}
                    </div>
                  </div>

                  <table className="tx-table" style={{ marginBottom: 0, borderTop: 'none' }}>
                    <PredColGroup />
                    {groupIdx === 0 && <PredTableHead />}
                    <tbody>
                      {items.map(tx => {
                        const txDisp = tx.display_description || tx.description;
                        const txPropDisplay = tx.predicted_property_scope === 'portfolio'
                          ? '🏘 All Properties'
                          : (tx.predicted_property_name || null);

                        return (
                          <tr key={tx.id} style={{ height: 36 }}>
                            <td className="nowrap mono" style={{ fontSize: 11 }}>
                              {formatDate(tx.date)}
                            </td>
                            <td className="col-desc" title={tx.description} style={{ color: '#555' }}>
                              {txDisp}
                              {tx.payer_name && (
                                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', background: '#F0F0F0', color: '#555', padding: '1px 5px', borderRadius: 2, whiteSpace: 'nowrap', fontFamily: 'IBM Plex Mono, monospace' }}>
                                  {tx.payer_name}
                                </span>
                              )}
                            </td>
                            <td className="num mono">{formatMoney(Math.abs(parseFloat(tx.amount)))}</td>
                            <td><PredCell value={tx.predicted_category} /></td>
                            <td><PredCell value={txPropDisplay} /></td>
                            <td><PredCell value={tx.predicted_tenant_name} /></td>
                            <td><ConfBadge level={tx.prediction_confidence} /></td>
                            <td className="col-desc" style={{ fontSize: 11, color: '#888' }} title={tx.prediction_reasoning}>
                              {tx.prediction_reasoning}
                            </td>
                            <td className="nowrap">
                              <div style={{ display: 'flex', gap: 4, position: 'relative' }}>
                                <button className="btn-edit btn-accept" onClick={() => handleAccept(tx)} title="Accept">✓</button>
                                <button className="btn-edit btn-reject" onClick={() => handleReject(tx)} title="Reject">✗</button>
                                <button className="btn-edit" onClick={() => openEdit(tx)} title="Edit then accept">✎</button>
                                <div style={{ position: 'relative' }}>
                                  <button
                                    className="btn-edit"
                                    onClick={() => setActivePopover(ap => ap === tx.id ? null : tx.id)}
                                    title="View similar past classifications"
                                  >ⓘ</button>
                                  {activePopover === tx.id && (
                                    <SimilarTrainingPopover tx={tx} onClose={() => setActivePopover(null)} />
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        );
      })}

      {editModal && (
        <Modal title="Edit Prediction" onClose={() => setEditModal(null)} onSave={handleEditAccept} saveLabel="Accept with Changes">
          <div style={{ fontSize: 13, color: '#555', marginBottom: 16, padding: '8px 12px', border: '1px solid #E5E5E5', borderRadius: 2 }}>
            <strong>{editModal.tx.display_description || editModal.tx.description}</strong>
            <span className="mono" style={{ marginLeft: 10 }}>{formatMoney(Math.abs(parseFloat(editModal.tx.amount)))}</span>
          </div>
          <div className="form-group">
            <label>Category</label>
            <select className="form-input" value={editModal.category} onChange={e => setEditModal(m => ({ ...m, category: e.target.value }))}>
              <option value="">— None —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Property</label>
            <select
              className="form-input"
              value={editModal.property_scope === 'portfolio' ? 'portfolio' : (editModal.property_id || '')}
              onChange={e => {
                if (e.target.value === 'portfolio') {
                  setEditModal(m => ({ ...m, property_scope: 'portfolio', property_id: '' }));
                } else {
                  setEditModal(m => ({ ...m, property_scope: 'single', property_id: e.target.value }));
                }
              }}
            >
              <option value="">— Select Property —</option>
              <option value="portfolio">🏘 ALL PROPERTIES (Portfolio)</option>
              <option disabled>──────────────</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Tenant</label>
            <select className="form-input" value={editModal.tenant_id} onChange={e => setEditModal(m => ({ ...m, tenant_id: e.target.value }))}>
              <option value="">— None —</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name} (${parseFloat(t.monthly_rent).toLocaleString()}/mo)</option>)}
            </select>
          </div>
        </Modal>
      )}

      {fixModal && (
        <BulkFixModal
          group={fixModal}
          properties={properties}
          tenants={tenants}
          onClose={() => setFixModal(null)}
          onFixed={(res) => {
            showToast(`Fixed ${res.predictions_updated} prediction(s)${res.historical_updated > 0 ? ` + ${res.historical_updated} historical` : ''}`);
            reload();
          }}
        />
      )}

      {showMisclassified && (
        <MisclassifiedPatternsModal
          properties={properties}
          tenants={tenants}
          onClose={() => setShowMisclassified(false)}
          onFixed={(res) => {
            showToast(`Fixed ${res.predictions_updated} prediction(s)${res.historical_updated > 0 ? ` + ${res.historical_updated} historical` : ''}`);
            reload();
          }}
        />
      )}

      <ActivityLog activity={activity} />
      <Toast message={toast} />
    </div>
  );
}
