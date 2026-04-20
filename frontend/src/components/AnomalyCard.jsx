import { useEffect, useState, useCallback } from 'react';
import { getDashboardAnomalies } from '../api';

const TYPE_STYLE = {
  amount:         { border: '#f59e0b', bg: '#fffbeb' },
  category_spike: { border: '#CC0000', bg: '#fff5f5' },
  new_merchant:   { border: '#6366f1', bg: '#f5f5ff' },
  rent:           { border: '#0ea5e9', bg: '#f0faff' },
};

function AnomalyItem({ anomaly, onReview }) {
  const style = TYPE_STYLE[anomaly.type] || { border: '#ccc', bg: '#fafafa' };
  return (
    <div
      style={{
        borderLeft: `3px solid ${style.border}`,
        background: style.bg,
        padding: '10px 12px',
        marginBottom: 8,
        borderRadius: '0 3px 3px 0',
      }}
      role="listitem"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#111', marginBottom: 2 }}>
            <span style={{ marginRight: 6 }} aria-hidden="true">{anomaly.icon}</span>
            {anomaly.title}
          </div>
          <div style={{ fontSize: 11, color: '#555', lineHeight: 1.5 }}>
            {anomaly.description}
          </div>
          {anomaly.category && (
            <div style={{ fontSize: 10, color: '#888', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {anomaly.category}
            </div>
          )}
        </div>
        {anomaly.transaction_id && (
          <a
            href={`/transactions?highlight=${anomaly.transaction_id}`}
            style={{
              fontSize: 10, color: '#111', border: '1px solid #111',
              padding: '3px 8px', borderRadius: 2, flexShrink: 0,
              textDecoration: 'none', whiteSpace: 'nowrap',
              fontWeight: 600, letterSpacing: '0.04em',
            }}
            aria-label={`Review transaction: ${anomaly.title}`}
          >
            REVIEW →
          </a>
        )}
      </div>
    </div>
  );
}

export default function AnomalyCard({ startDate, endDate }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(() => {
    setLoading(true);
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate)   params.endDate   = endDate;
    getDashboardAnomalies(params)
      .then(setResult)
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  useEffect(() => { fetch(); }, [fetch]);

  const anomalies = result?.anomalies || [];

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          ANOMALIES
          {!loading && anomalies.length > 0 && (
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 700,
              background: '#CC0000', color: '#fff',
              borderRadius: 10, padding: '1px 7px', verticalAlign: 'middle',
            }}>
              {anomalies.length}
            </span>
          )}
        </h2>
      </div>

      {loading && <div style={{ color: '#888', fontSize: 13, padding: '20px 0' }}>Analyzing…</div>}

      {!loading && anomalies.length === 0 && (
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>✓</div>
          <div style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>No anomalies detected</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
            All transactions look normal for this period.
          </div>
        </div>
      )}

      {!loading && anomalies.length > 0 && (
        <div role="list" aria-label={`${anomalies.length} anomalies detected`}>
          {anomalies.map((a, i) => (
            <AnomalyItem key={i} anomaly={a} />
          ))}
        </div>
      )}
    </div>
  );
}
