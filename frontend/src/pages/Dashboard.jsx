import { useEffect, useState, useCallback } from 'react';
import { getTenants, getTransactions, api } from '../api';
import ConnectBank from '../components/ConnectBank';

export default function Dashboard() {
  const [tenants, setTenants] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState(null);

  const fetchConnections = () =>
    api.get('/plaid/connections').then((r) => setConnections(r.data));

  const fetchTransactions = useCallback(() =>
    getTransactions().then(setTransactions), []);

  useEffect(() => {
    Promise.all([getTenants(), getTransactions(), fetchConnections()])
      .then(([t, tx]) => { setTenants(t); setTransactions(tx); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleBankConnected = (institutionName) => {
    setSyncResult({ message: `${institutionName} connected! Syncing transactions...`, type: 'info' });
    fetchConnections();
    // Transactions will auto-sync on the backend; reload them after a short delay
    setTimeout(() => fetchTransactions().then(() =>
      setSyncResult({ message: `${institutionName} connected and transactions synced.`, type: 'success' })
    ), 4000);
  };

  const handleSync = async () => {
    if (connections.length === 0) {
      setSyncResult({ message: 'No bank accounts connected yet. Click "Connect Bank Account" first.', type: 'warn' });
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data } = await api.post('/plaid/sync');
      await fetchTransactions();
      const msg = data.errors?.length
        ? `Added ${data.synced} new transactions (${data.skipped} skipped). Some errors occurred.`
        : data.synced > 0
          ? `Added ${data.synced} new transaction${data.synced !== 1 ? 's' : ''}. ${data.skipped} already existed.`
          : `Already up to date — ${data.skipped} transaction${data.skipped !== 1 ? 's' : ''} checked, none new.`;
      setSyncResult({ message: msg, type: data.errors?.length ? 'warn' : 'success' });
    } catch (err) {
      setSyncResult({ message: err.response?.data?.error || 'Sync failed. Check server logs.', type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleTestEmail = async () => {
    setSendingEmail(true);
    setSyncResult(null);
    try {
      const { data } = await api.post('/email/test');
      setSyncResult({
        message: `${data.message} — ${data.paid} paid, ${data.unpaid} unpaid, $${(data.totalExpected - data.totalCollected).toLocaleString()} outstanding.`,
        type: 'success',
      });
    } catch (err) {
      setSyncResult({
        message: err.response?.data?.error || 'Failed to send email. Check GMAIL_USER and GMAIL_APP_PASSWORD in .env.',
        type: 'error',
      });
    } finally {
      setSendingEmail(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const totalMonthlyRent = tenants.reduce((sum, t) => sum + parseFloat(t.monthly_rent), 0);
  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalExpenses = Math.abs(transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
  const netIncome = totalIncome - totalExpenses;

  const bannerColors = {
    success: { bg: '#dcfce7', color: '#16a34a' },
    info:    { bg: '#dbeafe', color: '#1d4ed8' },
    warn:    { bg: '#fef9c3', color: '#854d0e' },
    error:   { bg: '#fee2e2', color: '#dc2626' },
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn-secondary"
            onClick={handleTestEmail}
            disabled={sendingEmail}
          >
            {sendingEmail ? 'Sending...' : 'Test Email'}
          </button>
          <button
            className="btn-secondary"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing...' : 'Sync Transactions'}
          </button>
          <ConnectBank onSuccess={handleBankConnected} />
        </div>
      </div>

      {syncResult && (
        <div style={{
          ...bannerColors[syncResult.type],
          padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: '0.9rem'
        }}>
          {syncResult.message}
        </div>
      )}

      {connections.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2>Connected Accounts</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {connections.map((c) => (
              <div key={c.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 18px', fontSize: '0.9rem' }}>
                <div style={{ fontWeight: 600 }}>{c.institution_name}</div>
                <div style={{ color: '#888', fontSize: '0.78rem', marginTop: 2 }}>
                  Connected {new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">Monthly Rent Roll</div>
          <div className="value green">${totalMonthlyRent.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Tenants</div>
          <div className="value blue">{tenants.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Income</div>
          <div className="value green">${totalIncome.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Expenses</div>
          <div className="value">${totalExpenses.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">Net Income</div>
          <div className={`value ${netIncome >= 0 ? 'green' : ''}`}>${netIncome.toLocaleString()}</div>
        </div>
      </div>

      <h2>Recent Transactions</h2>
      <table>
        <thead>
          <tr><th>Date</th><th>Description</th><th>Amount</th><th>Type</th><th>Category</th></tr>
        </thead>
        <tbody>
          {transactions.slice(0, 10).map((tx) => (
            <tr key={tx.id}>
              <td>{new Date(tx.date).toLocaleDateString()}</td>
              <td>{tx.description}</td>
              <td>${Math.abs(parseFloat(tx.amount)).toLocaleString()}</td>
              <td><span className={`badge ${tx.type}`}>{tx.type}</span></td>
              <td>{tx.category}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
