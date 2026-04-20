const db = require('../db/db');
const { calculateRentMonth } = require('./rentMonth');
const { extractSenderName, amountMatchesTolerance } = require('../prediction/engine');

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

function wordMatch(haystack, needle) {
  if (!needle || needle.trim().length < 2) return false;
  try {
    return new RegExp(`\\b${escapeRe(needle.trim())}\\b`, 'i').test(haystack);
  } catch { return false; }
}

function nameComponents(tenantName) {
  const parts = tenantName.trim().split(/\s+/);
  const result = new Set([tenantName]);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (first.length > 2) result.add(first);
    if (last.length > 2) {
      result.add(last);
      result.add(`${first[0]} ${last}`);
      result.add(`${last} ${first[0]}`);
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

// Also check if the extracted sender name matches a tenant name
function payerNameMatchesTenant(payerName, tenant, aliasMap) {
  if (!payerName) return false;
  return descMatchesTenantByName(payerName, tenant, aliasMap);
}

function matchTransaction(tx, tenants, patternMap, patternConflicts, aliasMap, payerPatternMap = new Map(), payerConflicts = new Set(), payerAmountPatternMap = new Map()) {
  const amount  = parseFloat(tx.amount);
  const desc    = tx.description || '';
  const dateStr = tx.date ? String(tx.date).slice(0, 10) : '';
  const payerName = extractSenderName(desc);

  // LAYER 1: Explicit name match (word-boundary, checks both raw description and extracted payer name)
  const nameMatches = tenants.filter(t =>
    descMatchesTenantByName(desc, t, aliasMap) ||
    (payerName && payerNameMatchesTenant(payerName, t, aliasMap))
  );
  if (nameMatches.length === 1) {
    const t = nameMatches[0];
    const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — matched by: [layer 1: name match] → assigning to ${t.name}`;
    console.log(reasoning);
    return { tenant_id: t.id, match_confidence: 'exact', needs_review: false, matched_by: 'name', prediction_reasoning: reasoning };
  }
  if (nameMatches.length > 1) {
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

  // LAYER 3a': Payer-name + amount match (amount-specific — takes priority over payer-only)
  if (payerName) {
    const amtPatterns = payerAmountPatternMap.get(payerName) || [];
    if (amtPatterns.length > 0) {
      const matchingAmt = amtPatterns.filter(p => amountMatchesTolerance(amount, p.amount_bucket));
      if (matchingAmt.length > 0) {
        const uniqueTenants = [...new Set(matchingAmt.map(p => p.tenant_id).filter(Boolean))];
        if (uniqueTenants.length === 1) {
          const tid = uniqueTenants[0];
          const tenant = tenants.find(t => t.id === tid);
          const totalCount = matchingAmt.reduce((s, p) => s + p.confirmed_count, 0);
          const reasoning = `[rent-match] $${amount} on ${dateStr} — payer "${payerName}" at ~$${matchingAmt[0].amount_bucket} (${totalCount} confirmed) → ${tenant?.name}`;
          console.log(reasoning);
          return { tenant_id: tid, match_confidence: 'exact', needs_review: false, matched_by: 'payer_amount', prediction_reasoning: reasoning };
        }
        // Conflicting tenants at this amount
        const reasoning = `[rent-match] $${amount} on ${dateStr} — payer "${payerName}" has conflicting amount patterns — ambiguous`;
        console.log(reasoning);
        return { tenant_id: null, match_confidence: 'ambiguous', needs_review: true, prediction_reasoning: reasoning };
      }
      // No amount match, but payer maps to multiple tenants — block payer-only fallthrough
      const allAmtTenants = [...new Set(amtPatterns.map(p => p.tenant_id).filter(Boolean))];
      if (allAmtTenants.length > 1) {
        const amtMappings = amtPatterns.map(p => {
          const t = tenants.find(t => t.id === p.tenant_id);
          return `$${p.amount_bucket}→${t?.name || p.tenant_id}`;
        }).join(', ');
        const reasoning = `[rent-match] $${amount} on ${dateStr} — payer "${payerName}" maps to different tenants by amount [${amtMappings}], $${amount} not recognized`;
        console.log(reasoning);
        return { tenant_id: null, match_confidence: 'ambiguous', needs_review: true, prediction_reasoning: reasoning };
      }
    }
  }

  // LAYER 3a: Payer-name pattern match (full extracted sender name → confirmed tenant)
  if (payerName) {
    if (payerConflicts.has(payerName)) {
      const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — payer_name "${payerName}" has conflicting tenant history — leaving blank, needs_review=true`;
      console.log(reasoning);
      return { tenant_id: null, match_confidence: 'ambiguous', needs_review: true, prediction_reasoning: reasoning };
    }
    const payerMatch = payerPatternMap.get(payerName);
    if (payerMatch) {
      const { tenant_id, confirmed_count } = payerMatch;
      const tenant = tenants.find(t => t.id === tenant_id);
      const confidence = confirmed_count >= 2 ? 'exact' : 'amount_only';
      const needs_review = confirmed_count < 2;
      const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — payer_name "${payerName}" (${confirmed_count} confirmed) → assigning to ${tenant?.name}`;
      console.log(reasoning);
      return { tenant_id, match_confidence: confidence, needs_review, matched_by: 'payer_name', prediction_reasoning: reasoning };
    }
  }

  // LAYER 3b: Keyword pattern learning (fallback to individual keywords)
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
          const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — payer keyword "${kw}" (${match_count} past matches) → assigning to ${tenant.name}`;
          console.log(reasoning);
          return { tenant_id, match_confidence: 'exact', needs_review: false, matched_by: 'pattern', prediction_reasoning: reasoning };
        }
        if (match_count >= 2) {
          const reasoning = `[rent-match] $${amount} on ${dateStr} — description: '${desc}' — payer keyword "${kw}" (${match_count} past matches, medium confidence) → assigning to ${tenant.name}`;
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
  let txAmount = null;
  if (!desc) {
    const { rows } = await db.query('SELECT description, amount FROM transactions WHERE id=$1', [txId]);
    if (!rows.length) return;
    desc = rows[0].description;
    txAmount = rows[0].amount;
  } else {
    const { rows } = await db.query('SELECT amount FROM transactions WHERE id=$1', [txId]);
    if (rows.length) txAmount = rows[0].amount;
  }

  const payerName = extractSenderName(desc);

  // Primary: save payer_name + amount_bucket → tenant (amount-specific)
  if (payerName && txAmount != null) {
    const bucket = Math.round(Math.abs(parseFloat(txAmount)) / 5.0) * 5;
    try {
      const { rows: existing } = await db.query(
        `SELECT id FROM payer_amount_patterns
         WHERE payer_name=$1 AND amount_bucket=$2 AND category='rent'
         AND (tenant_id=$3 OR (tenant_id IS NULL AND $3::integer IS NULL))`,
        [payerName, bucket, tenantId || null]
      );
      if (existing.length > 0) {
        await db.query(
          'UPDATE payer_amount_patterns SET confirmed_count=confirmed_count+1, last_confirmed_at=NOW() WHERE id=$1',
          [existing[0].id]
        );
      } else {
        await db.query(
          'INSERT INTO payer_amount_patterns (payer_name, amount_bucket, tenant_id, category) VALUES ($1,$2,$3,$4)',
          [payerName, bucket, tenantId || null, 'rent']
        );
      }
      console.log(`[matcher] Learned payer_amount_pattern "${payerName}" @ $${bucket} → tenant ${tenantId}`);
    } catch (err) {
      console.error('[matcher] payer_amount_patterns insert failed:', err.message);
    }
  }

  // Also save to payer_patterns (payer-only, for backwards compat)
  if (payerName) {
    try {
      await db.query(
        `INSERT INTO payer_patterns (payer_name, tenant_id, confirmed_count, last_confirmed_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (payer_name, tenant_id)
         DO UPDATE SET confirmed_count = payer_patterns.confirmed_count + 1, last_confirmed_at = NOW()`,
        [payerName, tenantId]
      );
    } catch (err) {
      console.error('[matcher] payer_patterns insert failed:', err.message);
    }
  }

  // Update payer_name on the transaction itself
  if (payerName) {
    try {
      await db.query('UPDATE transactions SET payer_name=$1 WHERE id=$2', [payerName, txId]);
    } catch {}
  }

  // Secondary: save individual keywords for backwards compat
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
  if (keywords.length || payerName) {
    console.log(`[matcher] Learned ${keywords.length} keywords${payerName ? ` + payer_amount + payer_name` : ''} for tenant ${tenantId}`);
  }
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

  // Build keyword patternMap and detect conflicts
  const patternMap = new Map();
  const patternConflicts = new Set();
  for (const { tenant_id, pattern_keyword, match_count } of patterns) {
    if (patternMap.has(pattern_keyword)) {
      if (patternMap.get(pattern_keyword).tenant_id !== tenant_id) patternConflicts.add(pattern_keyword);
    } else {
      patternMap.set(pattern_keyword, { tenant_id, match_count });
    }
  }

  // Build payer_name patternMap and detect conflicts
  const payerPatternMap = new Map(); // payer_name → {tenant_id, confirmed_count}
  const payerConflicts  = new Set();
  try {
    const { rows: payerPatterns } = await db.query(
      'SELECT payer_name, tenant_id, confirmed_count FROM payer_patterns ORDER BY confirmed_count DESC'
    );
    for (const { payer_name, tenant_id, confirmed_count } of payerPatterns) {
      if (payerPatternMap.has(payer_name)) {
        if (payerPatternMap.get(payer_name).tenant_id !== tenant_id) payerConflicts.add(payer_name);
      } else {
        payerPatternMap.set(payer_name, { tenant_id, confirmed_count });
      }
    }
  } catch {} // payer_patterns table may not exist yet

  // Build payer_amount patternMap (payer_name + amount_bucket → tenant)
  const payerAmountPatternMap = new Map(); // payer_name → [{amount_bucket, tenant_id, confirmed_count}]
  try {
    const { rows: payerAmtPatterns } = await db.query(
      'SELECT payer_name, amount_bucket, tenant_id, confirmed_count FROM payer_amount_patterns ORDER BY confirmed_count DESC'
    );
    for (const { payer_name, amount_bucket, tenant_id, confirmed_count } of payerAmtPatterns) {
      if (!payerAmountPatternMap.has(payer_name)) payerAmountPatternMap.set(payer_name, []);
      payerAmountPatternMap.get(payer_name).push({ amount_bucket: parseFloat(amount_bucket), tenant_id, confirmed_count });
    }
  } catch {} // payer_amount_patterns table may not exist yet

  const { rows: transactions } = await db.query(`
    SELECT id, amount, description, date FROM transactions
    WHERE type = 'income' AND tenant_id IS NULL
  `);

  let cPattern = 0, cExact = 0, cAmountOnly = 0, cAmbiguous = 0, cNone = 0;

  for (const tx of transactions) {
    const result = matchTransaction(tx, tenants, patternMap, patternConflicts, aliasMap, payerPatternMap, payerConflicts, payerAmountPatternMap);
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

    // Auto-learn from name matches
    if ((result.matched_by === 'name' || result.matched_by === 'name_amount') && result.tenant_id) {
      await learnPattern(tx.id, result.tenant_id, tx.description);
    }

    if (result.matched_by === 'pattern' || result.matched_by === 'pattern_medium' || result.matched_by === 'payer_name' || result.matched_by === 'payer_amount') cPattern++;
    else if (result.match_confidence === 'exact')       cExact++;
    else if (result.match_confidence === 'amount_only') cAmountOnly++;
    else if (result.match_confidence === 'ambiguous')   cAmbiguous++;
    else                                                cNone++;
  }

  const matched = cPattern + cExact + cAmountOnly;
  console.log(`[matcher] pattern/payer=${cPattern}, exact=${cExact}, amount_only=${cAmountOnly}, ambiguous=${cAmbiguous}, none=${cNone}`);
  return { pattern: cPattern, exact: cExact, amount_only: cAmountOnly, partial: 0, ambiguous: cAmbiguous, none: cNone, total: transactions.length, matched };
}

module.exports = { autoMatchAll, matchTransaction, learnPattern, extractKeywords };
