import { useState, useCallback, useEffect, useRef } from 'react';

export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback((msg) => {
    clearTimeout(timer.current);
    setToast(msg);
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { toast, showToast };
}

export default function Toast({ message }) {
  if (!message) return null;
  return (
    <div className="toast">
      <span className="toast-check">&#10003;</span>
      {message}
    </div>
  );
}
