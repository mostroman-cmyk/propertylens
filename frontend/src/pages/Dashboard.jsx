import { useEffect, useState, useCallback } from 'react';
import { getTenants, getTransactions, api } from '../api';
import ConnectBank from '../components/ConnectBank';

export default function Dashboard() {
  const [tenants, setTenants] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [connections, setConnections] = useState([]);
  const [connectionAccounts, setConnectionAccounts] = useState({}); // { connId: [plaidAccount] }
  const [pendingSelections, setPendingSelections] = useState({}); // { connId: [account_id] }
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
    setSyncResult({ message: `${institutionName} connected! Select which accounts to sync in Account Settings below.`, type: 'info' });
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
      setSyncResult({ message: 'No bank accounts connected yet. Click "Connect Bank Account" first.', type: 'warn' });
      return;
    }
    const unconfigured = connections.filter(c => !c.enabled_account_ids?.length);
    if (unconfigured.length > 0) {
      setSyncResult({ message: `Select accounts to sync in Account Settings below (${unconfigured.map(c => c.institution_name).join(', ')}).`, type: 'warn' });
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
          <button className="btn-secondary" onClick={handleTestEmail} disabled={sendingEmail}>
            {sendingEmail ? 'Sending...' : 'Test Email'}
          </button>
          <button className="btn-secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync Transactions'}
          </button>
          <ConnectBank onSuccess={handleBankConnected} />
        </div>
      </div>

      {syncResult && (
        <div style={{ ...bannerColors[syncResult.type], padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: '0.9rem' }}>
          {syncResult.message}
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

      {connections.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2>Account Settings</h2>
          <p style={{ color: '#888', fontSize: '0.9rem', marginTop: -8, marginBottom: 12 }}>
            Choose which accounts to include when syncing transactions.
          </p>
          {connections.map(conn => {
            const accounts = connectionAccounts[conn.id];
            const selected = pendingSelections[conn.id] || [];
            const savedIds = conn.enabled_account_ids || [];
            const isSaving = savingAccounts[conn.id];
            const selectionChanged = JSON.stringify([...selected].sort()) !== JSON.stringify([...savedIds].sort());

            return (
              <div key={conn.id} className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>{conn.institution_name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>
                    Connected {new Date(conn.created_at).toLocaleDateString()}
                  </div>
                </div>

                {!accounts ? (
                  <div style={{ color: '#888', fontSize: '0.85rem' }}>Loading accounts...</div>
                ) : accounts.length === 0 ? (
                  <div style={{ color: '#dc2626', fontSize: '0.85rem' }}>Could not load accounts from Plaid.</div>
                ) : (
                  <>
                    {accounts.map(acct => (
                      <label key={acct.account_id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(acct.account_id)}
                          onChange={() => handleAccountToggle(conn.id, acct.account_id)}
                          style={{ width: 16, height: 16 }}
                        />
                        <span>
                          <span style={{ fontWeight: 500 }}>{acct.name}</span>
                          <span style={{ color: '#888', marginLeft: 8, fontSize: '0.85rem' }}>
                            {acct.subtype} ···· {acct.mask}
                          </span>
                        </span>
                      </label>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                      <button
                        className="btn-primary"
                        disabled={isSaving || selected.length === 0 || !selectionChanged}
                        onClick={() => handleSaveAccounts(conn.id)}
                      >
                        {isSaving ? 'Saving...' : 'Save Selection'}
                      </button>
                      {savedIds.length > 0 && !selectionChanged && (
                        <span style={{ color: '#16a34a', fontSize: '0.85rem' }}>
                          ✓ {savedIds.length} account{savedIds.length !== 1 ? 's' : ''} selected
                        </span>
                      )}
                      {savedIds.length === 0 && (
                        <span style={{ color: '#dc2626', fontSize: '0.85rem' }}>
                          ⚠ Select at least one account to enable sync
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

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
          {transactions.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No transactions yet. Select accounts above and click Sync Transactions.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
