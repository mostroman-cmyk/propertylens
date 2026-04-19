const db = require('../db/db');
const { calculateRentMonth } = require('./rentMonth');

const AMOUNT_EXACT_TOL   = 1;    // $1 tolerance for exact amount match
const AMOUNT_PARTIAL_PCT = 0.10; // 10% tolerance for payer-pattern amount validation

const PREFIX_RE = /^(zelle\s+(payment\s+)?from|deposit\s+from|transfer\s+from|payment\s+from|ach\s+(credit\s+)?from|venmo\s+from|cashapp\s+from|cash\s+app\s+from|wire\s+(transfer\s+)?from|incoming\s+wire|online\s+transfer\s+from|direct\s+(deposit|pay)\s+from|from)\s+/i;

const BLOCKLIST = new Set([
  'zelle', 'venmo', 'cashapp', 'paypal', 'from', 'deposit', 'transfer',
  'payment', 'ach', 'wire', 'online', 'mobile', 'direct', 'bank', 'debit',
  'credit', 'fee', 'charge', 'the', 'and', 'for', 'inc', 'llc', 'pay',
  'pmt', 'ref', 'memo', 'incoming', 'outgoing', 'via', 'int', 'ext',
]);

function extractKeywords(description) {
  let s = (description || '').trim().replace(PREFIX_RE, '');
  return [...new Set(
    s.toLowerCase()
      .split(/[\s\-_.,;:/\\+]+/)
      .filter(w => w.length > 2 && !/^\d+$/.test(w) && !BLOCKLIST.has(w))
  )];
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary match — "BAILY" matches "BAILY ANDREW" but not "ABAILY" or "BAILYTOWN"
function wordMatch(haystack, needle) {
  if (!needle || needle.trim().length < 2) return false;
  try {
    return new RegExp(`\\b${escapeRe(needle.trim())}\\b`, 'i').test(haystack);
  } catch { return false; }
}

// All matchable components of a tenant name
function nameComponents(tenantName) {
  const parts = tenantName.trim().split(/\s+/);
  const result = new Set([tenantName]);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (first.length > 2) result.add(first);
    if (last.length > 2) {
      result.add(last);
      result.add(`${first[0]} ${last}`); // first initial + last name
      result.add(`${last} ${first[0]}`); // last name + first initial
    }
  } else if (parts.length === 1 && parts[0].length > 2) {
    result.add(parts[0]);
  }
  return [...result];
}

function descMatchesTenantByName(description, tenant, aliasMap) {
  const aliases = aliasMap.get(tenant.id) || [];
  const allNames = [tenant.name, ...aliases];
  return allNames.some(name =>
    nameComponents(name).some(comp => wordMatch(description, comp))
  );
}

