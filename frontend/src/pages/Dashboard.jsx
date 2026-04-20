import { useEffect, useState, useCallback } from 'react';
import { getTenants, getTransactions, api } from '../api';

const FILTER_OPTIONS = [
  { key: '7d',         label: '7 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: '3m',         label: '3 Months' },
  { key: '6m',         label: '6 Months' },
  { key: 'ytd',        label: 'YTD' },
  { key: '1y',         label: '1 Year' },
  { key: 'all',        label: 'All Time' },
  { key: 'custom',     label: 'Custom Range' },
];

const PERIOD_LABELS = {
  '7d': '7 DAYS', 'this_month': 'THIS MONTH', 'last_month': 'LAST MONTH',
  '3m': '3 MONTHS', '6m': '6 MONTHS', 'ytd': 'YTD', '1y': '1 YEAR',
  'all': 'ALL TIME', 'custom': 'CUSTOM',
};

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

function toYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function toYM(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getDateRange(filterKey, customStart, customEnd) {
  const now = new Date();
  const today = toYMD(now);
  switch (filterKey) {
    case '7d': {
      const s = new Date(now); s.setDate(s.getDate() - 6);
      return { startDate: toYMD(s), endDate: today };
    }
    case 'this_month':
      return { startDate: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: today };
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: toYMD(s), endDate: toYMD(e) };
    }
    case '3m': {
      const s = new Date(now); s.setDate(s.getDate() - 89);
      return { startDate: toYMD(s), endDate: today };
    }
    case '6m': {
      const s = new Date(now); s.setDate(s.getDate() - 179);
      return { startDate: toYMD(s), endDate: today };
    }
    case 'ytd':
      return { startDate: `${now.getFullYear()}-01-01`, endDate: today };
    case '1y': {
      const s = new Date(now); s.setDate(s.getDate() - 364);
      return { startDate: toYMD(s), endDate: today };
    }
    case 'all':
      return { startDate: null, endDate: null };
    case 'custom':
      return { startDate: customStart || null, endDate: customEnd || null };
    default:
      return { startDate: null, endDate: null };
  }
}

