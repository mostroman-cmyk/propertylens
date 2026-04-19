import { useEffect, useState, useCallback } from 'react';
import { getProperties, getTenants, getPredictions, runPredictions, acceptPrediction, rejectPrediction, acceptAllHighConfidence } from '../api';
import Modal from '../components/Modal';
import Toast, { useToast } from '../components/Toast';

const CATEGORIES = ['rent', 'Repairs', 'Insurance', 'Utilities', 'Maintenance', 'Property Tax', 'Landscaping', 'HOA', 'Mortgage', 'Other Income', 'Other'];

function ConfidenceBadge({ level }) {
  if (level === 'HIGH')   return <span className="status-exact">● HIGH</span>;
  if (level === 'MEDIUM') return <span className="status-amount">● MED</span>;
  return <span className="status-review">● LOW</span>;
}

export default function Predictions() {
  const [predictions, setPredictions] = useState([]);
  const [properties, setProperties]   = useState([]);
  const [tenants, setTenants]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [running, setRunning]         = useState(false);
  const [accepting, setAccepting]     = useState(false);
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
    } catch (err) {
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
  const medCount  = predictions.filter(p => p.prediction_confidence === 'MEDIUM').length;
  const lowCount  = predictions.filter(p => p.prediction_confidence === 'LOW').length;

  const groups = [
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
        <div className="kpi-item">
          <div className="kpi-label">HIGH</div>
          <div className="kpi-value">{highCount}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">MEDIUM</div>
          <div className="kpi-value muted">{medCount}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">LOW</div>
          <div className={`kpi-value${lowCount > 0 ? ' negative' : ' muted'}`}>{lowCount}</div>
        </div>
      </div>

      {predictions.length === 0 && (
        <div style={{ textAlign: 'center', color: '#888', padding: '48px 0', borderTop: '1px solid #E5E5E5' }}>
          No pending predictions. Click "Run Predictions" to generate predictions for uncategorized transactions.
        </div>
      )}

      {groups.map(({ label, txs }) => (
        <div key={label} style={{ marginBottom: 32 }}>
          <h2 className="section-title">
            {label} — {txs.length} transaction{txs.length !== 1 ? 's' : ''}
          </h2>
          <table className="tx-table">
            <colgroup>
              <col style={{ width: 90 }} />
              <col />
              <col style={{ width: 100 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="num">Amount</th>
                <th>Predicted Category</th>
                <th>Property</th>
                <th>Tenant</th>
                <th>Reasoning</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {txs.map(tx => (
                <tr key={tx.id}>
                  <td className="nowrap mono" style={{ fontSize: 11 }}>
                    {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                  </td>
                  <td className="col-desc" title={tx.description}>{tx.description}</td>
                  <td className="num mono">${Math.abs(parseFloat(tx.amount)).toLocaleString()}</td>
                  <td className="nowrap" style={{ fontWeight: 600 }}>{tx.predicted_category}</td>
                  <td style={{ color: '#666' }}>{tx.predicted_property_name || '—'}</td>
                  <td style={{ color: '#666' }}>{tx.predicted_tenant_name   || '—'}</td>
                  <td style={{ color: '#888', maxWidth: 200 }} title={tx.prediction_reasoning}>
                    {tx.prediction_reasoning}
                  </td>
                  <td className="nowrap" style={{ width: 90 }}>
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
