import { useEffect, useState, useCallback } from 'react';
import { getTenants, getTransactions, api } from '../api';
import ConnectBank from '../components/ConnectBank';

export default function Dashboard() {
  const [tenants, setTenants] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [connections, setConnections] = useState([]);
  const [connectionAccounts, setConnectionAccounts] = useState({});
  const [pendingSelections, setPendingSelections] = useState({});
  const [savingAccounts, setSavingAccounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState(null);

  const fetchTransactions = useCallback(() =>
    getTransactions().then(setTransactions), []);

  const fetchAccountsForConnections = useCallback(async (conns) => {
    const accountResults = {};
    const selectionResults = {};
    await Promise.all(conns.map(async (conn) => {
      try {
        const { data } = await api.get(`/plaid/accounts/${conn.id}`);
        accountResults[conn.id] = data;
        selectionResults[conn.id] = conn.enabled_account_ids || [];
      } catch {
        accountResults[conn.id] = [];
        selectionResults[conn.id] = conn.enabled_account_ids || [];
      }
    }));
    setConnectionAccounts(prev => ({ ...prev, ...accountResults }));
    setPendingSelections(prev => ({ ...prev, ...selectionResults }));
  }, []);

  const fetchConnections = useCallback(async () => {
    const { data } = await api.get('/plaid/connections');
    setConnections(data);
    if (data.length > 0) await fetchAccountsForConnections(data);
    return data;
  }, [fetchAccountsForConnections]);

  useEffect(() => {
    Promise.all([getTenants(), getTransactions(), fetchConnections()])
      .then(([t, tx]) => { setTenants(t); setTransactions(tx); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fetchConnections]);

  const handleBankConnected = async (institutionName) => {
    setSyncResult({ message: `${institutionName} connected. Select accounts to sync below.`, type: 'info' });
    await fetchConnections();
  };

  const handleAccountToggle = (connId, accountId) => {
    setPendingSelections(prev => {
      const current = prev[connId] || [];
      const updated = current.includes(accountId)
        ? current.filter(id => id !== accountId)
        : [...current, accountId];
      return { ...prev, [connId]: updated };
    });
  };

  const handleSaveAccounts = async (connId) => {
    setSavingAccounts(prev => ({ ...prev, [connId]: true }));
    try {
      const account_ids = pendingSelections[connId] || [];
      await api.put(`/plaid/connections/${connId}/accounts`, { account_ids });
      setConnections(prev => prev.map(c => c.id === connId ? { ...c, enabled_account_ids: account_ids } : c));
      setSyncResult({ message: 'Account selection saved. Click Sync Transactions to import.', type: 'success' });
    } catch {
      setSyncResult({ message: 'Failed to save account selection.', type: 'error' });
    } finally {
      setSavingAccounts(prev => ({ ...prev, [connId]: false }));
    }
  };

  const handleSync = async () => {
    if (connections.length === 0) {
      setSyncResult({ message: 'No bank accounts connected. Click "Connect Bank Account" first.', type: 'warn' });
      return;
    }
    const unconfigured = connections.filter(c => !c.enabled_account_ids?.length);
    if (unconfigured.length > 0) {
      setSyncResult({ message: `Select accounts to sync below (${unconfigured.map(c => c.institution_name).join(', ')}).`, type: 'warn' });
      return;
    }
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
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalExpenses = Math.abs(transactions.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
  const netIncome = totalIncome - totalExpenses;

  const now = new Date();
  const rentStatus = tenants.map(tenant => {
    const matched = transactions.filter(tx => tx.type === 'income' && tx.tenant_id === tenant.id);
    const paid = matched.some(tx => {
      const d = new Date(tx.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const last = matched.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return { tenant, paid, lastDate: last ? new Date(last.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null };
  });

  const alertClass = { success: 'alert-success', info: 'alert-info', warn: 'alert-warn', error: 'alert-error' };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleTestEmail} disabled={sendingEmail}>
            {sendingEmail ? 'Sending...' : 'Email Report'}
          </button>
          <button className="btn-secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync Transactions'}
          </button>
          <ConnectBank onSuccess={handleBankConnected} />
        </div>
      </div>

      {syncResult && (
        <div className={`alert ${alertClass[syncResult.type]}`}>{syncResult.message}</div>
      )}

      <div className="kpi-row">
        <div className="kpi-item">
          <div className="kpi-label">Rent Roll / Mo</div>
          <div className="kpi-value">${totalMonthlyRent.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Total Income</div>
          <div className="kpi-value">${totalIncome.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Total Expenses</div>
          <div className="kpi-value">${totalExpenses.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Net Income</div>
          <div className={`kpi-value${netIncome < 0 ? ' negative' : ''}`}>${netIncome.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Tenants</div>
          <div className="kpi-value">{tenants.length}</div>
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
                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No transactions yet. Connect a bank and sync.</td></tr>
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
              {rentStatus.map(({ tenant, paid, lastDate }) => (
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

          {connections.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <h2 className="section-title">Account Settings</h2>
              {connections.map(conn => {
                const accounts = connectionAccounts[conn.id];
                const selected = pendingSelections[conn.id] || [];
                const savedIds = conn.enabled_account_ids || [];
                const isSaving = savingAccounts[conn.id];
                const selectionChanged = JSON.stringify([...selected].sort()) !== JSON.stringify([...savedIds].sort());
                return (
                  <div key={conn.id} style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{conn.institution_name}</span>
                      <span className="label">since {new Date(conn.created_at).toLocaleDateString()}</span>
                    </div>
                    {!accounts ? (
                      <div className="label">Loading...</div>
                    ) : accounts.length === 0 ? (
                      <div className="error" style={{ padding: 0 }}>Could not load accounts.</div>
                    ) : (
                      <>
                        {accounts.map(acct => (
                          <label key={acct.account_id} className="account-item" style={{ cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={selected.includes(acct.account_id)}
                              onChange={() => handleAccountToggle(conn.id, acct.account_id)}
                              style={{ width: 14, height: 14, accentColor: '#000', flexShrink: 0 }}
                            />
                            <div>
                              <div className="account-name">{acct.name}</div>
                              <div className="account-meta">{acct.subtype} ···· {acct.mask}</div>
                            </div>
                          </label>
                        ))}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                          <button
                            className="btn-sm"
                            disabled={isSaving || selected.length === 0 || !selectionChanged}
                            onClick={() => handleSaveAccounts(conn.id)}
                          >
                            {isSaving ? 'Saving...' : 'Save Selection'}
                          </button>
                          {savedIds.length === 0 && (
                            <span style={{ fontSize: 11, color: '#E30613' }}>No accounts selected</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
