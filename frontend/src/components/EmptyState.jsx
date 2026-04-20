const ICONS = {
  box: (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="26" height="26" />
      <line x1="5" y1="14" x2="31" y2="14" />
      <line x1="14" y1="5" x2="14" y2="14" />
      <line x1="22" y1="5" x2="22" y2="14" />
    </svg>
  ),
  check: (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="13" />
      <polyline points="11,18 16,23 25,13" />
    </svg>
  ),
  warning: (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 4 L33 31 H3 Z" />
      <line x1="18" y1="16" x2="18" y2="22" />
      <circle cx="18" cy="26" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  search: (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="15" cy="15" r="10" />
      <line x1="23" y1="23" x2="31" y2="31" />
    </svg>
  ),
  bank: (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,16 18,5 33,16" />
      <rect x="7" y="16" width="5" height="11" />
      <rect x="15.5" y="16" width="5" height="11" />
      <rect x="24" y="16" width="5" height="11" />
      <line x1="3" y1="27" x2="33" y2="27" />
      <line x1="3" y1="31" x2="33" y2="31" />
    </svg>
  ),
  list: (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="5" y1="11" x2="31" y2="11" />
      <line x1="5" y1="18" x2="31" y2="18" />
      <line x1="5" y1="25" x2="20" y2="25" />
    </svg>
  ),
  chart: (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="21" width="7" height="10" />
      <rect x="14.5" y="13" width="7" height="18" />
      <rect x="24" y="17" width="7" height="14" />
      <line x1="3" y1="31" x2="33" y2="31" />
    </svg>
  ),
  house: (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,18 18,6 33,18" />
      <rect x="8" y="18" width="20" height="13" />
      <rect x="14" y="24" width="8" height="7" />
    </svg>
  ),
  person: (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="11" r="6" />
      <path d="M6 31 C6 24 30 24 30 31" />
    </svg>
  ),
};

/**
 * EmptyState — Swiss-style empty/error/no-results state.
 * Props:
 *   icon         — string key from ICONS above (default 'box')
 *   title        — bold headline
 *   description  — gray one-liner
 *   primaryAction  — { label, onClick } or null
 *   secondaryAction — { label, href?, onClick? } or null
 */
export default function EmptyState({ icon = 'box', title, description, primaryAction, secondaryAction }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '48px 24px', textAlign: 'center',
    }}>
      {icon && (
        <div style={{ color: '#C8C8C8', marginBottom: 18 }}>
          {ICONS[icon] || ICONS.box}
        </div>
      )}
      {title && (
        <div style={{
          fontSize: 15, fontWeight: 600, color: '#111',
          marginBottom: description ? 6 : 20, letterSpacing: '-0.01em',
        }}>
          {title}
        </div>
      )}
      {description && (
        <div style={{
          fontSize: 13, color: '#888', lineHeight: 1.6,
          maxWidth: 380, marginBottom: 20,
        }}>
          {description}
        </div>
      )}
      {primaryAction && (
        <button
          className="btn-primary"
          onClick={primaryAction.onClick}
          style={{ marginBottom: secondaryAction ? 12 : 0 }}
        >
          {primaryAction.label}
        </button>
      )}
      {secondaryAction && (
        <a
          href={secondaryAction.href || undefined}
          onClick={secondaryAction.onClick}
          style={{
            fontSize: 12, color: '#888',
            textDecoration: 'underline', cursor: 'pointer',
          }}
        >
          {secondaryAction.label}
        </a>
      )}
    </div>
  );
}
