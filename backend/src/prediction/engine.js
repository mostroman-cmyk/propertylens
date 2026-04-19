const db = require('../db/db');

// ── Normalization ─────────────────────────────────────────────────────────────

const STRIP_PREFIXES = [
  /^ZELLE\s+(PYMT|PAYMENT|PMT)?\s*(FROM|TO)\s+/,
  /^VENMO\s+/,
  /^CASH\s*APP\s+/,
  /^DEPOSIT\s+FROM\s+/,
  /^ONLINE\s+(TRANSFER|PAYMENT|PMT)\s+(FROM\s+)?/,
  /^ACH\s+(DEBIT|CREDIT|TRANSFER|TRNSFR|PMT|WITHDRAWAL|DEPOSIT)\s*/,
  /^ELECTRONIC\s+(WITHDRAWAL|PAYMENT|DEBIT|CREDIT)\s+/,
  /^(MOBILE|REMOTE)\s+(DEPOSIT|PAYMENT|CHECK\s+DEPOSIT)\s*/,
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
  /^PAYMENT\s+(FROM|TO)\s+/,
  /^BILL\s+PAYMENT\s+(TO\s+)?/,
];

function normalizeDescription(text) {
  if (!text) return '';
  let s = text.toUpperCase().trim();

  // Strip known transaction prefixes (repeat until stable)
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of STRIP_PREFIXES) {
      const next = s.replace(p, '');
      if (next !== s) { s = next.trim(); changed = true; break; }
    }
  }

  // Strip bill-pay / payment-method infixes
  s = s.replace(/\s+WEB\s+BILL\s+PAY\b/g, '');
  s = s.replace(/\s+BILL\s+PAY(MENT)?\b/g, '');
  s = s.replace(/\s+ONLINE\s+PMT\b/g, '');
  s = s.replace(/\s+ONLINE\s+PAYMENT\b/g, '');

  // Strip store / branch numbers:  #0712  STR 123  LOC 456
  s = s.replace(/\s*#\s*\d+/g, '');
  s = s.replace(/\s+\b(STR|LOC|STORE|BRANCH|UNIT|NO|NUM)\s*[\s#]*\d+/g, '');

  // Strip ISO dates  2026-04-15
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');

  // Strip US-style dates  04/15  04/15/26  04/15/2026
  s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '');

  // Strip short dashed dates  4-15  04-15
  s = s.replace(/\b\d{1,2}-\d{2}\b/g, '');

  // Strip month-name dates  APR15  APR 15  APR 2026
  s = s.replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{1,4}\b/g, '');

  // Strip 4-8 digit standalone codes (date codes like 041526, txn IDs)
  s = s.replace(/\b\d{4,8}\b/g, '');

  // Strip reference tags:  REF123  CONF456  AUTH ABC123
  s = s.replace(/\b(REF|CONF|TRACE|AUTH|SEQ|TXN|TRANS|ID|CHECK|CHK|MEMO|INVOICE)\s*[#:\s]?\s*[A-Z0-9]{3,}\b/g, '');

  // Strip trailing US state abbrev + optional ZIP:  " CA 92011"
  s = s.replace(/\s+\b[A-Z]{2}\b(\s+\d{5}(-\d{4})?)?\s*$/g, '');

  // Strip standalone ZIP codes
  s = s.replace(/\b\d{5}(-\d{4})?\b/g, '');

  // Replace punctuation noise with space
  s = s.replace(/[*.,\-_/\\|@]+/g, ' ');

  // Collapse whitespace
  return s.replace(/\s+/g, ' ').trim();
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

// Tiers: each is checked in order; first one that satisfies constraints wins.
const TIERS = [
  { minSim: 0.90, minVotes: 3, confidence: 'HIGH' },
  { minSim: 0.80, minVotes: 2, confidence: 'MEDIUM' },
  { minSim: 1.00, minVotes: 1, confidence: 'MEDIUM' }, // perfect normalized match
  { minSim: 0.70, minVotes: 1, confidence: 'LOW' },
];

function predictFuzzy(norm, candidates) {
  // candidates: array of training rows with .similarity pre-computed
  if (candidates.length === 0) return null;

  for (const { minSim, minVotes, confidence } of TIERS) {
    const matches = candidates.filter(c => c.similarity >= minSim);
    if (matches.length < minVotes) continue;

    // Vote on category
    const catVote = topVote(matches, 'category');
    if (!catVote || catVote.count < minVotes) continue;

    const agreers = matches.filter(c => c.category === catVote.value);

    // Vote on property (majority among agreers)
    const propVote = topVote(agreers.filter(c => c.property_id), 'property_id');

    // Vote on tenant — only assign if unanimous among agreers that have a tenant
    const withTenant = agreers.filter(c => c.tenant_id);
    const tenantVote = topVote(withTenant, 'tenant_id');
    const unanimousTenant = tenantVote && withTenant.every(c => String(c.tenant_id) === tenantVote.value);

    // Vote on scope — majority wins
    const portfolioCount = agreers.filter(c => c.property_scope === 'portfolio').length;
    const predictedScope = portfolioCount > agreers.length / 2 ? 'portfolio' : null;

    // Build reasoning
    const sampleNorm = matches[0].normalized_description || norm;
    const agreeNote = catVote.count < matches.length ? ` (${catVote.count}/${matches.length} agree)` : '';
    const tenantNote = !unanimousTenant && withTenant.length > 0 ? ' — tenant differs, left blank' : '';
    const reasoning = `${matches.length} similar transaction${matches.length !== 1 ? 's' : ''} ("${sampleNorm}") → ${catVote.value}${agreeNote}${tenantNote}`;

    return {
      predicted_category: catVote.value,
      predicted_property_id: predictedScope === 'portfolio' ? null : (propVote ? parseInt(propVote.value) : null),
      predicted_property_scope: predictedScope,
      predicted_tenant_id: unanimousTenant ? parseInt(tenantVote.value) : null,
      prediction_confidence: confidence,
      prediction_reasoning: reasoning,
    };
  }

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

  // Keyword rules
  for (const rule of rules) {
    if (tx.description.toUpperCase().includes(rule.keyword.toUpperCase())) {
      return {
        predicted_category: rule.category,
        predicted_property_id: null,
        predicted_property_scope: rule.property_scope === 'portfolio' ? 'portfolio' : null,
        predicted_tenant_id: null,
        prediction_confidence: 'MEDIUM',
        prediction_reasoning: `Matches keyword rule "${rule.keyword}"`,
      };
    }
  }

  // Exact rent amount → unique tenant
  if (tx.type === 'income' && amount > 0) {
    const matchingTenants = tenants.filter(t => Math.abs(parseFloat(t.monthly_rent) - amount) < 0.01);
    if (matchingTenants.length === 1) {
      const t = matchingTenants[0];
      return {
        predicted_category: 'rent',
        predicted_property_id: t.property_id,
        predicted_property_scope: null,
        predicted_tenant_id: t.id,
        prediction_confidence: 'HIGH',
        prediction_reasoning: `Amount $${amount} matches ${t.name}'s rent of $${t.monthly_rent}`,
      };
    }
  }

  // Merchant name match (3+ transactions agree)
  const merchantMatches = sameType.filter(c => extractMerchant(c.description) === merchant && merchant.length > 2);
  if (merchantMatches.length >= 3) {
    const catVote = topVote(merchantMatches, 'category');
    if (catVote && catVote.count >= 3) {
      const agreers = merchantMatches.filter(c => c.category === catVote.value);
      const propVote = topVote(agreers.filter(c => c.property_id), 'property_id');
      const portfolioCount = agreers.filter(c => c.property_scope === 'portfolio').length;
      const scope = portfolioCount >= 3 ? 'portfolio' : null;
      return {
        predicted_category: catVote.value,
        predicted_property_id: scope === 'portfolio' ? null : (propVote ? parseInt(propVote.value) : null),
        predicted_property_scope: scope,
        predicted_tenant_id: null,
        prediction_confidence: catVote.count >= 5 ? 'HIGH' : 'MEDIUM',
        prediction_reasoning: `${catVote.count} "${merchant}" transactions classified as ${catVote.value}`,
      };
    }
  }

  // Recurring pattern: same merchant, similar amount, 2+ occurrences
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
          predicted_category: catVote.value,
          predicted_property_id: null,
          predicted_property_scope: null,
          predicted_tenant_id: null,
          prediction_confidence: 'MEDIUM',
          prediction_reasoning: `Recurring "${merchant}" ~$${txAmt.toFixed(0)} previously "${catVote.value}"`,
        };
      }
    }
  }

  return null;
}

