const db = require('../db/db');
const { sendMail } = require('./mailer');

const RENT_TOLERANCE = 10;

function buildHtml({ month, year, paid, unpaid, totalCollected, totalExpected }) {
  const monthName = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' });
  const outstanding = totalExpected - totalCollected;
  const allPaid = unpaid.length === 0;

  const paidRows = paid.map(t => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;">
        <span style="color:#16a34a;font-size:1.1em;margin-right:8px;">&#10003;</span>
        <strong>${t.name}</strong>
        <span style="color:#888;font-size:0.85em;margin-left:6px;">${t.unit} &bull; ${t.property_name}</span>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right;color:#16a34a;font-weight:600;">
        $${t.monthly_rent.toLocaleString()}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right;color:#888;font-size:0.85em;">
        ${new Date(t.paid_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </td>
    </tr>`).join('');

  const unpaidRows = unpaid.map(t => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;">
        <span style="color:#dc2626;font-size:1.1em;margin-right:8px;">&#10007;</span>
        <strong>${t.name}</strong>
        <span style="color:#888;font-size:0.85em;margin-left:6px;">${t.unit} &bull; ${t.property_name}</span>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right;color:#dc2626;font-weight:600;">
        $${t.monthly_rent.toLocaleString()}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;text-align:right;color:#dc2626;font-size:0.85em;">
        Not received
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#1a1f36;padding:28px 32px;">
      <div style="color:#7c8ef7;font-size:1rem;font-weight:700;letter-spacing:0.05em;margin-bottom:4px;">PROPERTYLENS</div>
      <div style="color:#fff;font-size:1.5rem;font-weight:700;">Rent Status &mdash; ${monthName} ${year}</div>
    </div>

    <!-- Summary bar -->
    <div style="background:${allPaid ? '#dcfce7' : '#fff7ed'};padding:20px 32px;display:flex;gap:32px;border-bottom:1px solid #e5e7eb;">
      <div>
        <div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Collected</div>
        <div style="font-size:1.6rem;font-weight:700;color:#16a34a;">$${totalCollected.toLocaleString()}</div>
      </div>
      <div>
        <div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Expected</div>
        <div style="font-size:1.6rem;font-weight:700;color:#1a1f36;">$${totalExpected.toLocaleString()}</div>
      </div>
      <div>
        <div style="font-size:0.75rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Outstanding</div>
        <div style="font-size:1.6rem;font-weight:700;color:${outstanding > 0 ? '#dc2626' : '#16a34a'};">$${outstanding.toLocaleString()}</div>
      </div>
    </div>

    <div style="padding:24px 32px;">

      ${paid.length > 0 ? `
      <!-- Paid section -->
      <div style="margin-bottom:24px;">
        <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#16a34a;margin-bottom:10px;">
          Paid (${paid.length})
        </div>
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f0fdf4;">
              <th style="padding:8px 14px;text-align:left;font-size:0.75rem;color:#666;font-weight:600;">Tenant</th>
              <th style="padding:8px 14px;text-align:right;font-size:0.75rem;color:#666;font-weight:600;">Amount</th>
              <th style="padding:8px 14px;text-align:right;font-size:0.75rem;color:#666;font-weight:600;">Received</th>
            </tr>
          </thead>
          <tbody>${paidRows}</tbody>
        </table>
      </div>` : ''}

      ${unpaid.length > 0 ? `
      <!-- Unpaid section -->
      <div style="margin-bottom:24px;">
        <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#dc2626;margin-bottom:10px;">
          Not Yet Paid (${unpaid.length})
        </div>
        <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#fef2f2;">
              <th style="padding:8px 14px;text-align:left;font-size:0.75rem;color:#666;font-weight:600;">Tenant</th>
              <th style="padding:8px 14px;text-align:right;font-size:0.75rem;color:#666;font-weight:600;">Amount Due</th>
              <th style="padding:8px 14px;text-align:right;font-size:0.75rem;color:#666;font-weight:600;">Status</th>
            </tr>
          </thead>
          <tbody>${unpaidRows}</tbody>
        </table>
      </div>` : ''}

      ${allPaid ? `
      <div style="background:#dcfce7;border-radius:8px;padding:16px 20px;text-align:center;color:#16a34a;font-weight:600;">
        All tenants have paid this month.
      </div>` : ''}

    </div>

    <!-- Dashboard button -->
    <div style="padding:24px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}"
         style="display:inline-block;background:#7c8ef7;color:#fff;text-decoration:none;font-weight:700;font-size:0.95rem;padding:14px 32px;border-radius:8px;letter-spacing:0.02em;">
        Open PropertyLens Dashboard
      </a>
    </div>

    <!-- Footer -->
    <div style="background:#f5f6fa;padding:16px 32px;text-align:center;color:#aaa;font-size:0.78rem;border-top:1px solid #e5e7eb;">
      Sent by PropertyLens &bull; ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>`;
}

async function sendRentReport({ month, year } = {}) {
  const now = new Date();
  month = month ?? (now.getMonth() + 1);
  year  = year  ?? now.getFullYear();

  // Pad month for SQL LIKE match: '2026-04-%'
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-%`;

  // All tenants with their property name
  const { rows: tenants } = await db.query(`
    SELECT t.id, t.name, t.unit, t.monthly_rent,
           p.name AS property_name
    FROM tenants t
    JOIN properties p ON t.property_id = p.id
    ORDER BY p.id, t.unit
  `);

  // Deposits this month that match a rent amount (within tolerance)
  const { rows: deposits } = await db.query(`
    SELECT amount, date
    FROM transactions
    WHERE type = 'income'
      AND date LIKE $1
    ORDER BY date ASC
  `, [monthPrefix]);

  const paid = [];
  const unpaid = [];

  // Greedy match: for each tenant find the earliest unmatched deposit
  const availableDeposits = [...deposits];

  for (const tenant of tenants) {
    const rent = parseFloat(tenant.monthly_rent);
    const matchIdx = availableDeposits.findIndex(
      d => Math.abs(parseFloat(d.amount) - rent) <= RENT_TOLERANCE
    );
    if (matchIdx !== -1) {
      paid.push({ ...tenant, paid_date: availableDeposits[matchIdx].date });
      availableDeposits.splice(matchIdx, 1);
    } else {
      unpaid.push(tenant);
    }
  }

  const totalExpected  = tenants.reduce((s, t) => s + parseFloat(t.monthly_rent), 0);
  const totalCollected = paid.reduce((s, t) => s + parseFloat(t.monthly_rent), 0);

  const html = buildHtml({ month, year, paid, unpaid, totalCollected, totalExpected });

  // Use notify_email from settings table, fall back to .env
  let notifyEmail = process.env.NOTIFY_EMAIL;
  try {
    const { rows } = await db.query("SELECT value FROM settings WHERE key = 'notify_email'");
    if (rows[0]?.value) notifyEmail = rows[0].value;
  } catch { /* use .env fallback */ }

  await sendMail({
    to: notifyEmail,
    subject: `PropertyLens — Rent Status for ${new Date(year, month - 1).toLocaleString('default', { month: 'long' })} ${year}`,
    html,
  });

  return { paid: paid.length, unpaid: unpaid.length, totalCollected, totalExpected, notifyEmail };
}

module.exports = { sendRentReport };
