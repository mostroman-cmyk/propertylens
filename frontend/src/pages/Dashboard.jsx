import { useEffect, useState, useCallback } from 'react';
import { getTenants, getTransactions, api } from '../api';

function getMonthOptions() {
  const now = new Date();
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 6 + i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return { val, label };
  });
}
const MONTH_OPTIONS = getMonthOptions();

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Dashboard() {
  const [tenants, setTenants] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [fullResyncing, setFullResyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);

  const fetchTransactions = useCallback(() =>
    getTransactions().then(setTransactions), []);

  useEffect(() => {
    Promise.all([getTenants(), getTransactions()])
      .then(([t, tx]) => { setTenants(t); setTransactions(tx); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleFullResync = async () => {
    setFullResyncing(true);
    setSyncResult(null);
    try {
      const { data } = await api.post('/plaid/full-resync-all');
      await fetchTransactions();
      let msg, type;
      if (data.errors?.length) {
        const detail = data.errors.map(e => `${e.institution}: ${e.error}`).join(' | ');
        msg = `Full re-sync: imported ${data.synced} transaction${data.synced !== 1 ? 's' : ''}. Error — ${detail}`;
        type = 'warn';
      } else {
        msg = `Full re-sync complete — imported ${data.synced} transaction${data.synced !== 1 ? 's' : ''} from full history.`;
        type = 'success';
      }
      setSyncResult({ message: msg, type });
    } catch (err) {
      setSyncResult({ message: err.response?.data?.error || 'Full re-sync failed.', type: 'error' });
    } finally {
      setFullResyncing(false);
    }
  };

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

  // Month-scoped calculations
  const monthTxs = transactions.filter(tx => tx.date && tx.date.startsWith(selectedMonth));
  const monthIncome   = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
  const monthExpenses = Math.abs(monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
  const netIncome     = monthIncome - monthExpenses;

  const totalMonthlyRent = tenants.reduce((sum, t) => sum + parseFloat(t.monthly_rent), 0);
  const unmatchedIncome  = transactions.filter(tx => tx.type === 'income' && !tx.tenant_id).length;

  const collectedThisMonth = transactions
    .filter(tx => tx.type === 'income' && tx.tenant_id && tx.rent_month === selectedMonth)
    .reduce((s, tx) => s + parseFloat(tx.amount), 0);

  const rentStatus = tenants.map(tenant => {
    const paidTx = transactions.find(tx =>
      tx.type === 'income' && tx.tenant_id === tenant.id && tx.rent_month === selectedMonth
    );
    return { tenant, paid: !!paidTx, paidDate: paidTx?.date || null };
  });

  const paidCount    = rentStatus.filter(r => r.paid).length;
  const unpaidTenants = rentStatus.filter(r => !r.paid);
  const outstanding  = unpaidTenants.reduce((s, r) => s + parseFloat(r.tenant.monthly_rent), 0);
  const paidPct      = tenants.length > 0 ? Math.round((paidCount / tenants.length) * 100) : 0;

  const selectedMonthLabel = MONTH_OPTIONS.find(o => o.val === selectedMonth)?.label || selectedMonth;
  const alertClass = { success: 'alert-success', info: 'alert-info', warn: 'alert-warn', error: 'alert-error' };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleSync} disabled={syncing || fullResyncing}>
            {syncing ? 'Syncing...' : 'Sync Transactions'}
          </button>
          <button className="btn-primary" onClick={handleFullResync} disabled={syncing || fullResyncing} title="Clear saved sync position and re-import all available history from Plaid (up to 24 months)">
            {fullResyncing ? 'Importing history...' : 'Full Re-Sync (Pull Complete History)'}
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={`alert ${alertClass[syncResult.type]}`}>{syncResult.message}</div>
      )}

      {unmatchedIncome > 0 && (
        <div className="alert alert-info" style={{ marginBottom: 8 }}>
          {unmatchedIncome} income deposit{unmatchedIncome !== 1 ? 's' : ''} not yet matched to a tenant.{' '}
          <a href="/transactions" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
            Review in Transactions → Unmatched rent tab
          </a>
        </div>
      )}

      {unpaidTenants.length > 0 ? (
        <div className="alert alert-warn" style={{ marginBottom: 8 }}>
          {unpaidTenants.length} tenant{unpaidTenants.length !== 1 ? 's' : ''} have not paid for {selectedMonthLabel}:{' '}
          {unpaidTenants.map(r => r.tenant.name).join(', ')} —{' '}
          <span className="mono">${outstanding.toLocaleString()}</span> outstanding.
        </div>
      ) : tenants.length > 0 ? (
        <div className="alert alert-success" style={{ marginBottom: 8 }}>
          All {tenants.length} tenant{tenants.length !== 1 ? 's' : ''} paid for {selectedMonthLabel}.
        </div>
      ) : null}
      {tenants.length > 0 && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          Showing rent status for <strong>{selectedMonthLabel}</strong> — matched by <span className="mono">rent_month</span>, not deposit date.
          Payments deposited on the 25th–31st are counted toward the following month.
        </div>
      )}

      <div className="kpi-row">
        <div className="kpi-item">
          <div className="kpi-label">Rent Roll / Mo</div>
          <div className="kpi-value">${totalMonthlyRent.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Collected ({selectedMonthLabel.split(' ')[0]})</div>
          <div className="kpi-value">${collectedThisMonth.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Outstanding</div>
          <div className={`kpi-value${outstanding > 0 ? ' negative' : ' muted'}`}>${outstanding.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Net ({selectedMonthLabel.split(' ')[0]})</div>
          <div className={`kpi-value${netIncome < 0 ? ' negative' : ''}`}>${netIncome.toLocaleString()}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Tenants</div>
          <div className="kpi-value muted">{tenants.length}</div>
        </div>
      </div>

      <div className="split-layout">
        {/* ── Recent Transactions ── */}
        <div style={{ minWidth: 0, flex: '1 1 0' }}>
          <h2 className="section-title">Recent Transactions</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ tableLayout: 'fixed', width: '100%', minWidth: 760 }}>
              <colgroup>
                <col style={{ width: 80 }} />
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: 75 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 120 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Property</th>
                  <th>Tenant</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 20).map((tx) => (
                  <tr key={tx.id}>
                    <td className="nowrap mono" style={{ fontSize: 12 }}>{fmtDate(tx.date)}</td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.description}>{tx.description}</td>
                    <td className="num mono">${Math.abs(parseFloat(tx.amount)).toLocaleString()}</td>
                    <td className="nowrap"><span className={`badge ${tx.type}`}>{tx.type}</span></td>
                    <td className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.category}</td>
                    <td style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {tx.property_scope === 'portfolio'
                        ? <span style={{ fontStyle: 'italic', fontWeight: 600, fontVariant: 'small-caps' }}>All</span>
                        : (tx.property_name || '—')}
                    </td>
                    <td style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                      {tx.tenant_name || '—'}
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No transactions. Go to Settings → Bank Connections to sync.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Rent Status ── */}
        <div style={{ flexShrink: 0, width: 360 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Rent Status</h2>
            <select
              className="form-input form-input-sm"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              style={{ width: 'auto' }}
            >
              {MONTH_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
          </div>

          <table style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col />
              <col style={{ width: 80 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Tenant</th>
                <th className="num">Rent</th>
                <th>Paid Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {/* Summary row */}
              {tenants.length > 0 && (
                <tr style={{ background: '#F9F9F9', fontWeight: 600 }}>
                  <td colSpan={2} style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6 }}>
                    {paidCount} / {tenants.length} PAID
                  </td>
                  <td colSpan={2} style={{ fontSize: 11, color: '#555', textAlign: 'right' }}>
                    ${collectedThisMonth.toLocaleString()} of ${totalMonthlyRent.toLocaleString()} ({paidPct}%)
                  </td>
                </tr>
              )}
              {rentStatus.map(({ tenant, paid, paidDate }) => (
                <tr key={tenant.id}>
                  <td>
                    <a
                      href={`/transactions?tenant_id=${tenant.id}`}
                      style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dotted #ccc' }}
                      title="View this tenant's transactions"
                    >
                      {tenant.name}
                    </a>
                  </td>
                  <td className="num mono" style={{ fontSize: 12 }}>${parseFloat(tenant.monthly_rent).toLocaleString()}</td>
                  <td className="nowrap" style={{ fontSize: 12, color: '#666' }}>{paid ? fmtDate(paidDate) : '—'}</td>
                  <td className="nowrap">
                    {paid
                      ? <span className="status-paid">● PAID</span>
                      : <span className="status-unpaid">● DUE</span>
                    }
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No tenants.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
