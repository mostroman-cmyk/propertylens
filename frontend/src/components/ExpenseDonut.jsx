import { useEffect, useState, useCallback } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import { getDashboardExpenses } from '../api';
import { formatMoney } from '../utils/format';
import { getCategoryColor } from '../utils/categoryColors';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0].payload;
  return (
    <div style={{
      background: '#111', color: '#fff', padding: '10px 14px',
      borderRadius: 3, fontSize: 12, minWidth: 160, lineHeight: 1.7,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{entry.category}</div>
      <div>{formatMoney(entry.total)}</div>
      <div style={{ color: '#aaa' }}>{entry.pct}% of expenses</div>
      <div style={{ color: '#aaa' }}>{entry.count} transaction{entry.count !== 1 ? 's' : ''}</div>
    </div>
  );
}

// Center label rendered inside the donut hole via SVG foreignObject
function CenterLabel({ cx, cy, totalExpenses }) {
  return (
    <g>
      <text
        x={cx} y={cy - 10}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', fill: '#111' }}
      >
        {formatMoney(totalExpenses, { noCents: true })}
      </text>
      <text
        x={cx} y={cy + 12}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: 9, fontFamily: 'sans-serif', fill: '#888', letterSpacing: '0.08em', textTransform: 'uppercase' }}
      >
        TOTAL EXP.
      </text>
    </g>
  );
}

export default function ExpenseDonut({ startDate, endDate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(null);

  const fetch = useCallback(() => {
    setLoading(true);
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate)   params.endDate   = endDate;
    getDashboardExpenses(params)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  useEffect(() => { fetch(); }, [fetch]);

  const isEmpty = !data || !data.categories?.length || data.totalExpenses === 0;

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <h2 className="section-title" style={{ margin: 0 }}>EXPENSES BY CATEGORY</h2>
      </div>

      {loading && <div style={{ color: '#888', fontSize: 13, padding: '20px 0' }}>Loading…</div>}

      {!loading && isEmpty && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#888', fontSize: 13 }}>
          No expense data for this period.
        </div>
      )}

      {!loading && !isEmpty && data && (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Donut */}
          <div style={{ flex: '0 0 180px', position: 'relative' }}>
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  data={data.categories}
                  dataKey="total"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius="52%"
                  outerRadius="80%"
                  paddingAngle={2}
                  isAnimationActive={false}
                  onMouseEnter={(_, i) => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(null)}
                >
                  {data.categories.map((cat, i) => (
                    <Cell
                      key={i}
                      fill={getCategoryColor(cat.category)}
                      opacity={activeIndex === null || activeIndex === i ? 1 : 0.35}
                      stroke="none"
                    />
                  ))}
                </Pie>
                <CenterLabel
                  cx={90}
                  cy={90}
                  totalExpenses={data.totalExpenses}
                />
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div style={{ flex: '1 1 0', minWidth: 140 }}>
            {data.categories.map((cat, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  borderBottom: '1px solid #f0f0f0',
                  opacity: activeIndex === null || activeIndex === i ? 1 : 0.4,
                  cursor: 'default',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <div style={{
                  width: 10, height: 10, borderRadius: 1, flexShrink: 0,
                  background: getCategoryColor(cat.category),
                }} />
                <div style={{ flex: 1, fontSize: 11, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cat.category}
                </div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#111', flexShrink: 0 }}>
                  {formatMoney(cat.total, { noCents: true })}
                </div>
                <div style={{ fontSize: 10, color: '#888', flexShrink: 0, width: 30, textAlign: 'right' }}>
                  {cat.pct}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
