import { useEffect, useState, useCallback } from 'react';
import { getTenants, getTransactions, api } from '../api';

export default function Dashboard() {
  const [tenants, setTenants] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState(null);

  const fetchTransactions = useCallback(() =>
    getTransactions().then(setTransactions), []);

  useEffect(() => {
    Promise.all([getTenants(), getTransactions()])
      .then(([t, tx]) => { setTenants(t); setTransactions(tx); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data } = await api.post('/plaid/sync');
      await fetchTransactions();
      let msg, type;
      if (data.errors?.length) {
        const detail = data.errors.map(e => `${e.institution}: ${e.error}`).join(' | ');
        msg = `Added ${data.synced} new transaction${data.synced !== 1 ? 's' : ''}. Error — ${detail}`;
        type = 'warn';
      } else if (data.synced > 0) {
        msg = `Added ${data.synced} new transaction${data.synced !== 1 ? 's' : ''}. ${data.skipped} already existed.`;
        type = 'success';
      } else {
        msg = `Already up to date — ${data.skipped} transaction${data.skipped !== 1 ? 's' : ''} checked, none new.`;
        type = 'success';
      }
      setSyncResult({ message: msg, type });
    } catch (err) {
      setSyncResult({ message: err.response?.data?.error || 'Sync failed. Check Settings → Bank Connections.', type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const totalMonthlyRent = tenants.reduce((sum, t) => sum + parseFloat(t.monthly_rent), 0);
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalExpenses = Math.abs(transactions.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
  const netIncome = totalIncome - totalExpenses;

  const collectedThisMonth = transactions
    .filter(tx => {
      const d = new Date(tx.date);
      return tx.type === 'income' && tx.tenant_id &&
        d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    })
    .reduce((s, tx) => s + parseFloat(tx.amount), 0);

  const rentStatus = tenants.map(tenant => {
    const paid = transactions.some(tx => {
      const d = new Date(tx.date);
      return tx.type === 'income' && tx.tenant_id === tenant.id &&
        d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    return { tenant, paid };
  });

  const unpaidTenants = rentStatus.filter(r => !r.paid);
  const outstanding = unpaidTenants.reduce((s, r) => s + parseFloat(r.tenant.monthly_rent), 0);

  const alertClass = { success: 'alert-success', info: 'alert-info', warn: 'alert-warn', error: 'alert-error' };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <button className="btn-secondary" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Sync Transactions'}
        </button>
      </div>

      {syncResult && (
        <div className={`alert ${alertClass[syncResult.type]}`}>{syncResult.message}</div>
      )}

      {unpaidTenants.length > 0 && (
        <div className="alert alert-warn" style={{ marginBottom: 20 }}>
          {unpaidTenants.length} tenant{unpaidTenants.length !== 1 ? 's' : ''} have not paid this month:{' '}
          {unpaidTenants.map(r => r.tenant.name).join(', ')} —{' '}
          <span className="mono">${outstanding.toLocaleString()}</span> outstanding.
        </div>
      )}

      <div className="kpi-row">
        <div className="kpi-item">
          <div className="kpi-label">Rent Roll / Mo</div>
          <div className="kpi-value">${totalMonthlyRent.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Collected This Month</div>
          <div className="kpi-value">${collectedThisMonth.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Outstanding</div>
          <div className={`kpi-value${outstanding > 0 ? ' negative' : ' muted'}`}>${outstanding.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Net Income</div>
          <div className={`kpi-value${netIncome < 0 ? ' negative' : ''}`}>${netIncome.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Tenants</div>
          <div className="kpi-value muted">{tenants.length}</div>
        </div>
      </div>

      <div className="split-layout">
        <div>
          <h2 className="section-title">Recent Transactions</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="num">Amount</th>
                <th>Type</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 20).map((tx) => (
                <tr key={tx.id}>
                  <td className="nowrap mono">{new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td>{tx.description}</td>
                  <td className="num mono">${Math.abs(parseFloat(tx.amount)).toLocaleString()}</td>
                  <td className="nowrap"><span className={`badge ${tx.type}`}>{tx.type}</span></td>
                  <td className="nowrap">{tx.category}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No transactions. Go to Settings → Bank Connections to sync.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          <h2 className="section-title">Rent Status — {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
          <table>
            <thead>
              <tr><th>Tenant</th><th className="num">Rent</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rentStatus.map(({ tenant, paid }) => (
                <tr key={tenant.id}>
                  <td>{tenant.name}</td>
                  <td className="num mono">${parseFloat(tenant.monthly_rent).toLocaleString()}</td>
                  <td className="nowrap">
                    {paid
                      ? <span className="status-paid">● PAID</span>
                      : <span className="status-unpaid">● DUE</span>
                    }
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No tenants.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
