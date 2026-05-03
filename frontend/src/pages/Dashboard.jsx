import { useEffect, useState, useCallback } from 'react';
import { getTenants, getTransactions, api, setRentMonth } from '../api';
import { formatMoney, formatDate, formatType } from '../utils/format';
import { downloadFilteredTransactionsCSV } from '../utils/export';
import EmptyState from '../components/EmptyState';
import CashFlowWaterfall from '../components/CashFlowWaterfall';
import ExpenseDonut from '../components/ExpenseDonut';
import AnomalyCard from '../components/AnomalyCard';
import CategoryPill from '../components/CategoryPill';

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

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
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


function RangeLabel({ filterKey, startDate, endDate }) {
  if (filterKey === 'all' || (!startDate && !endDate)) {
    return <div className="date-filter-label">Showing: All time</div>;
  }
  return (
    <div className="date-filter-label">
      Showing: {formatDate(startDate)} – {formatDate(endDate)}
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
          {b.name}{filterRentMonths?.length > 1 ? ` (${b.month})` : ''} — {formatMoney(b.rent, { noCents: true })}
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
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [dateFilter, setDateFilter] = useState('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showOutstandingTooltip, setShowOutstandingTooltip] = useState(false);
  const [reassigning, setReassigning] = useState({});

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

  const handleReassignRentMonth = async (txId, newMonth) => {
    setReassigning(r => ({ ...r, [txId]: true }));
    try {
      await setRentMonth(txId, newMonth);
      await fetchAll();
    } catch {
      // ignore
    } finally {
      setReassigning(r => ({ ...r, [txId]: false }));
    }
  };

  const refreshAfterSync = async () => {
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    await Promise.all([fetchFiltered(params), fetchAll()]);
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

  // Active tenants only — used for rent status and outstanding calculations
  const activeTenants = tenants.filter(t => !t.status || t.status === 'active');

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
      for (const tenant of activeTenants) {
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
  const totalMonthlyRent = activeTenants.reduce((sum, t) => sum + parseFloat(t.monthly_rent), 0);
  const expectedRentForPeriod = filterRentMonths ? filterRentMonths.length * totalMonthlyRent : null;

  // Other KPIs (date-filtered)
  const income   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
  const expenses = Math.abs(transactions.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0));
  const netIncome = income - expenses;

  const periodLabel = PERIOD_LABELS[dateFilter] || '';

  // ── Rent Status panel (allTransactions, selectedMonth) ──────────────────────
  const unmatchedIncome = allTransactions.filter(tx => tx.type === 'income' && !tx.tenant_id).length;

  // Build per-tenant rent status with shortfall detection
  const rentStatus = activeTenants.map(tenant => {
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
  const paidPct = activeTenants.length > 0 ? Math.round((paidCount / activeTenants.length) * 100) : 0;

  const selectedMonthLabel = MONTH_OPTIONS.find(o => o.val === selectedMonth)?.label || selectedMonth;
  const alertClass = { success: 'alert-success', info: 'alert-info', warn: 'alert-warn', error: 'alert-error' };
  const isCustomActive = dateFilter === 'custom';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync Transactions'}
          </button>
          <button
            className="btn-secondary"
            onClick={() => downloadFilteredTransactionsCSV(transactions, periodLabel.toLowerCase().replace(/\s+/g, '_'))}
            disabled={transactions.length === 0}
            title={`Export ${transactions.length} transactions for the current period`}
          >
            Export Period CSV
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
          <span className="mono">{formatMoney(rentOutstanding, { noCents: true })}</span> outstanding.
        </div>
      ) : activeTenants.length > 0 ? (
        <div className="alert alert-success" style={{ marginBottom: 8 }}>
          All {activeTenants.length} tenant{activeTenants.length !== 1 ? 's' : ''} paid for {selectedMonthLabel}.
        </div>
      ) : null}

      {activeTenants.length > 0 && (
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
          <div className="kpi-value">{formatMoney(totalMonthlyRent, { noCents: true })}</div>
        </div>

        <div className="kpi-item">
          <div className="kpi-label">
            Collected ({periodLabel})
            {expectedRentForPeriod != null && collected < expectedRentForPeriod && (
              <span style={{ fontSize: 10, color: '#B45309', marginLeft: 4 }}>
                of {formatMoney(expectedRentForPeriod, { noCents: true })}
              </span>
            )}
            <span
              title="Counts rent matched to tenants by attributed rent month — includes early/late payments outside the period's date range"
              style={{ fontSize: 9, color: '#999', marginLeft: 4, cursor: 'help', textTransform: 'none', letterSpacing: 0 }}
            >
              by rent month ⓘ
            </span>
          </div>
          <div className="kpi-value">{txLoading ? '…' : formatMoney(collected)}</div>
        </div>

        <div className="kpi-item">
          <div className="kpi-label">Outstanding ({periodLabel})</div>
          <div
            style={{ position: 'relative', cursor: outstandingByRM !== null ? 'help' : 'default' }}
            onMouseEnter={() => outstandingByRM !== null && setShowOutstandingTooltip(true)}
            onMouseLeave={() => setShowOutstandingTooltip(false)}
          >
            <div className={`kpi-value${outstandingByRM > 0 ? ' negative' : ' muted'}`}>
              {txLoading ? '…' : outstandingByRM !== null ? formatMoney(outstandingByRM) : '—'}
            </div>
            {showOutstandingTooltip && outstandingByRM !== null && (
              <OutstandingTooltip
                breakdown={outstandingBreakdown}
                filterRentMonths={filterRentMonths}
                tenantCount={activeTenants.length}
              />
            )}
          </div>
        </div>

        <div className="kpi-item">
          <div className="kpi-label">Net Income ({periodLabel})</div>
          <div className={`kpi-value${netIncome < 0 ? ' negative' : ''}`}>
            {txLoading ? '…' : formatMoney(netIncome)}
          </div>
        </div>

        <div className="kpi-item">
          <div className="kpi-label">Active Tenants</div>
          <div className="kpi-value muted">{activeTenants.length}</div>
        </div>
      </div>

      {/* ── Row 4: Rent Status + Cash Flow Waterfall ── */}
      <div className="dashboard-analytics-row">
        {/* Rent Status — ~45% width */}
        <div className="dashboard-panel dashboard-rent-status">
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

          <table className="mobile-cards" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col /><col style={{ width: 90 }} /><col style={{ width: 110 }} /><col style={{ width: 130 }} />
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
              {activeTenants.length > 0 && (
                <tr style={{ background: '#F9F9F9', fontWeight: 600 }}>
                  <td data-label="" colSpan={2} style={{ fontSize: 12, paddingTop: 6, paddingBottom: 6 }}>
                    {paidCount} / {activeTenants.length} PAID
                  </td>
                  <td data-label="" colSpan={2} style={{ fontSize: 11, color: '#555', textAlign: 'right' }}>
                    {formatMoney(collectedForMonth)} of {formatMoney(totalMonthlyRent, { noCents: true })} ({paidPct}%)
                  </td>
                </tr>
              )}
              {rentStatus.map(({ tenant, paid, paidDate, shortfall }) => {
                const candidateTx = !paid
                  ? allTransactions.find(tx =>
                      tx.type === 'income' &&
                      tx.tenant_id === tenant.id &&
                      tx.rent_month === prevMonth(selectedMonth)
                    )
                  : null;
                return (
                  <tr key={tenant.id}>
                    <td data-label="Tenant">
                      <a
                        href={`/transactions?tenant_id=${tenant.id}`}
                        style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dotted #ccc' }}
                        title="View this tenant's transactions"
                      >
                        {tenant.name}
                      </a>
                    </td>
                    <td data-label="Rent" className="num mono" style={{ fontSize: 12 }}>
                      {formatMoney(tenant.monthly_rent, { noCents: true })}
                    </td>
                    <td data-label="Paid" className="nowrap" style={{ fontSize: 12, color: '#666' }}>
                      {paid ? formatDate(paidDate) : (
                        <a
                          href={`/transactions?tenant_id=${tenant.id}`}
                          style={{ fontSize: 11, color: '#888', textDecoration: 'none', borderBottom: '1px dotted #aaa' }}
                          title="Go to Transactions to find and fix this payment"
                        >
                          Find payment →
                        </a>
                      )}
                    </td>
                    <td data-label="Status" className="nowrap">
                      {!paid ? (
                        <div>
                          <span className="status-unpaid">● DUE</span>
                          {candidateTx && (
                            <button
                              onClick={() => handleReassignRentMonth(candidateTx.id, selectedMonth)}
                              disabled={reassigning[candidateTx.id]}
                              title={`Payment on ${formatDate(candidateTx.date)} is assigned to the previous month — click to move it to ${selectedMonthLabel}`}
                              style={{
                                display: 'block', marginTop: 4, fontSize: 10,
                                padding: '2px 6px', background: '#EEF2FF',
                                border: '1px solid #818CF8', borderRadius: 3,
                                color: '#4338CA', cursor: 'pointer', whiteSpace: 'nowrap',
                              }}
                            >
                              {reassigning[candidateTx.id] ? '…' : `Move ${formatDate(candidateTx.date)} here`}
                            </button>
                          )}
                        </div>
                      ) : shortfall > 0 ? (
                        <span
                          title={`Paid ${formatMoney(shortfall)} less than expected rent of ${formatMoney(tenant.monthly_rent)}`}
                          style={{
                            color: '#B45309', fontWeight: 700, fontSize: 11,
                            letterSpacing: '0.04em', cursor: 'help',
                          }}
                        >
                          ● PAID <span style={{ fontWeight: 400, fontSize: 10 }}>(short {formatMoney(shortfall, { noCents: true })})</span>
                        </span>
                      ) : (
                        <span className="status-paid">● PAID</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {activeTenants.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No active tenants.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Cash Flow Waterfall — ~55% width */}
        <CashFlowWaterfall
          startDate={startDate}
          endDate={endDate}
          periodLabel={periodLabel}
        />
      </div>

      {/* ── Row 5: Expense Donut + Anomaly Detection ── */}
      <div className="dashboard-analytics-row">
        <ExpenseDonut startDate={startDate} endDate={endDate} />
        <AnomalyCard  startDate={startDate} endDate={endDate} />
      </div>

      {/* ── Row 6: Recent Transactions (full width) ── */}
      <div className="dashboard-panel dashboard-tx-full">
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
          <table className="mobile-cards tx-table" style={{ tableLayout: 'fixed', width: '100%', minWidth: 760 }}>
            <colgroup>
              <col style={{ width: 100 }} /><col /><col style={{ width: 110 }} />
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
                  <td className="tx-mobile-main hide-desktop" style={{ fontWeight: 600, fontSize: 14 }}>
                    <span style={{ flex: 1, marginRight: 8 }}>{tx.display_description || tx.description}</span>
                    <span className="mono" style={{ fontWeight: 700, flexShrink: 0 }}>{formatMoney(Math.abs(parseFloat(tx.amount)))}</span>
                  </td>
                  <td className="tx-mobile-sub hide-desktop">
                    <span style={{ color: '#888', fontSize: 12 }}>{formatDate(tx.date)}</span>
                    {tx.category && <CategoryPill category={tx.category} />}
                    {tx.property_name && <span style={{ fontSize: 11, background: '#F3F4F6', padding: '2px 6px', borderRadius: 10, color: '#555' }}>{tx.property_name}</span>}
                    <span className={`badge ${tx.type}`} style={{ fontSize: 11 }}>{formatType(tx.type)}</span>
                  </td>
                  <td className="nowrap mono show-desktop" style={{ fontSize: 12 }}>{formatDate(tx.date)}</td>
                  <td className="show-desktop" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.description}>
                    {tx.display_description || tx.description}
                  </td>
                  <td className="num mono show-desktop">{formatMoney(Math.abs(parseFloat(tx.amount)))}</td>
                  <td className="nowrap show-desktop"><span className={`badge ${tx.type}`}>{formatType(tx.type)}</span></td>
                  <td className="nowrap show-desktop"><CategoryPill category={tx.category} /></td>
                  <td className="show-desktop" style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {tx.property_scope === 'portfolio'
                      ? <span style={{ fontStyle: 'italic', fontWeight: 600, fontVariant: 'small-caps' }}>All</span>
                      : (tx.property_name || '—')}
                  </td>
                  <td className="show-desktop" style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {tx.tenant_name || '—'}
                  </td>
                </tr>
              ))}
              {transactions.length === 0 && !txLoading && (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    {allTransactions.length === 0 ? (
                      <EmptyState
                        icon="bank"
                        title="No transactions yet"
                        description="Connect your bank account to start importing rent payments and expenses."
                        primaryAction={{ label: 'Go to Settings → Bank Connections', onClick: () => window.location.href = '/settings' }}
                      />
                    ) : (
                      <EmptyState
                        icon="search"
                        title="No transactions in this range"
                        description="Nothing found for the selected period."
                        primaryAction={dateFilter !== 'all' ? { label: 'Show all time', onClick: () => handleFilterClick('all') } : null}
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
