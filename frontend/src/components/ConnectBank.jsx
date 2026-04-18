import { useState, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { api } from '../api';

export default function ConnectBank({ onSuccess }) {
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
      setLinkToken(null);
      setLoading(false);
      if (onSuccess) onSuccess(institutionName);
    } catch (err) {
      setError('Failed to connect account. Please try again.');
      setLoading(false);
    }
  }, [onSuccess]);

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

  return (
    <div>
      <button
        className="btn-primary"
        onClick={fetchLinkToken}
        disabled={loading}
      >
        {loading ? 'Connecting...' : '+ Connect Bank Account'}
      </button>
      {error && <p style={{ color: '#dc2626', marginTop: 8, fontSize: '0.85rem' }}>{error}</p>}
    </div>
  );
}
