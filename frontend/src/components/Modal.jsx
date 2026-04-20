import { useEffect } from 'react';

export default function Modal({ title, onClose, onSave, saveLabel = 'Save', saving = false, error, width, children }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={width ? { width } : undefined} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>&#215;</button>
        </div>
        <div className="modal-body">
          {error && <div className="modal-error">{error}</div>}
          {children}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          {onSave != null && (
            <button className="btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving...' : saveLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
