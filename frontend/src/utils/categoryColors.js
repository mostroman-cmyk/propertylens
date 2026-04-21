const CATEGORY_COLOR_MAP = {
  'Rent':                 '#2D7A3E',
  'Mortgage':             '#1F2A44',
  'Utilities':            '#C8A046',
  'Repairs':              '#B23B2E',
  'Insurance':            '#5D6D7E',
  'Maintenance':          '#8B7355',
  'Property Tax':         '#2D4A6E',
  'Landscaping':          '#4A7C59',
  'HOA':                  '#6B5B95',
  'Legal':                '#7D4E57',
  'Professional Services':'#485A6F',
  'Software':             '#5C8A8A',
  'Cleaning':             '#A8B5A0',
  'Pest Control':         '#C97B2A',
  'Supplies':             '#7A6B3F',
  'Advertising':          '#BB6E42',
  'Management Fees':      '#4A5163',
  'Other Income':         '#2D7A3E',
  'Interest Income':      '#4A7C59',
  'Other':                '#8C8C8C',
};

const FALLBACK_COLOR = '#8C8C8C';

export function getCategoryColor(category) {
  if (!category) return FALLBACK_COLOR;
  return CATEGORY_COLOR_MAP[category] ?? FALLBACK_COLOR;
}

export default CATEGORY_COLOR_MAP;
