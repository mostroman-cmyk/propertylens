const db = require('../db/db');

// ── Normalization ─────────────────────────────────────────────────────────────

const STRIP_PREFIXES = [
  /^ZELLE\s+(PAYMENT|PYMT|PMT)?\s*(FROM|TO)\s+/,
  /^ZELLE\s+(FROM|TO)\s+/,
  /^VENMO\s+(PAYMENT|PYMT|PMT)?\s*(FROM|TO)\s+/,
  /^VENMO\s+(FROM|TO)\s+/,
  /^CASH\s*APP\s+(PAYMENT|PYMT|PMT)?\s*(FROM|TO)\s+/,
  /^CASH\s*APP\s+(FROM|TO)\s+/,
  /^WIRE\s+(TRANSFER\s+)?(FROM|TO)\s+/,
  /^WIRE\s+(FROM|TO)\s+/,
  /^ACH\s+(TRANSFER\s+)?(FROM|TO)\s+/,
  /^ACH\s+(FROM|TO)\s+/,
  /^DEPOSIT\s+FROM\s+/,
  /^TRANSFER\s+FROM\s+/,
  /^ONLINE\s+TRANSFER\s+FROM\s+/,
  /^MOBILE\s+DEPOSIT\s+(FROM\s+)?/,
  /^EXTERNAL\s+TRANSFER\s+FROM\s+/,
  /^PAYMENT\s+(FROM|TO)\s+/,
  /^ONLINE\s+(TRANSFER|PAYMENT|PMT)\s+(FROM\s+)?/,
  /^ACH\s+(DEBIT|CREDIT|TRANSFER|TRNSFR|PMT|WITHDRAWAL|DEPOSIT)\s*/,
  /^ELECTRONIC\s+(WITHDRAWAL|PAYMENT|DEBIT|CREDIT)\s+/,
  /^DIRECT\s+(DEPOSIT|DEBIT|PAYMENT)\s+/,
  /^RECURRING\s+(CHARGE|PAYMENT|PMT)\s+/,
  /^PURCHASE\s+(AT|FROM|FOR)?\s*/,
  /^(CHECKCARD|CHECK\s+CARD)\s+/,
  /^DEBIT\s+CARD\s+(PURCHASE\s+)?/,
  /^POS\s+(PURCHASE\s+|DEBIT\s+)?/,
  /^SQ\s*\*/,
  /^TST\s*\*/,
  /^PP\s*\*/,
  /^PAYPAL\s*\*/,
  /^BILL\s+PAYMENT\s+(TO\s+)?/,
];

// Payment-rail prefixes used by extractSenderName (order matters — longest first)
const SENDER_PREFIXES = [
  /^ZELLE\s+PAYMENT\s+FROM\s+/,
  /^ZELLE\s+PAYMENT\s+TO\s+/,
  /^ZELLE\s+FROM\s+/,
  /^ZELLE\s+TO\s+/,
  /^VENMO\s+PAYMENT\s+FROM\s+/,
  /^VENMO\s+PAYMENT\s+TO\s+/,
  /^VENMO\s+FROM\s+/,
  /^VENMO\s+TO\s+/,
  /^CASH\s*APP\s+PAYMENT\s+FROM\s+/,
  /^CASH\s*APP\s+PAYMENT\s+TO\s+/,
  /^CASH\s*APP\s+FROM\s+/,
  /^CASH\s*APP\s+TO\s+/,
  /^WIRE\s+TRANSFER\s+FROM\s+/,
  /^WIRE\s+FROM\s+/,
  /^ACH\s+TRANSFER\s+FROM\s+/,
  /^ACH\s+FROM\s+/,
  /^DEPOSIT\s+FROM\s+/,
  /^TRANSFER\s+FROM\s+/,
  /^ONLINE\s+TRANSFER\s+FROM\s+/,
  /^MOBILE\s+DEPOSIT\s+FROM\s+/,
  /^EXTERNAL\s+TRANSFER\s+FROM\s+/,
];

