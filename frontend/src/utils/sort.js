import { useState } from 'react';

export function useSortState() {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const handleSort = (col) => {
    if (sortCol !== col) { setSortCol(col); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortCol(null); setSortDir('asc'); }
  };

  const resetSort = () => { setSortCol(null); setSortDir('asc'); };

  return { sortCol, sortDir, handleSort, resetSort };
}

export function sortRows(data, sortCol, sortDir, colDefs) {
  if (!sortCol || !colDefs[sortCol]) {
    return [...data].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') || (b.id || 0) - (a.id || 0)
    );
  }
  return [...data].sort((a, b) => {
    const cmp = colDefs[sortCol](a, b);
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

// Standard column comparators for transaction-like rows
export const TX_COL_DEFS = {
  date:        (a, b) => (a.date || '').localeCompare(b.date || ''),
  description: (a, b) => (a.description || '').toLowerCase().localeCompare((b.description || '').toLowerCase()),
  amount:      (a, b) => Math.abs(parseFloat(a.amount)) - Math.abs(parseFloat(b.amount)),
  type:        (a, b) => (a.type || '').localeCompare(b.type || ''),
  category:    (a, b) => {
    const ua = ['Other', 'Other Income'].includes(a.category);
    const ub = ['Other', 'Other Income'].includes(b.category);
    if (ua !== ub) return ua ? 1 : -1;
    return (a.category || '').localeCompare(b.category || '');
  },
  property:    (a, b) => {
    if (!a.property_name !== !b.property_name) return a.property_name ? -1 : 1;
    return (a.property_name || '').localeCompare(b.property_name || '');
  },
  tenant:      (a, b) => {
    if (!a.tenant_name !== !b.tenant_name) return a.tenant_name ? -1 : 1;
    return (a.tenant_name || '').localeCompare(b.tenant_name || '');
  },
};

// Column comparators for prediction rows (different field names)
export const PRED_COL_DEFS = {
  date:               (a, b) => (a.date || '').localeCompare(b.date || ''),
  description:        (a, b) => (a.description || '').toLowerCase().localeCompare((b.description || '').toLowerCase()),
  amount:             (a, b) => Math.abs(parseFloat(a.amount)) - Math.abs(parseFloat(b.amount)),
  predicted_category: (a, b) => {
    if (!a.predicted_category !== !b.predicted_category) return a.predicted_category ? -1 : 1;
    return (a.predicted_category || '').localeCompare(b.predicted_category || '');
  },
  property:           (a, b) => {
    if (!a.predicted_property_name !== !b.predicted_property_name) return a.predicted_property_name ? -1 : 1;
    return (a.predicted_property_name || '').localeCompare(b.predicted_property_name || '');
  },
  tenant:             (a, b) => {
    if (!a.predicted_tenant_name !== !b.predicted_tenant_name) return a.predicted_tenant_name ? -1 : 1;
    return (a.predicted_tenant_name || '').localeCompare(b.predicted_tenant_name || '');
  },
};
