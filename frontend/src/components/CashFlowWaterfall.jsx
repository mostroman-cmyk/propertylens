import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, LabelList,
} from 'recharts';
import { getDashboardCashFlow } from '../api';
import { formatMoney } from '../utils/format';
import { getCategoryColor } from '../utils/categoryColors';

const INCOME_COLOR = '#2D7A3E';   // deep green (matches Rent color)
const NET_POS_COLOR = '#000000';  // black
const NET_NEG_COLOR = '#CC0000';  // red if negative

function buildWaterfallData(cashFlow) {
  const { totalIncome, categories, netIncome } = cashFlow;
  const data = [];

  // Income bar — full bar from 0 to totalIncome
  data.push({
    name: 'Income',
    label: '+ INCOME',
    start: 0,
    value: totalIncome,
    type: 'income',
    amount: totalIncome,
    pct: 100,
    count: null,
  });

  // Expense bars — each peels from the right
  let remaining = totalIncome;
  for (const cat of categories) {
    remaining -= cat.total;
    data.push({
      name: cat.category,
      label: `− ${cat.category.toUpperCase()}`,
      start: Math.max(0, remaining),
      value: cat.total,
      type: 'expense',
      amount: cat.total,
      pct: totalIncome > 0 ? (cat.total / totalIncome * 100) : 0,
      count: cat.count,
    });
  }

  // Net income bar
  data.push({
    name: 'Net Income',
    label: '= NET',
    start: 0,
    value: Math.abs(netIncome),
    type: 'net',
    amount: netIncome,
    pct: totalIncome > 0 ? (netIncome / totalIncome * 100) : 0,
    count: null,
  });

  return data;
}

function barFill(entry) {
  if (entry.type === 'income') return INCOME_COLOR;
  if (entry.type === 'net') return entry.amount >= 0 ? NET_POS_COLOR : NET_NEG_COLOR;
  return getCategoryColor(entry.name);
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const entry = payload.find(p => p.dataKey === 'value')?.payload;
  if (!entry) return null;
  return (
    <div style={{
      background: '#111', color: '#fff', padding: '10px 14px',
      borderRadius: 3, fontSize: 12, minWidth: 180, lineHeight: 1.7,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>{entry.label}</div>
      <div>{formatMoney(Math.abs(entry.amount))}</div>
      <div style={{ color: '#aaa' }}>{entry.pct.toFixed(1)}% of income</div>
      {entry.count != null && <div style={{ color: '#aaa' }}>{entry.count} transaction{entry.count !== 1 ? 's' : ''}</div>}
    </div>
  );
}

// Tick renderer — shows the label on the Y axis
function CustomYTick({ x, y, payload }) {
  return (
    <text
      x={x} y={y}
      textAnchor="end"
      dominantBaseline="middle"
      style={{ fontSize: 10, fontFamily: 'monospace', fill: '#333', letterSpacing: '0.03em' }}
    >
      {payload.value}
    </text>
  );
}

// Label on the right of each bar showing dollar amount
function BarAmountLabel({ x, y, width, height, value, index, data }) {
  if (!data) return null;
  const entry = data[index];
  if (!entry) return null;
  const xPos = (x || 0) + (width || 0) + 6;
  const yPos = (y || 0) + (height || 0) / 2;
  return (
    <text
      x={xPos} y={yPos}
      dominantBaseline="middle"
      style={{ fontSize: 10, fontFamily: 'monospace', fill: barFill(entry) }}
    >
      {formatMoney(Math.abs(entry.amount), { noCents: true })}
    </text>
  );
}

export default function CashFlowWaterfall({ startDate, endDate, periodLabel }) {
  const [cashFlow, setCashFlow] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(() => {
    setLoading(true);
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate)   params.endDate   = endDate;
    getDashboardCashFlow(params)
      .then(setCashFlow)
      .catch(() => setCashFlow(null))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  useEffect(() => { fetch(); }, [fetch]);

  const isEmpty = !cashFlow || (cashFlow.totalIncome === 0 && cashFlow.totalExpenses === 0);

  const data = cashFlow && !isEmpty ? buildWaterfallData(cashFlow) : [];
  // Bar height + gap per row
  const barSize = 26;
  const chartHeight = data.length > 0 ? Math.max(200, data.length * (barSize + 14) + 24) : 120;

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 4 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            CASH FLOW
            {periodLabel && <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 12, color: '#888', textTransform: 'none' }}>— {periodLabel}</span>}
          </h2>
          <span
            title="Income and expenses counted by transaction deposit date — differs from the Collected KPI which attributes payments by rent month"
            style={{ fontSize: 10, color: '#999', cursor: 'help', alignSelf: 'center' }}
          >
            by deposit date ⓘ
          </span>
        </div>
      </div>

      {loading && <div style={{ color: '#888', fontSize: 13, padding: '20px 0' }}>Loading…</div>}

      {!loading && isEmpty && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#888', fontSize: 13 }}>
          No cash flow data for this period.
        </div>
      )}

      {!loading && !isEmpty && cashFlow && (
        <>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 80, left: 0, bottom: 4 }}
              barCategoryGap={8}
            >
              <XAxis
                type="number"
                domain={[0, cashFlow.totalIncome * 1.02]}
                hide
              />
              <YAxis
                type="category"
                dataKey="label"
                width={130}
                tick={<CustomYTick />}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              {/* Invisible offset bar — creates the waterfall indent */}
              <Bar dataKey="start" stackId="wf" fill="transparent" isAnimationActive={false} />
              {/* Visible colored bar */}
              <Bar dataKey="value" stackId="wf" isAnimationActive={false} maxBarSize={barSize}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={barFill(entry)} />
                ))}
                <LabelList
                  content={(props) => <BarAmountLabel {...props} data={data} />}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div style={{ display: 'flex', gap: 24, paddingTop: 8, borderTop: '1px solid #eee', marginTop: 4, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: '#555' }}>
              <span style={{ color: INCOME_COLOR, fontWeight: 700, marginRight: 4 }}>■</span>
              Income {formatMoney(cashFlow.totalIncome, { noCents: true })}
            </div>
            <div style={{ fontSize: 11, color: '#555' }}>
              <span style={{ color: '#CC0000', fontWeight: 700, marginRight: 4 }}>■</span>
              Expenses {formatMoney(cashFlow.totalExpenses, { noCents: true })}
            </div>
            <div style={{ fontSize: 11, color: '#555' }}>
              <span style={{ color: cashFlow.netIncome >= 0 ? NET_POS_COLOR : NET_NEG_COLOR, fontWeight: 700, marginRight: 4 }}>■</span>
              Net {formatMoney(cashFlow.netIncome, { noCents: true })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