// Strip trailing noise from a string already stripped of its prefix.
// Used by both normalizeDescription and extractSenderName.
function stripTrailingNoise(s) {
  // CRITICAL: strip CONF/REF/etc. keyword + following alphanumeric ID *before* stripping bare #\d+
  // so "CONF# 12345" and "CONF# 0JJSH2XGH" both become empty rather than leaving "CONF" orphaned.
  s = s.replace(/\b(CONF|CONFIRMATION|REF|REFERENCE|TRANS|TRANSACTION|TRACE|AUTH|SEQ|TXN|ID|CHECK|CHK|MEMO|INVOICE|ORDER|ACCT|ACCOUNT)\s*[#:\-]?\s*[A-Z0-9]+/g, '');
  // Strip any remaining # + alphanumeric patterns
  s = s.replace(/\s*#\s*[A-Z0-9]+/g, '');
  // Strip store/branch/unit numbers
  s = s.replace(/\s+\b(STR|LOC|STORE|BRANCH|UNIT|NO|NUM)\s*[\s#]*\d+/g, '');
  // Strip dates
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
  s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '');
  s = s.replace(/\b\d{1,2}-\d{2}\b/g, '');
  s = s.replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{1,4}\b/g, '');
  // Strip standalone numbers (4-8 digits)
  s = s.replace(/\b\d{4,8}\b/g, '');
  // Strip long alphanumeric IDs: 10+ chars containing BOTH letters and digits
  s = s.replace(/\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{10,}\b/g, '');
  return s;
}

function normalizeDescription(text) {
  if (!text) return '';
  let s = text.toUpperCase().trim();

  // Strip payment-rail and other known prefixes (loop until stable)
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of STRIP_PREFIXES) {
      const next = s.replace(p, '');
      if (next !== s) { s = next.trim(); changed = true; break; }
    }
  }

  s = s.replace(/\s+WEB\s+BILL\s+PAY\b/g, '');
  s = s.replace(/\s+BILL\s+PAY(MENT)?\b/g, '');
  s = s.replace(/\s+ONLINE\s+PMT\b/g, '');
  s = s.replace(/\s+ONLINE\s+PAYMENT\b/g, '');

  s = stripTrailingNoise(s);

  s = s.replace(/[*.,\-_/\\|@]+/g, ' ');

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Human-readable display description — strips card prefixes, account mask noise,
 * confirmation numbers, and state/ZIP suffixes. Keeps original casing.
 * Stored in the DB so cleanup runs once per transaction, not per render.
 *
 * "CHECKCARD 0927 PADRE DAM MUNICIPAL WAT CA XXXXX2952XXXXXXXXXX0892"
 *   → "PADRE DAM MUNICIPAL WAT"
 * "Zelle payment from BAILEY ANDREW for 'NOVEMBER'; Conf# T0ZFYT8WH"
 *   → "Zelle payment from BAILEY ANDREW for NOVEMBER"
 */
function computeDisplayDescription(description) {
  if (!description) return '';
  let s = description;

  // Strip leading card-type prefixes with 4-digit card number
  s = s.replace(/^(?:CHECKCARD|CHECK\s+CARD)\s+\d{4}\s+/i, '');
  s = s.replace(/^DEBIT\s+CARD(?:\s+PURCHASE)?\s+\d{4}\s+/i, '');
  s = s.replace(/^POS(?:\s+(?:PURCHASE|DEBIT))?\s+\d{4}\s+/i, '');

  // Strip trailing account masking patterns (runs of X's and digits, 8+ chars)
  s = s.replace(/\s+[X\d]{8,}\s*$/i, '');

  // Strip trailing US state abbreviation (+ optional ZIP)
  s = s.replace(/\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?\s*$/i, '');

  // Strip confirmation / reference numbers (case-insensitive, any separator)
  s = s.replace(/[;,]?\s*\b(?:conf(?:irmation)?|ref(?:erence)?|trans(?:action)?\s*id)\b\s*#?\s*[A-Z0-9]{3,}/gi, '');

  // Strip surrounding quotes
  s = s.replace(/[''""]/g, '');

  // Strip trailing punctuation and whitespace
  s = s.replace(/[;,\s]+$/, '');

  return s.replace(/\s+/g, ' ').trim() || description;
}

/**
 * Extract the human/business sender name from a payment-rail description.
 * Returns null when the description does not start with a recognized payment-rail prefix
 * (so non-payment transactions are not falsely labelled with a payer_name).
 *
 * "Zelle payment from Baily Andrew Conf# 0JJSH2XGH 04/15" → "BAILY ANDREW"
 */
function extractSenderName(description) {
  if (!description) return null;
  let s = description.toUpperCase().trim();

  let found = false;
  for (const p of SENDER_PREFIXES) {
    const next = s.replace(p, '');
    if (next !== s) { s = next.trim(); found = true; break; }
  }
  if (!found) return null;

  s = stripTrailingNoise(s);
  s = s.replace(/[*.,\-_/\\|@]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  return s.length >= 2 ? s : null;
}

// ── Similarity ────────────────────────────────────────────────────────────────

function tokenSet(s) {
  return new Set((s || '').split(/\s+/).filter(w => w.length > 1));
}

function jaccardSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  return intersection / (sa.size + sb.size - intersection);
}

// ── Voting helpers ────────────────────────────────────────────────────────────

function topVote(arr, key) {
  const counts = {};
  for (const item of arr) {
    const v = item[key];
    if (v != null) counts[String(v)] = (counts[String(v)] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  return sorted.length ? { value: sorted[0][0], count: sorted[0][1], total: arr.length } : null;
}

// ── Fuzzy prediction from scored candidates ───────────────────────────────────

const TIERS = [
  { minSim: 0.80, minMatches: 5, minAgreePct: 0.80, confidence: 'HIGH' },
  { minSim: 0.80, minMatches: 3, minAgreePct: 0.75, confidence: 'MEDIUM' },
  { minSim: 1.00, minMatches: 1, minAgreePct: 1.00, confidence: 'MEDIUM' },
  { minSim: 0.70, minMatches: 2, minAgreePct: 1.00, confidence: 'LOW' },
];

function predictFuzzy(norm, candidates) {
  if (candidates.length === 0) return null;

  for (const { minSim, minMatches, minAgreePct, confidence } of TIERS) {
    const matches = candidates.filter(c => c.similarity >= minSim);
    if (matches.length < minMatches) continue;

    const catVote = topVote(matches, 'category');
    if (!catVote) continue;

    const agreePct = catVote.count / matches.length;
    if (agreePct < minAgreePct) continue;

    const agreers = matches.filter(c => c.category === catVote.value);

    const propVote = topVote(agreers.filter(c => c.property_id), 'property_id');
    const withTenant = agreers.filter(c => c.tenant_id);
    const tenantVote = topVote(withTenant, 'tenant_id');
    const unanimousTenant = tenantVote && withTenant.every(c => String(c.tenant_id) === tenantVote.value);

    const portfolioCount = agreers.filter(c => c.property_scope === 'portfolio').length;
    const predictedScope = portfolioCount > agreers.length / 2 ? 'portfolio' : null;

    const sampleNorm = matches[0].normalized_description || norm;
    const agreeLabel = catVote.count === matches.length
      ? `All ${matches.length}`
      : `${catVote.count}/${matches.length}`;
    const scopeNote = predictedScope === 'portfolio'
      ? ', portfolio scope'
      : (propVote ? `, property: ${propVote.value}` : '');
    const tenantNote = !unanimousTenant && withTenant.length > 0
      ? ` — tenant differs across samples, left blank`
      : (unanimousTenant ? `, tenant: ${tenantVote.value}` : '');
    const reasoning =
      `${matches.length} similar transaction${matches.length !== 1 ? 's' : ''} matched ("${sampleNorm}"). ` +
      `${agreeLabel} are categorized as ${catVote.value}${scopeNote}${tenantNote}. ` +
      `Predicting ${catVote.value} with ${confidence} confidence.`;

    const examples = matches.slice(0, 5).map(c => ({
      description: c.description,
      normalized:  c.normalized_description,
      category:    c.category,
      property_id: c.property_id,
      tenant_id:   c.tenant_id,
      similarity:  Math.round(c.similarity * 100),
    }));

    return {
      predicted_category:       catVote.value,
      predicted_property_id:    predictedScope === 'portfolio' ? null : (propVote ? parseInt(propVote.value) : null),
      predicted_property_scope: predictedScope,
      predicted_tenant_id:      unanimousTenant ? parseInt(tenantVote.value) : null,
      prediction_confidence:    confidence,
      prediction_reasoning:     reasoning,
      prediction_examples:      JSON.stringify(examples),
    };
  }

  return null;
}

// ── Payer-name prediction (income transactions with payment-rail sender) ───────

function amountMatchesTolerance(txAmt, storedBucket) {
  const abs = Math.abs(txAmt);
  const tol = abs > 500
    ? Math.min(5, abs * 0.01)
    : Math.min(2, abs * 0.02);
  return Math.abs(abs - storedBucket) <= tol;
}

function predictByPayerName(txId, amount, payerName, payerPatternMap, payerAmountMap, payerHistoryMap, tenants) {
  if (!payerName) return null;

  const txAmt = Math.abs(parseFloat(amount));
  const amtStr = `$${txAmt.toLocaleString()}`;

  // 1. Check amount-specific patterns (payer_name + amount_bucket → tenant)
  const amountPatterns = payerAmountMap.get(payerName) || [];
  if (amountPatterns.length > 0) {
    const matchingAmt = amountPatterns.filter(p => amountMatchesTolerance(txAmt, p.amount_bucket));

    if (matchingAmt.length > 0) {
      const uniqueTenants = [...new Set(matchingAmt.map(p => p.tenant_id).filter(Boolean))];
      const totalCount = matchingAmt.reduce((s, p) => s + p.confirmed_count, 0);
      if (uniqueTenants.length === 1) {
        const tid = uniqueTenants[0];
        const tenant = tenants.find(t => t.id === tid);
        console.log(`[predict] Transaction ${txId}: payer='${payerName}', amount=${amtStr} — amount-specific pattern ~$${matchingAmt[0].amount_bucket} → ${tenant?.name || tid} (${totalCount} confirmed) — HIGH`);
        return {
          predicted_category:       'rent',
          predicted_property_id:    tenant?.property_id || null,
          predicted_property_scope: null,
          predicted_tenant_id:      tid,
          prediction_confidence:    'HIGH',
          prediction_reasoning:     `Payer "${payerName}" at ~${amtStr} confirmed ${totalCount} time(s) as ${tenant?.name || tid}`,
          prediction_examples:      null,
        };
      }
      console.log(`[predict] Transaction ${txId}: payer='${payerName}', amount=${amtStr} — conflicting amount-specific patterns — predicting rent, no tenant`);
      return {
        predicted_category:       'rent',
        predicted_property_id:    null,
        predicted_property_scope: null,
        predicted_tenant_id:      null,
        prediction_confidence:    'MEDIUM',
        prediction_reasoning:     `Payer "${payerName}" at ~${amtStr} has conflicting patterns`,
        prediction_examples:      null,
      };
    }

    // Payer has amount patterns but none match this amount
    const allAmtTenants = [...new Set(amountPatterns.map(p => p.tenant_id).filter(Boolean))];
    if (allAmtTenants.length === 1) {
      // All known amounts go to same tenant — likely a rent increase, still predict
      const tid = allAmtTenants[0];
      const tenant = tenants.find(t => t.id === tid);
      const knownAmts = amountPatterns.map(p => `$${p.amount_bucket}`).join(', ');
      console.log(`[predict] Transaction ${txId}: payer='${payerName}', amount=${amtStr} — no amt match but payer always → ${tenant?.name || tid} — MEDIUM`);
      return {
        predicted_category:       'rent',
        predicted_property_id:    tenant?.property_id || null,
        predicted_property_scope: null,
        predicted_tenant_id:      tid,
        prediction_confidence:    'MEDIUM',
        prediction_reasoning:     `Payer "${payerName}" always pays ${tenant?.name || tid} (known amounts: ${knownAmts}); ${amtStr} is a new amount`,
        prediction_examples:      null,
      };
    }

    if (allAmtTenants.length > 1) {
      // NEVER predict tenant when payer maps to different tenants at different amounts
      const amtMappings = amountPatterns.map(p => {
        const t = tenants.find(t => t.id === p.tenant_id);
        return `$${p.amount_bucket}→${t?.name || p.tenant_id}`;
      }).join('; ');
      console.log(`[predict] Transaction ${txId}: payer='${payerName}', amount=${amtStr} — amount-specific conflict [${amtMappings}] — no tenant prediction`);
      return {
        predicted_category:       'rent',
        predicted_property_id:    null,
        predicted_property_scope: null,
        predicted_tenant_id:      null,
        prediction_confidence:    'MEDIUM',
        prediction_reasoning:     `Payer "${payerName}" sends different amounts to different tenants: ${amtMappings}. Amount ${amtStr} not recognized — tenant unclear`,
        prediction_examples:      null,
      };
    }
  }

  // 2. Check confirmed payer_patterns (non-amount-specific legacy patterns)
  const patterns = payerPatternMap.get(payerName) || [];
  if (patterns.length > 0) {
    const uniqueTenants = [...new Set(patterns.map(p => p.tenant_id))];
    const totalCount = patterns.reduce((s, p) => s + p.confirmed_count, 0);
    if (uniqueTenants.length === 1) {
      const tid = uniqueTenants[0];
      const tenant = tenants.find(t => t.id === tid);
      console.log(`[predict] Transaction ${txId}: payer='${payerName}', amount=${amtStr} — payer_patterns → ${tenant?.name || tid} (${totalCount} confirmed) — HIGH`);
      return {
        predicted_category:       'rent',
        predicted_property_id:    tenant?.property_id || null,
        predicted_property_scope: null,
        predicted_tenant_id:      tid,
        prediction_confidence:    'HIGH',
        prediction_reasoning:     `Payer "${payerName}" confirmed ${totalCount} time(s) as ${tenant?.name || tid}`,
        prediction_examples:      null,
      };
    }
    console.log(`[predict] Transaction ${txId}: payer='${payerName}', amount=${amtStr} — payer_patterns conflict — predicting rent, no tenant`);
    return {
      predicted_category:       'rent',
      predicted_property_id:    null,
      predicted_property_scope: null,
      predicted_tenant_id:      null,
      prediction_confidence:    'MEDIUM',
      prediction_reasoning:     `Payer "${payerName}" has confirmed history as rent but across multiple tenants`,
      prediction_examples:      null,
    };
  }

  // 3. Check transaction history for this payer
  const history = payerHistoryMap.get(payerName) || [];
  if (history.length >= 1) {
    const catVote = topVote(history, 'category');
    if (!catVote || catVote.count / history.length < 0.80) {
      console.log(`[predict] Transaction ${txId}: payer='${payerName}', amount=${amtStr} — ${history.length} past tx(s) but no majority category`);
      return null;
    }
    const agreers = history.filter(h => h.category === catVote.value);
    const withTenant = agreers.filter(h => h.tenant_id);
    const tenantVote = topVote(withTenant, 'tenant_id');
    const unanimousTenant = tenantVote && withTenant.every(h => String(h.tenant_id) === tenantVote.value);
    const propVote = topVote(agreers.filter(h => h.property_id), 'property_id');

    const tid = unanimousTenant ? parseInt(tenantVote.value) : null;
    const tenant = tid ? tenants.find(t => t.id === tid) : null;

    console.log(
      `[predict] Transaction ${txId}: payer='${payerName}', amount=${amtStr} — ` +
      `${history.length} past tx(s), ${catVote.count}/${history.length} as ${catVote.value}` +
      (unanimousTenant ? ` for ${tenant?.name || tid}` : '') +
      ` — ${history.length >= 3 ? 'HIGH' : 'MEDIUM'}`
    );

    return {
      predicted_category:       catVote.value,
      predicted_property_id:    propVote ? parseInt(propVote.value) : null,
      predicted_property_scope: null,
      predicted_tenant_id:      tid,
      prediction_confidence:    history.length >= 3 ? 'HIGH' : 'MEDIUM',
      prediction_reasoning:     `${history.length} past transaction(s) from payer "${payerName}", ${catVote.count}/${history.length} categorized as ${catVote.value}${unanimousTenant && tenant ? ` — tenant: ${tenant.name}` : ''}`,
      prediction_examples:      null,
    };
  }

  console.log(`[predict] Transaction ${txId}: payer='${payerName}', amount=${amtStr} — no payer history — falling back to fuzzy similarity`);
  return null;
}

// ── Fallback strategies (non-fuzzy) ──────────────────────────────────────────

function extractMerchant(desc) {
  const norm = normalizeDescription(desc);
  const words = norm.split(/\s+/).filter(w => w.length > 1 && !/^\d+$/.test(w));
  return words.slice(0, 2).join(' ') || norm.slice(0, 20);
}

function predictFallback(tx, training, rules, tenants) {
  const amount = parseFloat(tx.amount);
  const merchant = extractMerchant(tx.description);
  const sameType = training.filter(c => c.type === tx.type);

  for (const rule of rules) {
    if (tx.description.toUpperCase().includes(rule.keyword.toUpperCase())) {
      return {
        predicted_category:       rule.category,
        predicted_property_id:    null,
        predicted_property_scope: rule.property_scope === 'portfolio' ? 'portfolio' : null,
        predicted_tenant_id:      null,
        prediction_confidence:    'MEDIUM',
        prediction_reasoning:     `Matches keyword rule "${rule.keyword}"`,
        prediction_examples:      null,
      };
    }
  }

  if (tx.type === 'income' && amount > 0) {
    const matchingTenants = tenants.filter(t => Math.abs(parseFloat(t.monthly_rent) - amount) < 0.01);
    if (matchingTenants.length === 1) {
      const t = matchingTenants[0];
      return {
        predicted_category:       'rent',
        predicted_property_id:    t.property_id,
        predicted_property_scope: null,
        predicted_tenant_id:      t.id,
        prediction_confidence:    'HIGH',
        prediction_reasoning:     `Amount $${amount} matches ${t.name}'s rent of $${t.monthly_rent}`,
        prediction_examples:      null,
      };
    }
  }

  const merchantMatches = sameType.filter(c => extractMerchant(c.description) === merchant && merchant.length > 2);
  if (merchantMatches.length >= 3) {
    const catVote = topVote(merchantMatches, 'category');
    if (catVote && catVote.count >= 3) {
      const agreers = merchantMatches.filter(c => c.category === catVote.value);
      const propVote = topVote(agreers.filter(c => c.property_id), 'property_id');
      const portfolioCount = agreers.filter(c => c.property_scope === 'portfolio').length;
      const scope = portfolioCount >= 3 ? 'portfolio' : null;
      return {
        predicted_category:       catVote.value,
        predicted_property_id:    scope === 'portfolio' ? null : (propVote ? parseInt(propVote.value) : null),
        predicted_property_scope: scope,
        predicted_tenant_id:      null,
        prediction_confidence:    catVote.count >= 5 ? 'HIGH' : 'MEDIUM',
        prediction_reasoning:     `${catVote.count} "${merchant}" transactions classified as ${catVote.value}`,
        prediction_examples:      null,
      };
    }
  }

  const txAmt = Math.abs(amount);
  if (txAmt > 0) {
    const recurring = sameType.filter(c => {
      const cAmt = Math.abs(parseFloat(c.amount));
      return cAmt > 0 && extractMerchant(c.description) === merchant &&
        Math.abs(cAmt - txAmt) / txAmt <= 0.05;
    });
    if (recurring.length >= 2) {
      const catVote = topVote(recurring, 'category');
      if (catVote) {
        return {
          predicted_category:       catVote.value,
          predicted_property_id:    null,
          predicted_property_scope: null,
          predicted_tenant_id:      null,
          prediction_confidence:    'MEDIUM',
          prediction_reasoning:     `Recurring "${merchant}" ~$${txAmt.toFixed(0)} previously "${catVote.value}"`,
          prediction_examples:      null,
        };
      }
    }
  }

  return null;
}

// ── Main predictAll ───────────────────────────────────────────────────────────

async function predictAll() {
  // Ensure all transactions have normalized_description and display_description
  const { rows: missing } = await db.query(
    'SELECT id, description FROM transactions WHERE normalized_description IS NULL OR display_description IS NULL'
  );
  for (const row of missing) {
    await db.query(
      'UPDATE transactions SET normalized_description=COALESCE(normalized_description,$1), display_description=COALESCE(display_description,$2) WHERE id=$3',
      [normalizeDescription(row.description), computeDisplayDescription(row.description), row.id]
    );
  }

  // Ensure income transactions have a payer_name
  const { rows: missingPayer } = await db.query(
    "SELECT id, description FROM transactions WHERE payer_name IS NULL AND type = 'income'"
  );
  for (const row of missingPayer) {
    const pn = extractSenderName(row.description);
    if (pn) {
      await db.query('UPDATE transactions SET payer_name=$1 WHERE id=$2', [pn, row.id]);
    }
  }

  const { rows: training } = await db.query(`
    SELECT id, description, normalized_description, payer_name, amount, type,
           category, property_id, tenant_id, property_scope
    FROM transactions
    WHERE category NOT IN ('Other', 'Other Income')
      AND normalized_description IS NOT NULL
  `);

  const { rows: uncategorized } = await db.query(`
    SELECT id, description, normalized_description, payer_name, amount, type, category
    FROM transactions
    WHERE category IN ('Other', 'Other Income')
      AND (prediction_accepted IS NULL OR prediction_accepted = false)
  `);

  const { rows: rules } = await db.query(
    'SELECT keyword, category, type, priority, property_scope FROM categorization_rules ORDER BY priority DESC'
  );

  const { rows: tenants } = await db.query(
    'SELECT id, name, monthly_rent, property_id FROM tenants'
  );

  // Load confirmed payer patterns (user-validated payer_name → tenant mappings)
  const payerPatternMap = new Map(); // payer_name → [{tenant_id, confirmed_count}]
  try {
    const { rows: payerPatterns } = await db.query(
      'SELECT payer_name, tenant_id, confirmed_count FROM payer_patterns ORDER BY confirmed_count DESC'
    );
    for (const { payer_name, tenant_id, confirmed_count } of payerPatterns) {
      if (!payerPatternMap.has(payer_name)) payerPatternMap.set(payer_name, []);
      payerPatternMap.get(payer_name).push({ tenant_id, confirmed_count });
    }
  } catch {} // Table may not exist on first run

  // Load amount-specific patterns (payer_name + amount_bucket → tenant)
  const payerAmountMap = new Map(); // payer_name → [{amount_bucket, tenant_id, category, confirmed_count}]
  try {
    const { rows: payerAmtPatterns } = await db.query(
      'SELECT payer_name, amount_bucket, tenant_id, category, confirmed_count FROM payer_amount_patterns ORDER BY confirmed_count DESC'
    );
    for (const { payer_name, amount_bucket, tenant_id, category, confirmed_count } of payerAmtPatterns) {
      if (!payerAmountMap.has(payer_name)) payerAmountMap.set(payer_name, []);
      payerAmountMap.get(payer_name).push({ amount_bucket: parseFloat(amount_bucket), tenant_id, category, confirmed_count });
    }
  } catch {} // Table may not exist on first run

  // Build payer history map from already-classified income transactions
  const payerHistoryMap = new Map(); // payer_name → [{tenant_id, category, property_id}]
  for (const row of training) {
    if (row.payer_name && row.type === 'income') {
      if (!payerHistoryMap.has(row.payer_name)) payerHistoryMap.set(row.payer_name, []);
      payerHistoryMap.get(row.payer_name).push({
        tenant_id: row.tenant_id,
        category:  row.category,
        property_id: row.property_id,
      });
    }
  }

  // First-word index for fast Jaccard candidate retrieval
  const typeIndex = {};
  for (const row of training) {
    const type = row.type || 'expense';
    if (!typeIndex[type]) typeIndex[type] = {};
    const words = (row.normalized_description || '').split(/\s+/).filter(w => w.length > 2);
    for (const w of words.slice(0, 2)) {
      if (!typeIndex[type][w]) typeIndex[type][w] = [];
      typeIndex[type][w].push(row);
    }
  }

  // Clear stale predictions
  await db.query(`
    UPDATE transactions
    SET predicted_category=NULL, predicted_property_id=NULL, predicted_tenant_id=NULL,
        prediction_confidence=NULL, prediction_reasoning=NULL, predicted_property_scope=NULL,
        prediction_examples=NULL
    WHERE category IN ('Other', 'Other Income')
      AND (prediction_accepted IS NULL OR prediction_accepted = false)
  `);

  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, none: 0 };

  for (const tx of uncategorized) {
    const norm = tx.normalized_description || normalizeDescription(tx.description);
    const payerName = tx.payer_name || extractSenderName(tx.description);

    let pred = null;

    // Payer-name matching: for income transactions with a recognized payment-rail sender,
    // match against confirmed payer_patterns and transaction history BEFORE fuzzy similarity.
    if (tx.type === 'income' && payerName) {
      pred = predictByPayerName(tx.id, tx.amount, payerName, payerPatternMap, payerAmountMap, payerHistoryMap, tenants);
    }

    // Fall back to Jaccard fuzzy similarity
    if (!pred) {
      const words = norm.split(/\s+/).filter(w => w.length > 2);
      const bucketSet = new Set();
      for (const w of words.slice(0, 2)) {
        for (const r of ((typeIndex[tx.type] || {})[w] || [])) bucketSet.add(r);
      }
      const bucket = [...bucketSet];
      const candidates = bucket.length >= 5
        ? bucket
        : training.filter(r => r.type === tx.type);

      const scored = candidates
        .map(c => ({ ...c, similarity: jaccardSimilarity(norm, c.normalized_description || '') }))
        .filter(c => c.similarity >= 0.70)
        .sort((a, b) => b.similarity - a.similarity);

      pred = predictFuzzy(norm, scored) || predictFallback(tx, training, rules, tenants);
    }

    if (!pred) { counts.none++; continue; }

    counts[pred.prediction_confidence] = (counts[pred.prediction_confidence] || 0) + 1;

    await db.query(`
      UPDATE transactions
      SET predicted_category=$1, predicted_property_id=$2, predicted_tenant_id=$3,
          prediction_confidence=$4, prediction_reasoning=$5, predicted_property_scope=$6,
          prediction_examples=$7
      WHERE id=$8
    `, [
      pred.predicted_category,
      pred.predicted_property_id    ?? null,
      pred.predicted_tenant_id      ?? null,
      pred.prediction_confidence,
      pred.prediction_reasoning,
      pred.predicted_property_scope ?? null,
      pred.prediction_examples      ?? null,
      tx.id,
    ]);
  }

  console.log(`[predict] ${uncategorized.length} uncategorized → ${JSON.stringify(counts)}`);
  return {
    predicted: uncategorized.length - counts.none,
    total:     uncategorized.length,
    counts:    { HIGH: counts.HIGH || 0, MEDIUM: counts.MEDIUM || 0, LOW: counts.LOW || 0 },
  };
}

module.exports = { predictAll, normalizeDescription, computeDisplayDescription, extractSenderName, jaccardSimilarity, amountMatchesTolerance };
