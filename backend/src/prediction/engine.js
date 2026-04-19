const db = require('../db/db');

function normalizeDesc(desc) {
  return desc
    .toUpperCase()
    .replace(/#\s*\d+/g, '')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, '')
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMerchant(desc) {
  const norm = normalizeDesc(desc);
  const words = norm.split(/\s+/).filter(w => w.length > 1 && !/^\d+$/.test(w));
  return words.slice(0, 2).join(' ') || norm.slice(0, 20);
}

function getMostCommon(arr, key) {
  const counts = {};
  for (const item of arr) {
    const val = item[key];
    if (val != null) counts[String(val)] = (counts[String(val)] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  return sorted.length ? { value: sorted[0][0], count: sorted[0][1] } : null;
}

function predictForTransaction(tx, training, rules, tenants) {
  const amount = parseFloat(tx.amount);
  const norm = normalizeDesc(tx.description);
  const merchant = extractMerchant(tx.description);
  const sameType = training.filter(c => c.type === tx.type);

  // Strategy 1: Exact normalized description match
  const exact = sameType.filter(c => normalizeDesc(c.description) === norm);
  if (exact.length >= 1) {
    const top = getMostCommon(exact, 'category');
    if (top) {
      const topRows = exact.filter(c => c.category === top.value);
      const topProp = getMostCommon(topRows.filter(c => c.property_id), 'property_id');
      return {
        predicted_category: top.value,
        predicted_property_id: topProp ? parseInt(topProp.value) : null,
        predicted_tenant_id: null,
        prediction_confidence: 'HIGH',
        prediction_reasoning: `${exact.length} other transaction${exact.length > 1 ? 's' : ''} with same description are "${top.value}"`,
      };
    }
  }

  // Strategy 2: Merchant name match (3+ with same category)
  const merchantMatches = sameType.filter(c => extractMerchant(c.description) === merchant);
  if (merchantMatches.length >= 3) {
    const top = getMostCommon(merchantMatches, 'category');
    if (top) {
      const matchCount = merchantMatches.filter(c => c.category === top.value).length;
      if (matchCount >= 3) {
        const topRows = merchantMatches.filter(c => c.category === top.value);
        const topProp = getMostCommon(topRows.filter(c => c.property_id), 'property_id');
        return {
          predicted_category: top.value,
          predicted_property_id: topProp ? parseInt(topProp.value) : null,
          predicted_tenant_id: null,
          prediction_confidence: matchCount >= 5 ? 'HIGH' : 'MEDIUM',
          prediction_reasoning: `${matchCount} ${merchant} transactions are "${top.value}"`,
        };
      }
    }
  }

  // Strategy 3: Keyword rules (sorted by priority desc already)
  for (const rule of rules) {
    if (tx.description.toUpperCase().includes(rule.keyword.toUpperCase())) {
      return {
        predicted_category: rule.category,
        predicted_property_id: null,
        predicted_tenant_id: null,
        prediction_confidence: 'MEDIUM',
        prediction_reasoning: `Matches keyword rule "${rule.keyword}"`,
      };
    }
  }

  // Strategy 4: Exact rent amount → unique tenant (income only)
  if (tx.type === 'income' && amount > 0) {
    const matchingTenants = tenants.filter(t => Math.abs(parseFloat(t.monthly_rent) - amount) < 0.01);
    if (matchingTenants.length === 1) {
      const t = matchingTenants[0];
      return {
        predicted_category: 'rent',
        predicted_property_id: t.property_id,
        predicted_tenant_id: t.id,
        prediction_confidence: 'HIGH',
        prediction_reasoning: `Amount $${amount} matches ${t.name}'s rent of $${t.monthly_rent}`,
      };
    }
  }

  // Strategy 5: Recurring pattern (same merchant, similar amount, 2+ occurrences)
  const txAmt = Math.abs(amount);
  if (txAmt > 0) {
    const recurring = sameType.filter(c => {
      const cAmt = Math.abs(parseFloat(c.amount));
      return cAmt > 0 && extractMerchant(c.description) === merchant &&
        Math.abs(cAmt - txAmt) / txAmt <= 0.05;
    });
    if (recurring.length >= 2) {
      const top = getMostCommon(recurring, 'category');
      if (top) {
        return {
          predicted_category: top.value,
          predicted_property_id: null,
          predicted_tenant_id: null,
          prediction_confidence: 'MEDIUM',
          prediction_reasoning: `Recurring ${merchant} ~$${txAmt.toFixed(0)} previously "${top.value}"`,
        };
      }
    }
  }

  return null;
}

async function predictAll() {
  const { rows: training } = await db.query(`
    SELECT id, description, amount, type, category, property_id, tenant_id
    FROM transactions
    WHERE category NOT IN ('Other', 'Other Income')
  `);

  const { rows: uncategorized } = await db.query(`
    SELECT id, description, amount, type, category
    FROM transactions
    WHERE category IN ('Other', 'Other Income')
      AND (prediction_accepted IS NULL OR prediction_accepted = false)
  `);

  const { rows: rules } = await db.query(
    'SELECT keyword, category, type, priority FROM categorization_rules ORDER BY priority DESC'
  );

  const { rows: tenants } = await db.query(
    'SELECT id, name, monthly_rent, property_id FROM tenants'
  );

  // Clear stale predictions before re-running
  await db.query(`
    UPDATE transactions
    SET predicted_category=NULL, predicted_property_id=NULL, predicted_tenant_id=NULL,
        prediction_confidence=NULL, prediction_reasoning=NULL
    WHERE category IN ('Other', 'Other Income')
      AND (prediction_accepted IS NULL OR prediction_accepted = false)
  `);

  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, none: 0 };

  for (const tx of uncategorized) {
    const pred = predictForTransaction(tx, training, rules, tenants);
    if (!pred) { counts.none++; continue; }
    counts[pred.prediction_confidence] = (counts[pred.prediction_confidence] || 0) + 1;
    await db.query(`
      UPDATE transactions
      SET predicted_category=$1, predicted_property_id=$2, predicted_tenant_id=$3,
          prediction_confidence=$4, prediction_reasoning=$5
      WHERE id=$6
    `, [
      pred.predicted_category,
      pred.predicted_property_id ?? null,
      pred.predicted_tenant_id ?? null,
      pred.prediction_confidence,
      pred.prediction_reasoning,
      tx.id,
    ]);
  }

  console.log(`[predict] ${uncategorized.length} uncategorized:`, counts);
  return {
    predicted: uncategorized.length - counts.none,
    total: uncategorized.length,
    counts: { HIGH: counts.HIGH, MEDIUM: counts.MEDIUM, LOW: counts.LOW },
  };
}

module.exports = { predictAll };