// ── Main predictAll ───────────────────────────────────────────────────────────

async function predictAll() {
  // Ensure all transactions have a normalized_description
  const { rows: missing } = await db.query(
    'SELECT id, description FROM transactions WHERE normalized_description IS NULL'
  );
  for (const row of missing) {
    await db.query('UPDATE transactions SET normalized_description=$1 WHERE id=$2',
      [normalizeDescription(row.description), row.id]);
  }

  const { rows: training } = await db.query(`
    SELECT id, description, normalized_description, amount, type, category, property_id, tenant_id, property_scope
    FROM transactions
    WHERE category NOT IN ('Other', 'Other Income')
      AND normalized_description IS NOT NULL
  `);

  const { rows: uncategorized } = await db.query(`
    SELECT id, description, normalized_description, amount, type, category
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

  // Build type + first-word index for fast candidate retrieval
  const typeIndex = {};
  for (const row of training) {
    const type = row.type || 'expense';
    if (!typeIndex[type]) typeIndex[type] = {};
    const words = (row.normalized_description || '').split(/\s+/).filter(w => w.length > 2);
    const fw = words[0];
    if (!fw) continue;
    if (!typeIndex[type][fw]) typeIndex[type][fw] = [];
    typeIndex[type][fw].push(row);
  }

  // Clear stale predictions
  await db.query(`
    UPDATE transactions
    SET predicted_category=NULL, predicted_property_id=NULL, predicted_tenant_id=NULL,
        prediction_confidence=NULL, prediction_reasoning=NULL, predicted_property_scope=NULL
    WHERE category IN ('Other', 'Other Income')
      AND (prediction_accepted IS NULL OR prediction_accepted = false)
  `);

  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, none: 0 };

  for (const tx of uncategorized) {
    const norm = tx.normalized_description || normalizeDescription(tx.description);
    const words = norm.split(/\s+/).filter(w => w.length > 2);
    const fw = words[0];

    // Get candidates: first-word bucket for same type, expand if too few
    const bucket = (typeIndex[tx.type] || {})[fw] || [];
    const candidates = bucket.length >= 3
      ? bucket
      : training.filter(r => r.type === tx.type);

    // Score by Jaccard and filter to ≥ 0.70
    const scored = candidates
      .map(c => ({ ...c, similarity: jaccardSimilarity(norm, c.normalized_description || '') }))
      .filter(c => c.similarity >= 0.70)
      .sort((a, b) => b.similarity - a.similarity);

    const pred = predictFuzzy(norm, scored) || predictFallback(tx, training, rules, tenants);

    if (!pred) { counts.none++; continue; }

    counts[pred.prediction_confidence] = (counts[pred.prediction_confidence] || 0) + 1;

    await db.query(`
      UPDATE transactions
      SET predicted_category=$1, predicted_property_id=$2, predicted_tenant_id=$3,
          prediction_confidence=$4, prediction_reasoning=$5, predicted_property_scope=$6
      WHERE id=$7
    `, [
      pred.predicted_category,
      pred.predicted_property_id ?? null,
      pred.predicted_tenant_id ?? null,
      pred.prediction_confidence,
      pred.prediction_reasoning,
      pred.predicted_property_scope ?? null,
      tx.id,
    ]);
  }

  console.log(`[predict] ${uncategorized.length} uncategorized → ${JSON.stringify(counts)}`);
  return {
    predicted: uncategorized.length - counts.none,
    total: uncategorized.length,
    counts: { HIGH: counts.HIGH || 0, MEDIUM: counts.MEDIUM || 0, LOW: counts.LOW || 0 },
  };
}

module.exports = { predictAll, normalizeDescription };
