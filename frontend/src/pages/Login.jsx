import { useState } from 'react';
import { login } from '../api';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { setAuthenticated } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      await login(password);
      setAuthenticated(true);
    } catch (err) {
      setError(err?.response?.data?.error || 'Sign in failed. Please try again.');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#FAFAFA',
    }}>
      <div style={{ width: 320 }}>
        <div style={{
          fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
          fontSize: 13, letterSpacing: '0.15em', textTransform: 'uppercase',
          color: '#000', marginBottom: 32, textAlign: 'center',
        }}>
          PROPERTYLENS
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px', fontSize: 14,
              border: error ? '1px solid #DC2626' : '1px solid #D1D5DB',
              borderRadius: 2, outline: 'none', background: '#fff',
              fontFamily: 'inherit',
            }}
            disabled={loading}
          />

          {error && (
            <div style={{ fontSize: 12, color: '#DC2626', textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              padding: '10px 0', fontSize: 13, fontWeight: 600,
              background: loading || !password ? '#9CA3AF' : '#000',
              color: '#fff', border: 'none', borderRadius: 2,
              cursor: loading || !password ? 'default' : 'pointer',
              letterSpacing: '0.05em', transition: 'background 0.15s',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
