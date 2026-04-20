const CATEGORY_MAP = {
  'rent':                 'Rent',
  'mortgage':             'Mortgage',
  'utilities':            'Utilities',
  'repairs':              'Repairs',
  'insurance':            'Insurance',
  'maintenance':          'Maintenance',
  'landscaping':          'Landscaping',
  'property tax':         'Property Tax',
  'hoa':                  'HOA',
  'legal':                'Legal',
  'professional services':'Professional Services',
  'software':             'Software',
  'other income':         'Other Income',
  'interest income':      'Interest Income',
  'other':                'Other',
  'pest control':         'Pest Control',
  'management fees':      'Management Fees',
  'supplies':             'Supplies',
  'advertising':          'Advertising',
  'cleaning':             'Cleaning',
};

function normalizeCategory(str) {
  if (!str) return str;
  const lower = str.trim().toLowerCase();
  if (CATEGORY_MAP[lower]) return CATEGORY_MAP[lower];
  // Fallback: title-case any unknown value
  return lower.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

module.exports = { normalizeCategory, CATEGORY_MAP };
