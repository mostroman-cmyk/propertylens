export default function Button({
  variant = 'primary',
  size,
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  children,
  className = '',
  ...props
}) {
  const cls = [
    size === 'sm' || variant === 'edit' ? (variant === 'edit' ? 'btn-edit' : 'btn-sm') : `btn-${variant}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? 'Loading...' : children}
    </button>
  );
}
