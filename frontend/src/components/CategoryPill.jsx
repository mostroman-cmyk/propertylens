import { getCategoryColor } from '../utils/categoryColors';

export default function CategoryPill({ category, style }) {
  if (!category) return null;
  return (
    <span style={{
      display: 'inline-block',
      borderLeft: `3px solid ${getCategoryColor(category)}`,
      paddingLeft: 6,
      paddingRight: 7,
      paddingTop: 2,
      paddingBottom: 2,
      background: '#F5F5F5',
      borderRadius: '0 3px 3px 0',
      fontSize: 11,
      color: '#222',
      fontWeight: 500,
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {category}
    </span>
  );
}
