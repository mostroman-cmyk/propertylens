import { useEffect, useState } from 'react';
import { getTransactions, getProperties, updateTransaction } from '../api';
import Modal from '../components/Modal';
import Toast, { useToast } from '../components/Toast';

const CATEGORIES = ['rent', 'Repairs', 'Insurance', 'Utilities', 'Maintenance', 'Property Tax', 'Landscaping', 'Other'];

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ category: '', type: '', property_id: '' });
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState(null);
  const { toast, showToast } = useToast();

  useEffect(() => {
    Promise.all([getTransactions(), getProperties()])
      .then(([tx, p]) => { setTransactions(tx); setProperties(p); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
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
        category: form.category,
        type: form.type,
        property_id: form.property_id || null,
      });
      setTransactions(txs => txs.map(t => t.id === modal.id ? updated : t));
      showToast('Transaction updated successfully');
      setModal(null);
    } catch (err) {
      setModalError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const income   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
  const expenses = Math.abs(transactions.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));

  return (
    <div>
      <h1>Transactions</h1>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">Total Income</div>
          <div className="value green">${income.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Expenses</div>
          <div className="value">${expenses.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Net</div>
          <div className={`value ${income - expenses >= 0 ? 'green' : ''}`}>${(income - expenses).toLocaleString()}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Amount</th>
            <th>Type</th>
            <th>Category</th>
            <th>Property</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {transactions.map(tx => (
            <tr key={tx.id}>
              <td>{new Date(tx.date).toLocaleDateString()}</td>
              <td>{tx.description}</td>
              <td>${Math.abs(parseFloat(tx.amount)).toLocaleString()}</td>
              <td><span className={`badge ${tx.type}`}>{tx.type}</span></td>
              <td>{tx.category}</td>
              <td style={{ color: '#888', fontSize: '0.85em' }}>{tx.property_name || '—'}</td>
              <td style={{ width: 60 }}>
                <button className="btn-edit" onClick={() => openEdit(tx)}>Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal !== null && (
        <Modal
          title="Edit Transaction"
          onClose={() => setModal(null)}
          onSave={handleSave}
          saving={saving}
          error={modalError}
        >
          <div style={{ color: '#555', fontSize: '0.9rem', marginBottom: 16, padding: '10px 12px', background: '#f5f6fa', borderRadius: 8 }}>
            <strong>{modal.description}</strong>
            <span style={{ marginLeft: 10, color: '#888' }}>{new Date(modal.date).toLocaleDateString()}</span>
            <span style={{ marginLeft: 10, fontWeight: 600 }}>${Math.abs(parseFloat(modal.amount)).toLocaleString()}</span>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Type</label>
              <select
                className="form-input"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              >
                <option value="income">income</option>
                <option value="expense">expense</option>
              </select>
            </div>
            <div className="form-group">
              <label>Category</label>
              <select
                className="form-input"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Property</label>
            <select
              className="form-input"
              value={form.property_id}
              onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))}
            >
              <option value="">— None —</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </Modal>
      )}

      <Toast message={toast} />
    </div>
  );
}
