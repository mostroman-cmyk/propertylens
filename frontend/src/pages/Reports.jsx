import { useEffect, useState } from 'react';
import { getPropertyPL } from '../api';
import { formatMoney } from '../utils/format';

const ALLOCATION_LABELS = {
  equal:         'Equal split',
  revenue_share: 'By revenue share',
  unit_count:    'By unit count',
  unallocated:   'Unallocated',
};

export default function Reports() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  if (loading) return <div className="loading">Loading...</div>;
  if (error)   return <div className="error">Error: {error}</div>;

  const { allocation_method, portfolio_expenses, properties } = data;
  const totalNet = properties.reduce((s, p) => s + p.net, 0);
  const totalIncome = properties.reduce((s, p) => s + p.income, 0);
  const totalSpecific = properties.reduce((s, p) => s + p.specific_expenses, 0);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <select className="form-input form-input-sm" value={year} onChange={e => setYear(parseInt(e.target.value))} style={{ width: 'auto' }}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

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
        <div style={{ textAlign: 'center', color: '#888', padding: '48px 0' }}>No properties found.</div>
      ) : (
        <table className="tx-table" style={{ tableLayout: 'auto' }}>
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
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td className="num mono">{formatMoney(p.income)}</td>
                <td className="num mono" style={{ color: '#666' }}>{formatMoney(p.specific_expenses)}</td>
                {allocation_method !== 'unallocated' && (
                  <td className="num mono" style={{ color: '#888', fontStyle: 'italic' }}>
                    {formatMoney(p.portfolio_allocated)}
                  </td>
                )}
                <td className={`num mono${p.net < 0 ? ' negative' : ''}`}>{formatMoney(p.net)}</td>
                <td style={{ color: '#888' }}>{p.tenant_count}</td>
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
      )}
    </div>
  );
}