// Returns list of YYYY-MM strings covered by the filter range.
// Returns null for 'all' (indeterminate). Uses startDate/endDate already computed.
function getMonthsInRange(startDate, endDate) {
  if (!startDate) return null;
  const months = [];
  const s = new Date(startDate + 'T12:00:00');
  const e = endDate ? new Date(endDate + 'T12:00:00') : new Date();
  let d = new Date(s.getFullYear(), s.getMonth(), 1);
  const endMonth = new Date(e.getFullYear(), e.getMonth(), 1);
  while (d <= endMonth) {
    months.push(toYM(d));
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return months.length > 0 ? months : null;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateFull(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function RangeLabel({ filterKey, startDate, endDate }) {
  if (filterKey === 'all' || (!startDate && !endDate)) {
    return <div className="date-filter-label">Showing: All time</div>;
  }
  return (
    <div className="date-filter-label">
      Showing: {fmtDateFull(startDate)} – {fmtDateFull(endDate)}
    </div>
  );
}

// Tooltip for the Outstanding KPI — shows tenant breakdown
function OutstandingTooltip({ breakdown, filterRentMonths, tenantCount }) {
  const unpaidCount = breakdown.length;
  const paidCount = filterRentMonths
    ? filterRentMonths.length * tenantCount - unpaidCount
    : tenantCount - unpaidCount;

  const monthLabel = filterRentMonths && filterRentMonths.length === 1
    ? filterRentMonths[0]
    : filterRentMonths ? `${filterRentMonths.length} months` : '';

  return (
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
      background: '#111', color: '#fff', borderRadius: 4, padding: '10px 14px',
      fontSize: 12, whiteSpace: 'nowrap', zIndex: 100, minWidth: 220,
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#aaa', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Outstanding {monthLabel && `· ${monthLabel}`}
      </div>
      <div style={{ marginBottom: unpaidCount > 0 ? 8 : 0, color: unpaidCount === 0 ? '#4ADE80' : '#fff' }}>
        {tenantCount} tenants · {paidCount >= 0 ? paidCount : '?'} paid · {unpaidCount} unpaid
      </div>
      {breakdown.map((b, i) => (
        <div key={i} style={{ color: '#F87171', fontSize: 11, paddingLeft: 8 }}>
          {b.name}{filterRentMonths?.length > 1 ? ` (${b.month})` : ''} — ${b.rent.toLocaleString()}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [tenants, setTenants] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fullResyncing, setFullResyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [dateFilter, setDateFilter] = useState('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showOutstandingTooltip, setShowOutstandingTooltip] = useState(false);

  const { startDate, endDate } = getDateRange(dateFilter, customStart, customEnd);

  const fetchFiltered = useCallback(async (params) => {
    setTxLoading(true);
    try {
      const data = await getTransactions(params);
      setTransactions(data);
    } finally {
      setTxLoading(false);
    }
  }, []);

  const fetchAll = useCallback(() =>
    getTransactions().then(setAllTransactions), []);

  useEffect(() => {
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    fetchFiltered(params);
  }, [startDate, endDate, fetchFiltered]);

  useEffect(() => {
    Promise.all([getTenants(), getTransactions()])
      .then(([t, tx]) => { setTenants(t); setAllTransactions(tx); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleFilterClick = (key) => {
    setDateFilter(key);
    if (key !== 'custom') { setCustomStart(''); setCustomEnd(''); }
  };

  const refreshAfterSync = async () => {
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    await Promise.all([fetchFiltered(params), fetchAll()]);
  };

  const handleFullResync = async () => {
    setFullResyncing(true);
    setSyncResult(null);
    try {
      const { data } = await api.post('/plaid/full-resync-all');
      await refreshAfterSync();
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
      await refreshAfterSync();
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

  // ── Filter rent months (for rent_month-based KPIs) ─────────────────────────
  // Returns null for 'all' (indeterminate), array of YYYY-MM for everything else
  const filterRentMonths = getMonthsInRange(startDate, endDate);

  // ── KPI calculations ────────────────────────────────────────────────────────
  // COLLECTED: sum of rent payments matched by rent_month within filter period
  // Falls back to date-based for 'all' (where filterRentMonths is null)
  const collectedByRM = filterRentMonths
    ? allTransactions
        .filter(tx => tx.type === 'income' && tx.tenant_id && filterRentMonths.includes(tx.rent_month))
        .reduce((s, tx) => s + parseFloat(tx.amount), 0)
    : null;

  // Date-based fallback for 'all' filter
  const collectedDateBased = transactions
    .filter(tx => tx.type === 'income' && tx.category === 'rent')
    .reduce((s, tx) => s + parseFloat(tx.amount), 0);

  const collected = collectedByRM ?? collectedDateBased;

  // OUTSTANDING: tenant-status-based — a tenant is outstanding only if NO rent payment
  // exists for their rent_month in the filter period. Never penalizes small shortfalls.
  const outstandingBreakdown = []; // [{name, rent, month}]
  let outstandingByRM = null;

  if (filterRentMonths) {
    outstandingByRM = 0;
    for (const rm of filterRentMonths) {
      for (const tenant of tenants) {
        const hasPaid = allTransactions.some(tx =>
          tx.type === 'income' && tx.tenant_id === tenant.id && tx.rent_month === rm
        );
        if (!hasPaid) {
          outstandingByRM += parseFloat(tenant.monthly_rent);
          outstandingBreakdown.push({ name: tenant.name, rent: parseFloat(tenant.monthly_rent), month: rm });
        }
      }
    }
  }

  // Expected total rent (for display in COLLECTED label)
  const totalMonthlyRent = tenants.reduce((sum, t) => sum + parseFloat(t.monthly_rent), 0);
  const expectedRentForPeriod = filterRentMonths ? filterRentMonths.length * totalMonthlyRent : null;

  // Other KPIs (date-filtered)
  const income   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
  const expenses = Math.abs(transactions.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
  const netIncome = income - expenses;

  const periodLabel = PERIOD_LABELS[dateFilter] || '';

  // ── Rent Status panel (allTransactions, selectedMonth) ──────────────────────
  const unmatchedIncome = allTransactions.filter(tx => tx.type === 'income' && !tx.tenant_id).length;

  // Build per-tenant rent status with shortfall detection
  const rentStatus = tenants.map(tenant => {
    const paidTxs = allTransactions.filter(tx =>
      tx.type === 'income' && tx.tenant_id === tenant.id && tx.rent_month === selectedMonth
    );
    const amountPaid = paidTxs.reduce((s, tx) => s + parseFloat(tx.amount), 0);
    const paidDate = paidTxs.length > 0
      ? paidTxs.sort((a, b) => a.date.localeCompare(b.date))[0].date
      : null;
    const expectedRent = parseFloat(tenant.monthly_rent);
    const shortfall = amountPaid > 0 ? Math.max(0, expectedRent - amountPaid) : 0;
    return {
      tenant,
      paid: paidTxs.length > 0,
      paidDate,
      amountPaid,
      shortfall: shortfall > 1 ? shortfall : 0, // ignore rounding < $1
    };
  });

  const collectedForMonth = rentStatus.reduce((s, r) => s + r.amountPaid, 0);
  const paidCount     = rentStatus.filter(r => r.paid).length;
  const unpaidTenants = rentStatus.filter(r => !r.paid);
  const rentOutstanding = unpaidTenants.reduce((s, r) => s + parseFloat(r.tenant.monthly_rent), 0);
  const paidPct = tenants.length > 0 ? Math.round((paidCount / tenants.length) * 100) : 0;

  const selectedMonthLabel = MONTH_OPTIONS.find(o => o.val === selectedMonth)?.label || selectedMonth;
  const alertClass = { success: 'alert-success', info: 'alert-info', warn: 'alert-warn', error: 'alert-error' };
  const isCustomActive = dateFilter === 'custom';

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

      {/* Alert banner driven by rent_month status — always consistent with OUTSTANDING KPI */}
      {unpaidTenants.length > 0 ? (
        <div className="alert alert-warn" style={{ marginBottom: 8 }}>
          {unpaidTenants.length} tenant{unpaidTenants.length !== 1 ? 's' : ''} have not paid for {selectedMonthLabel}:{' '}
          {unpaidTenants.map(r => r.tenant.name).join(', ')} —{' '}
          <span className="mono">${rentOutstanding.toLocaleString()}</span> outstanding.
        </div>
      ) : tenants.length > 0 ? (
        <div className="alert alert-success" style={{ marginBottom: 8 }}>
          All {tenants.length} tenant{tenants.length !== 1 ? 's' : ''} paid for {selectedMonthLabel}.
        </div>
      ) : null}

      {tenants.length > 0 && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          Rent status for <strong>{selectedMonthLabel}</strong> — matched by <span className="mono">rent_month</span>, not deposit date.
        </div>
      )}

      {/* ── Date Filter Bar ── */}
      <div className="date-filter-bar">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={`date-filter-btn${dateFilter === opt.key ? ' active' : ''}`}
            onClick={() => handleFilterClick(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isCustomActive && (
        <div className="date-range-inputs">
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
          <span style={{ fontSize: 12, color: '#666' }}>to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
        </div>
      )}

      <RangeLabel filterKey={dateFilter} startDate={startDate} endDate={endDate} />

      {/* ── KPI Row ── */}
      <div className="kpi-row">
        <div className="kpi-item">
          <div className="kpi-label">Rent Roll / Mo</div>
          <div className="kpi-value">${totalMonthlyRent.toLocaleString()}</div>
        </div>

        <div className="kpi-item">
          <div className="kpi-label">
            Collected ({periodLabel})
            {expectedRentForPeriod != null && collected < expectedRentForPeriod && (
              <span style={{ fontSize: 10, color: '#B45309', marginLeft: 4 }}>
                of ${expectedRentForPeriod.toLocaleString()}
              </span>
            )}
          </div>
          <div className="kpi-value">{txLoading ? '…' : `$${Math.round(collected).toLocaleString()}`}</div>
        </div>

        <div className="kpi-item">
          <div className="kpi-label">Outstanding ({periodLabel})</div>
          <div
            style={{ position: 'relative', cursor: outstandingByRM !== null ? 'help' : 'default' }}
            onMouseEnter={() => outstandingByRM !== null && setShowOutstandingTooltip(true)}
            onMouseLeave={() => setShowOutstandingTooltip(false)}
          >
            <div className={`kpi-value${outstandingByRM > 0 ? ' negative' : ' muted'}`}>
              {txLoading ? '…' : outstandingByRM !== null ? `$${outstandingByRM.toLocaleString()}` : '—'}
            </div>
            {showOutstandingTooltip && outstandingByRM !== null && (
              <OutstandingTooltip
                breakdown={outstandingBreakdown}
                filterRentMonths={filterRentMonths}
                tenantCount={tenants.length}
              />
            )}
          </div>
        </div>

        <div className="kpi-item">
          <div className="kpi-label">Net Income ({periodLabel})</div>
          <div className={`kpi-value${netIncome < 0 ? ' negative' : ''}`}>
            {txLoading ? '…' : `$${netIncome.toLocaleString()}`}
          </div>
        </div>

        <div className="kpi-item">
          <div className="kpi-label">Tenants</div>
          <div className="kpi-value muted">{tenants.length}</div>
        </div>
      </div>

      <div className="split-layout">
        {/* ── Recent Transactions ── */}
        <div style={{ minWidth: 0, flex: '1 1 0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 className="section-title" style={{ margin: 0 }}>
              Recent Transactions
              {txLoading && <span style={{ fontWeight: 400, color: '#aaa', marginLeft: 8 }}>loading…</span>}
            </h2>
            {transactions.length > 50 && (
              <a href="/transactions" style={{ fontSize: 12, color: '#666', textDecoration: 'underline' }}>
                View all transactions →
              </a>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ tableLayout: 'fixed', width: '100%', minWidth: 760 }}>
              <colgroup>
                <col style={{ width: 80 }} /><col /><col style={{ width: 110 }} />
                <col style={{ width: 75 }} /><col style={{ width: 120 }} />
                <col style={{ width: 140 }} /><col style={{ width: 120 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th><th>Description</th><th className="num">Amount</th>
                  <th>Type</th><th>Category</th><th>Property</th><th>Tenant</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 50).map((tx) => (
                  <tr key={tx.id}>
                    <td className="nowrap mono" style={{ fontSize: 12 }}>{fmtDate(tx.date)}</td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.description}>
                      {tx.display_description || tx.description}
                    </td>
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
                {transactions.length === 0 && !txLoading && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: 24 }}>
                      No transactions in this range.{' '}
                      {dateFilter !== 'all' && (
                        <button
                          style={{ background: 'none', border: 'none', color: '#666', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 13 }}
                          onClick={() => handleFilterClick('all')}
                        >
                          Show all time
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Rent Status ── */}
        <div style={{ flexShrink: 0, width: 380 }}>
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
              <col /><col style={{ width: 78 }} /><col style={{ width: 62 }} /><col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Tenant</th>
                <th className="num">Rent</th>
                <th>Paid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length > 0 && (
                <tr style={{ background: '#F9F9F9', fontWeight: 600 }}>
                  <td colSpan={2} style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6 }}>
                    {paidCount} / {tenants.length} PAID
                  </td>
                  <td colSpan={2} style={{ fontSize: 11, color: '#555', textAlign: 'right' }}>
                    ${Math.round(collectedForMonth).toLocaleString()} of ${totalMonthlyRent.toLocaleString()} ({paidPct}%)
                  </td>
                </tr>
              )}
              {rentStatus.map(({ tenant, paid, paidDate, shortfall }) => (
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
                  <td className="num mono" style={{ fontSize: 12 }}>
                    ${parseFloat(tenant.monthly_rent).toLocaleString()}
                  </td>
                  <td className="nowrap" style={{ fontSize: 12, color: '#666' }}>
                    {paid ? fmtDate(paidDate) : '—'}
                  </td>
                  <td className="nowrap">
                    {!paid ? (
                      <span className="status-unpaid">● DUE</span>
                    ) : shortfall > 0 ? (
                      <span
                        title={`Paid $${shortfall.toFixed(2)} less than expected rent of $${parseFloat(tenant.monthly_rent).toLocaleString()}`}
                        style={{
                          color: '#B45309', fontWeight: 700, fontSize: 11,
                          letterSpacing: '0.04em', cursor: 'help',
                        }}
                      >
                        ● PAID <span style={{ fontWeight: 400, fontSize: 10 }}>(short ${shortfall.toFixed(0)})</span>
                      </span>
                    ) : (
                      <span className="status-paid">● PAID</span>
                    )}
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
