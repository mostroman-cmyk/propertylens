import { useState, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { api } from '../api';

export default function ConnectBank({ onSuccess, replaceConnectionId = null, buttonLabel = null, disabled = false }) {
  const [linkToken, setLinkToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchLinkToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/plaid/create-link-token');
      setLinkToken(data.link_token);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to initialize Plaid Link');
      setLoading(false);
    }
  };

  const handlePlaidSuccess = useCallback(async (publicToken, metadata) => {
    try {
      const institutionName = metadata.institution?.name || 'Unknown Bank';
      await api.post('/plaid/exchange-token', {
        public_token: publicToken,
        institution_name: institutionName,
      });

      // If replacing an old connection, delete it after the new one is created
      if (replaceConnectionId) {
        try {
          await api.delete(`/plaid/connections/${replaceConnectionId}`);
        } catch (e) {
          console.warn('Failed to delete old connection:', e.message);
        }
      }

      setLinkToken(null);
      setLoading(false);
      if (onSuccess) onSuccess(institutionName, !!replaceConnectionId);
    } catch (err) {
      setError('Failed to connect account. Please try again.');
      setLoading(false);
    }
  }, [onSuccess, replaceConnectionId]);

  const handlePlaidExit = useCallback(() => {
    setLinkToken(null);
    setLoading(false);
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handlePlaidSuccess,
    onExit: handlePlaidExit,
  });

  if (linkToken && ready) {
    open();
  }

  const label = buttonLabel || (replaceConnectionId ? 'Reconnect Bank' : '+ Connect Bank Account');

  return (
    <div>
      <button
        className={replaceConnectionId ? 'btn-secondary' : 'btn-primary'}
        onClick={fetchLinkToken}
        disabled={loading || disabled}
      >
        {loading ? 'Connecting...' : label}
      </button>
      {error && <p style={{ color: '#dc2626', marginTop: 8, fontSize: '0.85rem' }}>{error}</p>}
    </div>
  );
}