function matchTransaction(tx, tenants, patternMap, patternConflicts, aliasMap) {
  const amount  = parseFloat(tx.amount);
  const desc    = tx.description || '';
  const dateStr = tx.date ? String(tx.date).slice(0, 10) : '';

  // LAYER 1: Explicit name match (word-boundary, no amount constraint)
  const nameMatches = tenants.filter(t => descMatchesTenantByName(desc, t, aliasMap));
  if (nameMatches.length === 1) {
    const t = nameMatches[0];
    const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — matched by: [layer 1: name match] → assigning to ${t.name}`;
    console.log(reasoning);
    return { tenant_id: t.id, match_confidence: 'exact', needs_review: false, matched_by: 'name', prediction_reasoning: reasoning };
  }
  if (nameMatches.length > 1) {
    // Tiebreak by exact amount
    const exactAmt = nameMatches.filter(t => Math.abs(parseFloat(t.monthly_rent) - amount) <= AMOUNT_EXACT_TOL);
    if (exactAmt.length === 1) {
      const t = exactAmt[0];
      const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — multiple name matches, tiebreak by amount → assigning to ${t.name}`;
      console.log(reasoning);
      return { tenant_id: t.id, match_confidence: 'exact', needs_review: false, matched_by: 'name_amount', prediction_reasoning: reasoning };
    }
    const names = nameMatches.map(t => t.name).join(', ');
    const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — multiple name matches (${names}), cannot tiebreak — leaving blank, needs_review=true`;
    console.log(reasoning);
    return { tenant_id: null, match_confidence: 'ambiguous', needs_review: true, prediction_reasoning: reasoning };
  }

  // LAYER 2: Exact amount, unique across entire portfolio
  const exactCandidates = tenants.filter(t => Math.abs(parseFloat(t.monthly_rent) - amount) <= AMOUNT_EXACT_TOL);
  if (exactCandidates.length === 1) {
    const t = exactCandidates[0];
    const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — amount uniquely matches one tenant → assigning to ${t.name}`;
    console.log(reasoning);
    return { tenant_id: t.id, match_confidence: 'amount_only', needs_review: false, prediction_reasoning: reasoning };
  }
  if (exactCandidates.length > 1) {
    const names = exactCandidates.map(t => t.name).join(', ');
    const reasoning = `No confident match — rent amount $${amount} matches multiple tenants: ${names}, and no payer name identified`;
    console.log(`[rent-match] $${amount} on ${dateStr} — description: '${desc}' — ${reasoning}`);
    return { tenant_id: null, match_confidence: 'ambiguous', needs_review: true, prediction_reasoning: reasoning };
  }

  // LAYER 3: Payer pattern learning with count thresholds
  const keywords = extractKeywords(desc);
  for (const kw of keywords) {
    if (patternConflicts.has(kw)) {
      const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — payer keyword "${kw}" has conflicting assignment history — leaving blank, needs_review=true`;
      console.log(reasoning);
      return { tenant_id: null, match_confidence: 'ambiguous', needs_review: true, prediction_reasoning: reasoning };
    }
    if (patternMap.has(kw)) {
      const { tenant_id, match_count } = patternMap.get(kw);
      const tenant = tenants.find(t => t.id === tenant_id);
      if (tenant && Math.abs(parseFloat(tenant.monthly_rent) - amount) / Math.max(amount, 1) <= AMOUNT_PARTIAL_PCT) {
        if (match_count >= 3) {
          const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — payer pattern "${kw}" (${match_count} past matches) → assigning to ${tenant.name}`;
          console.log(reasoning);
          return { tenant_id, match_confidence: 'exact', needs_review: false, matched_by: 'pattern', prediction_reasoning: reasoning };
        }
        if (match_count >= 2) {
          const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — payer pattern "${kw}" (${match_count} past matches, medium confidence) → assigning to ${tenant.name}`;
          console.log(reasoning);
          return { tenant_id, match_confidence: 'amount_only', needs_review: true, matched_by: 'pattern_medium', prediction_reasoning: reasoning };
        }
      }
    }
  }

  // LAYER 4: No confident match — never guess
  const closeCandidates = tenants.filter(t => Math.abs(parseFloat(t.monthly_rent) - amount) / Math.max(amount, 1) <= AMOUNT_PARTIAL_PCT);
  const reasoning = closeCandidates.length > 0
    ? `No confident match — rent amount $${amount} matches multiple tenants: ${closeCandidates.map(t => t.name).join(', ')}, and no payer name identified`
    : `No confident match — rent amount $${amount} does not closely match any tenant's rent`;
  console.log(`[rent-match] $${amount} on ${dateStr} — description: '${desc}' — ${reasoning}`);
  return { tenant_id: null, match_confidence: 'none', needs_review: false, prediction_reasoning: reasoning };
}

async function learnPattern(txId, tenantId, description) {
  let desc = description;
  if (!desc) {
    const { rows } = await db.query('SELECT description FROM transactions WHERE id=$1', [txId]);
    if (!rows.length) return;
    desc = rows[0].description;
  }
  const keywords = extractKeywords(desc);
  for (const kw of keywords) {
    await db.query(
      `INSERT INTO tenant_payment_patterns (tenant_id, pattern_keyword, match_count, last_seen)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (tenant_id, pattern_keyword)
       DO UPDATE SET match_count = tenant_payment_patterns.match_count + 1, last_seen = NOW()`,
      [tenantId, kw]
    );
  }
  if (keywords.length) console.log(`[matcher] Learned ${keywords.length} keywords for tenant ${tenantId}: ${keywords.join(', ')}`);
}

async function autoMatchAll() {
  const { rows: tenants }  = await db.query('SELECT id, name, monthly_rent FROM tenants');
  const { rows: aliases }  = await db.query('SELECT tenant_id, alias FROM tenant_aliases');
  const { rows: patterns } = await db.query(
    'SELECT tenant_id, pattern_keyword, match_count FROM tenant_payment_patterns ORDER BY match_count DESC'
  );

  const aliasMap = new Map();
  for (const { tenant_id, alias } of aliases) {
    if (!aliasMap.has(tenant_id)) aliasMap.set(tenant_id, []);
    aliasMap.get(tenant_id).push(alias);
  }

  // Build patternMap and detect conflicts (same keyword → different tenants)
  const patternMap = new Map(); // keyword → { tenant_id, match_count }
  const patternConflicts = new Set();
  for (const { tenant_id, pattern_keyword, match_count } of patterns) {
    if (patternMap.has(pattern_keyword)) {
      if (patternMap.get(pattern_keyword).tenant_id !== tenant_id) {
        patternConflicts.add(pattern_keyword);
      }
    } else {
      patternMap.set(pattern_keyword, { tenant_id, match_count });
    }
  }

  const { rows: transactions } = await db.query(`
    SELECT id, amount, description, date FROM transactions
    WHERE type = 'income' AND tenant_id IS NULL
  `);

  let cPattern = 0, cExact = 0, cAmountOnly = 0, cAmbiguous = 0, cNone = 0;

  for (const tx of transactions) {
    const result = matchTransaction(tx, tenants, patternMap, patternConflicts, aliasMap);
    let rent_month = null, needs_month_review = false;
    if (result.tenant_id) {
      ({ rent_month, needs_month_review } = calculateRentMonth(tx.date));
    }
    await db.query(
      `UPDATE transactions
       SET tenant_id=$1, match_confidence=$2, needs_review=$3,
           rent_month=$4, needs_month_review=$5, prediction_reasoning=$6
       WHERE id=$7`,
      [result.tenant_id, result.match_confidence, result.needs_review,
       rent_month, needs_month_review, result.prediction_reasoning || null, tx.id]
    );

    // Auto-learn from name matches (not from pattern-triggered matches to avoid circular reinforcement)
    if ((result.matched_by === 'name' || result.matched_by === 'name_amount') && result.tenant_id) {
      await learnPattern(tx.id, result.tenant_id, tx.description);
    }

    if (result.matched_by === 'pattern' || result.matched_by === 'pattern_medium') cPattern++;
    else if (result.match_confidence === 'exact')       cExact++;
    else if (result.match_confidence === 'amount_only') cAmountOnly++;
    else if (result.match_confidence === 'ambiguous')   cAmbiguous++;
    else                                                cNone++;
  }

  const matched = cPattern + cExact + cAmountOnly;
  console.log(`[matcher] pattern=${cPattern}, exact=${cExact}, amount_only=${cAmountOnly}, ambiguous=${cAmbiguous}, none=${cNone}`);
  return { pattern: cPattern, exact: cExact, amount_only: cAmountOnly, partial: 0, ambiguous: cAmbiguous, none: cNone, total: transactions.length, matched };
}

module.exports = { autoMatchAll, matchTransaction, learnPattern, extractKeywords };
