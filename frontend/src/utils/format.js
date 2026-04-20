// Shared formatting utilities — use these everywhere instead of inline toLocaleString calls.

/**
 * Format a currency amount.
 * Default: "$3,495.00" (always 2 decimals, $ prefix, comma thousands)
 * Options:
 *   noCents: true  → "$3,495"
 *   compact: true  → "$3.5K" / "$1.2M"
 *   showSign: true → "+$3,495.00" / "-$3,495.00"
 */
export function formatMoney(amount, options = {}) {
  const num = parseFloat(amount);
  if (amount == null || isNaN(num)) return options.noCents ? '$0' : '$0.00';

  const abs = Math.abs(num);
  const negative = num < 0;

  if (options.compact) {
    let val, suffix;
    if (abs >= 1_000_000)    { val = abs / 1_000_000; suffix = 'M'; }
    else if (abs >= 1_000)   { val = abs / 1_000;     suffix = 'K'; }
    else                     { val = abs;              suffix = '';  }
    const str = suffix
      ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${suffix}`
      : `$${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    return (negative ? '-' : options.showSign ? '+' : '') + str;
  }

  const decimals = options.noCents ? 0 : 2;
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = negative ? '-' : (options.showSign ? '+' : '');
  return `${sign}$${formatted}`;
}

/**
 * Format a date.
 * Handles YYYY-MM-DD strings (parses at noon to avoid timezone shifts), Date objects,
 * and ISO timestamp strings.
 * Formats:
 *   'short'     → "Apr 13, 2026"  (default)
 *   'long'      → "April 13, 2026"
 *   'monthYear' → "April 2026"
 *   'compact'   → "04/13/26"
 *   'header'    → "Mon, Apr 13, 2026"
 *   'relative'  → "2 days ago" / "yesterday" / "3 months ago"
 */
export function formatDate(date, format = 'short') {
  if (!date) return '—';
  let d;
  if (typeof date === 'string') {
    // YYYY-MM-DD → parse at noon local time to avoid off-by-one
    d = date.length === 10 ? new Date(date + 'T12:00:00') : new Date(date);
  } else {
    d = date;
  }
  if (isNaN(d.getTime())) return '—';

  switch (format) {
    case 'short':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    case 'long':
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    case 'monthYear':
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'compact':
      return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    case 'header':
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    case 'relative':
      return _formatRelative(d);
    default:
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

function _formatRelative(d) {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 30)  return `${days} days ago`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}

/**
 * Format a plain number with commas.
 * formatNumber(751)     → "751"
 * formatNumber(20513.5) → "20,513.5"
 */
export function formatNumber(n, options = {}) {
  const num = parseFloat(n);
  if (n == null || isNaN(num)) return '0';
  const isInt = Number.isInteger(num);
  const decimals = options.decimals ?? (isInt ? 0 : 2);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a decimal as percentage.
 * formatPercent(0.847) → "84.7%"
 * formatPercent(1.0)   → "100%"
 */
export function formatPercent(decimal) {
  if (decimal == null || isNaN(decimal)) return '0%';
  const pct = parseFloat(decimal) * 100;
  const isInt = Number.isInteger(Math.round(pct * 10) / 10);
  return `${pct.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: pct % 1 === 0 ? 0 : 1,
  })}%`;
}

/**
 * Format a phone number: "5551234567" → "(555) 123-4567"
 */
export function formatPhone(phone) {
  if (!phone) return '—';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

/**
 * Format an address consistently (capitalize each word).
 */
export function formatAddress(address) {
  if (!address) return '—';
  return address
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
