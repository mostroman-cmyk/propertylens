import { useEffect, useState, useCallback } from 'react';
import { getPropertyPL, getTransactions, getTenants } from '../api';
import { formatMoney, formatDate } from '../utils/format';
import { downloadCSV, downloadPDF, downloadExcel, downloadTaxPackage } from '../utils/export';
import EmptyState from '../components/EmptyState';

const ALLOCATION_LABELS = {
  equal:         'Equal split',
  revenue_share: 'By revenue share',
  unit_count:    'By unit count',
  unallocated:   'Unallocated',
};

// ── Progress modal ──────────────────────────────────────────────────────────

function ExportProgress({ message, onClose }) {
  return (
    <div className="modal-overlay" onClick={e => e.stopPropagation()}>
      <div className="modal" style={{ maxWidth: 400, borderRadius: 4 }}>
        <div className="modal-header">
          <h2>Preparing Export</h2>
        </div>
        <div className="modal-body" style={{ textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ fontSize: 28, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 14, color: '#333', marginBottom: 8 }}>{message}</div>
          <div style={{ fontSize: 12, color: '#888' }}>This may take a few seconds...</div>
        </div>
        {onClose && (
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Reports() {
  const [year, setYear]       = useState(new Date().getFullYear());
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Export state
  const [exporting, setExporting]   = useState(false);
  const [exportMsg, setExportMsg]   = useState('');
  const [exportError, setExportError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getPropertyPL(year)
      .then(setData)
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [year]);

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

  /** Fetch the full dataset needed for export */
  const fetchExportData = useCallback(async () => {
    const start = `${year}-01-01`;
    const end   = `${year}-12-31`;
    const [transactions, tenants] = await Promise.all([
      getTransactions({ startDate: start, endDate: end }),
      getTenants(),
    ]);
    return { transactions, tenants };
  }, [year]);

  const handleExport = useCallback(async (format) => {
    setExportError(null);
    const labels = {
      csv:     `Preparing CSV for ${year}…`,
      pdf:     `Generating PDF report for ${year}… This may take 10–15 seconds.`,
      excel:   `Building Excel workbook for ${year}…`,
      tax:     `Assembling tax package for ${year}… Generating PDF + Excel + ZIP…`,
    };
    setExportMsg(labels[format] || 'Preparing export…');
    setExporting(true);
    try {
      const { transactions, tenants } = await fetchExportData();
      const args = { plData: data, transactions, tenants, year };
      if (format === 'csv')   await downloadCSV(args);
      if (format === 'pdf')   await downloadPDF(args);
      if (format === 'excel') await downloadExcel(args);
      if (format === 'tax')   await downloadTaxPackage(args);
    } catch (err) {
      console.error('Export failed:', err);
      setExportError('Export failed: ' + (err?.message || 'Unknown error. Check console.'));
    } finally {
      setExporting(false);
    }
  }, [data, year, fetchExportData]);

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return (
    <EmptyState icon="warning" title="Something went wrong"
      description={`Could not load report data. ${error}`}
      primaryAction={{ label: 'Retry', onClick: () => window.location.reload() }} />
  );

  const { allocation_method, portfolio_expenses, properties } = data;
  const totalNet      = properties.reduce((s, p) => s + p.net, 0);
  const totalIncome   = properties.reduce((s, p) => s + p.income, 0);
  const totalSpecific = properties.reduce((s, p) => s + p.specific_expenses, 0);

  return (
    <div>
      {exporting && <ExportProgress message={exportMsg} />}

      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-input form-input-sm"
            value={year}
            onChange={e => setYear(parseInt(e.target.value))}
            style={{ width: 'auto' }}
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => handleExport('csv')}
            disabled={exporting || properties.length === 0} title="Download full report as CSV">
            Export CSV
          </button>
          <button className="btn-secondary" onClick={() => handleExport('pdf')}
            disabled={exporting || properties.length === 0} title="Download professional PDF report">
            Export PDF
          </button>
          <button className="btn-secondary" onClick={() => handleExport('excel')}
            disabled={exporting || properties.length === 0} title="Download multi-sheet Excel workbook">
            Export Excel
          </button>
          <button className="btn-primary" onClick={() => handleExport('tax')}
            disabled={exporting || properties.length === 0} title="Download complete CPA-ready tax package (ZIP)">
            Tax Package
          </button>
        </div>
      </div>

      {exportError && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {exportError}
          <button className="btn-ghost" style={{ marginLeft: 12, fontSize: 12 }} onClick={() => setExportError(null)}>Dismiss</button>
        </div>
      )}

      <div className="kpi-row" style={{ marginBottom: 24 }}>
        <div className="kpi-item">
          <div className="kpi-label">Total Income</div>
          <div className="kpi-value">{formatMoney(totalIncome)}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Property Expenses</div>
          <div className="kpi-value muted">{formatMoney(totalSpecific)}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Portfolio Expenses</div>
          <div className="kpi-value muted">{formatMoney(portfolio_expenses)}</div>
        </div>
        <div className="kpi-item">
          <div className="kpi-label">Net</div>
          <div className={`kpi-value${totalNet < 0 ? ' negative' : ''}`}>{formatMoney(totalNet)}</div>
        </div>
      </div>

      <h2 className="section-title">
        Per-Property P&L — {year}
        <span style={{ fontWeight: 400, fontSize: 12, marginLeft: 12, color: '#888' }}>
          Portfolio allocation: {ALLOCATION_LABELS[allocation_method] || allocation_method}
        </span>
      </h2>

      {properties.length === 0 ? (
        <EmptyState
          icon="chart"
          title="No data for this period"
          description="No transactions found for the selected year. Try a different year or connect a bank account."
          primaryAction={{ label: 'Go to Settings → Bank Connections', onClick: () => window.location.href = '/settings' }}
        />
      ) : (
        <>
          <table className="tx-table mobile-cards" style={{ tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th>Property</th>
                <th className="num">Income</th>
                <th className="num">Property Expenses</th>
                {allocation_method !== 'unallocated' && <th className="num">Portfolio-Allocated</th>}
                <th className="num">Net</th>
                <th style={{ width: 80 }}>Tenants</th>
              </tr>
            </thead>
            <tbody>
              {properties.map(p => (
                <tr key={p.id}>
                  <td data-label="Property" style={{ fontWeight: 600 }}>{p.name}</td>
                  <td data-label="Income" className="num mono">{formatMoney(p.income)}</td>
                  <td data-label="Expenses" className="num mono" style={{ color: '#666' }}>{formatMoney(p.specific_expenses)}</td>
                  {allocation_method !== 'unallocated' && (
                    <td data-label="Portfolio" className="num mono" style={{ color: '#888', fontStyle: 'italic' }}>
                      {formatMoney(p.portfolio_allocated)}
                    </td>
                  )}
                  <td data-label="Net" className={`num mono${p.net < 0 ? ' negative' : ''}`}>{formatMoney(p.net)}</td>
                  <td data-label="Tenants" style={{ color: '#888' }}>{p.tenant_count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #000', fontWeight: 700 }}>
                <td>Total</td>
                <td className="num mono">{formatMoney(totalIncome)}</td>
                <td className="num mono">{formatMoney(totalSpecific)}</td>
                {allocation_method !== 'unallocated' && (
                  <td className="num mono">{formatMoney(portfolio_expenses)}</td>
                )}
                <td className={`num mono${totalNet < 0 ? ' negative' : ''}`}>{formatMoney(totalNet)}</td>
                <td></td>
              </tr>
              {allocation_method === 'unallocated' && portfolio_expenses > 0 && (
                <tr style={{ color: '#666', fontStyle: 'italic' }}>
                  <td colSpan={5} style={{ paddingTop: 8, fontSize: 12 }}>
                    + {formatMoney(portfolio_expenses)} portfolio-wide expenses not allocated to any property
                  </td>
                </tr>
              )}
            </tfoot>
          </table>

          {/* Mobile totals (tfoot hidden in mobile-cards mode) */}
          <div className="show-mobile" style={{ marginTop: 12, padding: '14px', border: '2px solid #000', borderRadius: 4, fontWeight: 700 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>Total Income</span><span className="mono">{formatMoney(totalIncome)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>Property Expenses</span><span className="mono" style={{ color: '#666' }}>{formatMoney(totalSpecific)}</span>
            </div>
            {allocation_method !== 'unallocated' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Portfolio Expenses</span><span className="mono" style={{ color: '#888' }}>{formatMoney(portfolio_expenses)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', paddingTop: 8, marginTop: 4 }}>
              <span>Net</span><span className={`mono${totalNet < 0 ? ' negative' : ''}`}>{formatMoney(totalNet)}</span>
            </div>
          </div>

          {/* Export note */}
          <div style={{ marginTop: 20, fontSize: 12, color: '#888' }}>
            Exports include full transaction detail, category breakdown, and tenant payment history for {year}.
            The Tax Package includes a Schedule E-ready Excel workbook for your CPA.
          </div>
        </>
      )}
    </div>
  );
}
