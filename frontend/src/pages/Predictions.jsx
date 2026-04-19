import { useEffect, useState, useCallback } from 'react';
import { getProperties, getTenants, getPredictions, runPredictions, acceptPrediction, rejectPrediction, acceptAllHighConfidence, bulkAcceptPredictions } from '../api';
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
  // Sort groups: largest first
  return Array.from(map.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, items]) => ({ key, items }));
}

export default function Predictions() {
  const [predictions, setPredictions] = useState([]);
  const [properties, setProperties]   = useState([]);
  const [tenants, setTenants]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [running, setRunning]         = useState(false);
  const [accepting, setAccepting]     = useState(false);
  const [bulkAccepting, setBulkAccepting] = useState(null);
  const [editModal, setEditModal]     = useState(null);
  const { toast, showToast } = useToast();

  const reload = useCallback(async () => {
    const data = await getPredictions();
    setPredictions(data);
  }, []);

  useEffect(() => {
    Promise.all([getPredictions(), getProperties(), getTenants()])
      .then(([pred, props, tens]) => { setPredictions(pred); setProperties(props); setTenants(tens); })
      .finally(() => setLoading(false));
  }, []);

  const handleRunPredictions = async () => {
    setRunning(true);
    try {
      const result = await runPredictions();
      await reload();
      showToast(`Generated ${result.predicted} predictions (${result.counts.HIGH} HIGH, ${result.counts.MEDIUM} MED) from ${result.total} uncategorized`);
    } catch {
      showToast('Prediction failed');
    } finally {
      setRunning(false);
    }
  };

  const handleAcceptAllHigh = async () => {
    setAccepting(true);
    try {
      const result = await acceptAllHighConfidence();
      await reload();
      showToast(`Accepted ${result.accepted} HIGH confidence predictions`);
    } catch {
      showToast('Failed to accept predictions');
    } finally {
      setAccepting(false);
    }
  };

  const handleBulkAccept = async (ids, label) => {
    setBulkAccepting(label);
    try {
      const result = await bulkAcceptPredictions(ids);
      setPredictions(prev => prev.filter(p => !ids.includes(p.id)));
      showToast(`Accepted ${result.accepted} predictions`);
    } catch {
      showToast('Failed to accept');
    } finally {
      setBulkAccepting(null);
    }
  };

  const handleAccept = async (tx, overrides = {}) => {
    try {
      await acceptPrediction(tx.id, overrides);
      setPredictions(prev => prev.filter(p => p.id !== tx.id));
      showToast('Accepted');
    } catch {
      showToast('Failed to accept');
    }
  };

  const handleReject = async (tx) => {
    try {
      await rejectPrediction(tx.id);
      setPredictions(prev => prev.filter(p => p.id !== tx.id));
      showToast('Rejected');
    } catch {
      showToast('Failed to reject');
    }
  };

  const openEdit = (tx) => {
    setEditModal({
      tx,
      category:    tx.predicted_category || '',
      property_id: tx.predicted_property_id ? String(tx.predicted_property_id) : '',
      tenant_id:   tx.predicted_tenant_id  ? String(tx.predicted_tenant_id)    : '',
    });
  };

  const handleEditAccept = async () => {
    const overrides = {};
    if (editModal.category)    overrides.category    = editModal.category;
    if (editModal.property_id) overrides.property_id = parseInt(editModal.property_id);
    if (editModal.tenant_id)   overrides.tenant_id   = parseInt(editModal.tenant_id);
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
          <button className="btn-secondary" onClick={handleRunPredictions} disabled={running}>
            {running ? 'Running...' : 'Run Predictions'}
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
        <div style={{ textAlign: 'center', color: '#888', padding: '48px 0', borderTop: '1px solid #E5E5E5' }}>
          No pending predictions. Click "Run Predictions" to generate predictions for uncategorized transactions.
        </div>
      )}

      {confidenceTiers.map(({ label, txs }) => {
        const groups = groupByNormalized(txs);
        return (
          <div key={label} style={{ marginBottom: 40 }}>
            <h2 className="section-title" style={{ marginBottom: 16 }}>
              {label} — {txs.length} transaction{txs.length !== 1 ? 's' : ''}
            </h2>

            {groups.map(({ key, items }) => (
              <div key={key} style={{ marginBottom: 24 }}>
                {/* Group header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#F5F5F5', border: '1px solid #E5E5E5', borderBottom: 'none', borderRadius: '2px 2px 0 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{items[0].predicted_category}</span>
                    <span style={{ color: '#888', fontSize: 12 }}>"{key}"</span>
                    {items[0].predicted_property_name && (
                      <span style={{ color: '#666', fontSize: 12 }}>· {items[0].predicted_property_name}</span>
                    )}
                    {items[0].predicted_tenant_name && (
                      <span style={{ color: '#666', fontSize: 12 }}>· {items[0].predicted_tenant_name}</span>
                    )}
                  </div>
                  {items.length > 1 && (
                    <button
                      onClick={() => handleBulkAccept(items.map(i => i.id), key)}
                      disabled={bulkAccepting === key}
                      style={{ background: '#000', color: '#fff', border: '1px solid #000', borderRadius: 2, padding: '3px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                    >
                      {bulkAccepting === key ? 'Accepting...' : `Accept all ${items.length}`}
                    </button>
                  )}
                </div>

                {/* Group rows */}
                <table className="tx-table" style={{ marginBottom: 0, borderTop: 'none' }}>
                  <colgroup>
                    <col style={{ width: 90 }} />
                    <col />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 220 }} />
                    <col style={{ width: 90 }} />
                  </colgroup>
                  <tbody>
                    {items.map(tx => (
                      <tr key={tx.id}>
                        <td className="nowrap mono" style={{ fontSize: 11 }}>
                          {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                        </td>
                        <td className="col-desc" title={tx.description} style={{ color: '#555' }}>{tx.description}</td>
                        <td className="num mono">${Math.abs(parseFloat(tx.amount)).toLocaleString()}</td>
                        <td style={{ color: '#888', fontSize: 12 }} title={tx.prediction_reasoning}>
                          {tx.prediction_reasoning}
                        </td>
                        <td className="nowrap">
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={() => handleAccept(tx)}
                              style={{ background: '#000', color: '#fff', border: '1px solid #000', borderRadius: 2, padding: '2px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                              title="Accept"
                            >✓</button>
                            <button
                              onClick={() => handleReject(tx)}
                              style={{ background: 'none', border: '1px solid #E30613', color: '#E30613', borderRadius: 2, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
                              title="Reject"
                            >✗</button>
                            <button
                              onClick={() => openEdit(tx)}
                              style={{ background: 'none', border: '1px solid #E5E5E5', borderRadius: 2, padding: '2px 8px', cursor: 'pointer', fontSize: 12, color: '#666' }}
                              title="Edit then accept"
                            >✎</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        );
      })}

      {editModal && (
        <Modal
          title="Edit Prediction"
          onClose={() => setEditModal(null)}
          onSave={handleEditAccept}
        >
          <div style={{ fontSize: 13, color: '#555', marginBottom: 16, padding: '8px 12px', border: '1px solid #E5E5E5', borderRadius: 2 }}>
            <strong>{editModal.tx.description}</strong>
            <span className="mono" style={{ marginLeft: 10 }}>${Math.abs(parseFloat(editModal.tx.amount)).toLocaleString()}</span>
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
            <select className="form-input" value={editModal.property_id} onChange={e => setEditModal(m => ({ ...m, property_id: e.target.value }))}>
              <option value="">— None —</option>
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

      <Toast message={toast} />
    </div>
  );
}
