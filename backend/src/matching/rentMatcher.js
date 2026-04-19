const db = require('../db/db');
const { calculateRentMonth } = require('./rentMonth');

const AMOUNT_EXACT_TOL   = 1;    // $1 tolerance for exact amount match
const AMOUNT_PARTIAL_PCT = 0.10; // 10% tolerance for partial match

// Strip common payment prefixes before keyword extraction
const PREFIX_RE = /^(zelle\s+(payment\s+)?from|deposit\s+from|transfer\s+from|payment\s+from|ach\s+(credit\s+)?from|venmo\s+from|cashapp\s+from|cash\s+app\s+from|wire\s+(transfer\s+)?from|incoming\s+wire|online\s+transfer\s+from|direct\s+(deposit|pay)\s+from|from)\s+/i;

// Words that carry no signal and must not be saved as pattern keywords
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

function descMatchesTenant(description, tenant, aliasMap) {
  const d = description.toLowerCase();
  const names = [tenant.name, ...(aliasMap.get(tenant.id) || [])];
  return names.some(n =>
    n.toLowerCase().split(/[\s&,]+/).filter(p => p.length > 2).some(p => d.includes(p))
  );
}

function matchTransaction(tx, tenants, patternMap, aliasMap) {
  const amount = parseFloat(tx.amount);
  const desc   = tx.description || '';

  // Layer 0: learned patterns — highest priority (human-verified)
  const keywords = extractKeywords(desc);
  for (const kw of keywords) {
    if (patternMap.has(kw)) {
      const tid    = patternMap.get(kw);
      const tenant = tenants.find(t => t.id === tid);
      // Validate amount still within 10% (guards against stale patterns after rent changes)
      if (tenant && Math.abs(parseFloat(tenant.monthly_rent) - amount) / Math.max(amount, 1) <= AMOUNT_PARTIAL_PCT) {
        return { tenant_id: tid, match_confidence: 'exact', needs_review: false, matched_by: 'pattern' };
      }
    }
  }

  // Layer 1: exact amount + name/alias in description
  const tightCandidates = tenants.filter(t => Math.abs(parseFloat(t.monthly_rent) - amount) <= AMOUNT_EXACT_TOL);
  if (tightCandidates.length > 0) {
    const nameMatch = tightCandidates.find(t => descMatchesTenant(desc, t, aliasMap));
    if (nameMatch) {
      return { tenant_id: nameMatch.id, match_confidence: 'exact', needs_review: false, matched_by: 'name' };
    }
    // Layer 2: unique amount
    if (tightCandidates.length === 1) {
      return { tenant_id: tightCandidates[0].id, match_confidence: 'amount_only', needs_review: false };
    }
    // Layer 3: ambiguous amount
    return { tenant_id: null, match_confidence: 'ambiguous', needs_review: true };
  }

  // Layer 4: partial amount (within 10%) + name/alias
  const looseCandidates = tenants.filter(t => {
    const rent = parseFloat(t.monthly_rent);
    return Math.abs(rent - amount) / Math.max(rent, 1) <= AMOUNT_PARTIAL_PCT;
  });
  const partialMatch = looseCandidates.find(t => descMatchesTenant(desc, t, aliasMap));
  if (partialMatch) {
    return { tenant_id: partialMatch.id, match_confidence: 'partial', needs_review: true };
  }

  return { tenant_id: null, match_confidence: 'none', needs_review: false };
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
    'SELECT tenant_id, pattern_keyword FROM tenant_payment_patterns ORDER BY match_count DESC'
  );

  // Build maps once — never query per transaction
  const aliasMap = new Map();
  for (const { tenant_id, alias } of aliases) {
    if (!aliasMap.has(tenant_id)) aliasMap.set(tenant_id, []);
    aliasMap.get(tenant_id).push(alias);
  }

  const patternMap = new Map(); // keyword → tenant_id (highest match_count wins)
  for (const { tenant_id, pattern_keyword } of patterns) {
    if (!patternMap.has(pattern_keyword)) patternMap.set(pattern_keyword, tenant_id);
  }

  const { rows: transactions } = await db.query(`
    SELECT id, amount, description, date FROM transactions
    WHERE type = 'income' AND tenant_id IS NULL
  `);

  let cPattern = 0, cExact = 0, cAmountOnly = 0, cPartial = 0, cAmbiguous = 0, cNone = 0;

  for (const tx of transactions) {
    const result = matchTransaction(tx, tenants, patternMap, aliasMap);
    let rent_month = null, needs_month_review = false;
    if (result.tenant_id) {
      ({ rent_month, needs_month_review } = calculateRentMonth(tx.date));
    }
    await db.query(
      `UPDATE transactions SET tenant_id=$1, match_confidence=$2, needs_review=$3, rent_month=$4, needs_month_review=$5 WHERE id=$6`,
      [result.tenant_id, result.match_confidence, result.needs_review, rent_month, needs_month_review, tx.id]
    );

    // Auto-learn from name matches (not re-learning pattern-triggered matches)
    if (result.match_confidence === 'exact' && result.matched_by === 'name' && result.tenant_id) {
      await learnPattern(tx.id, result.tenant_id, tx.description);
    }

    if (result.matched_by === 'pattern')         cPattern++;
    else if (result.match_confidence === 'exact')       cExact++;
    else if (result.match_confidence === 'amount_only') cAmountOnly++;
    else if (result.match_confidence === 'partial')     cPartial++;
    else if (result.match_confidence === 'ambiguous')   cAmbiguous++;
    else                                                cNone++;
  }

  const matched = cPattern + cExact + cAmountOnly;
  console.log(`[matcher] pattern=${cPattern}, exact=${cExact}, amount_only=${cAmountOnly}, partial=${cPartial}, ambiguous=${cAmbiguous}, none=${cNone}`);
  return { pattern: cPattern, exact: cExact, amount_only: cAmountOnly, partial: cPartial, ambiguous: cAmbiguous, none: cNone, total: transactions.length, matched };
}

module.exports = { autoMatchAll, matchTransaction, learnPattern, extractKeywords };
