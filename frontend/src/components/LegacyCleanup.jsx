import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import Modal from './Modal';

export default function LegacyCleanup({ showToast }) {
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // All Plaid accounts fetched per connection
  const [allAccounts, setAllAccounts] = useState([]); // [{account_id, name, mask, subtype, institution_name}]
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // UI state
  const [expanded, setExpanded] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [processing, setProcessing] = useState(null); // 'assign'|'delete'|'resync'|'quickfix'
  const [confirmQuickFix, setConfirmQuickFix] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const { data } = await api.get('/plaid/legacy-stats');
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Fetch all Plaid accounts from all connections
  const loadAccounts = useCallback(async () => {
    if (!stats?.connections?.length) return;
    setLoadingAccounts(true);
    const collected = [];
    for (const conn of stats.connections) {
      try {
        const { data } = await api.get(`/plaid/accounts/${conn.id}`);
        for (const acct of data) {
          collected.push({ ...acct, institution_name: conn.institution_name });
        }
      } catch { /* skip failed connections */ }
    }
    setAllAccounts(collected);
    if (collected.length > 0 && !selectedAccount) setSelectedAccount(collected[0].account_id);
    setLoadingAccounts(false);
  }, [stats, selectedAccount]);

  useEffect(() => {
    if (expanded) loadAccounts();
  }, [expanded, loadAccounts]);

  const handleAssign = async () => {
    if (!selectedAccount) return;
    setProcessing('assign');
    try {
      const { data } = await api.post('/plaid/legacy-assign', { account_id: selectedAccount });
      showToast(`Assigned ${data.assigned} legacy transactions to selected account`);
      await fetchStats();
    } catch {
      showToast('Assignment failed');
    } finally {
      setProcessing(null);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setProcessing('delete');
    try {
      const { data } = await api.post('/plaid/legacy-delete');
      showToast(`Deleted ${data.deleted} legacy transaction${data.deleted !== 1 ? 's' : ''}`);
      setDeleteConfirm('');
      await fetchStats();
    } catch {
      showToast('Delete failed');
    } finally {
      setProcessing(null);
    }
  };

  const handleQuickFix = async () => {
    setProcessing('quickfix');
    try {
      const { data } = await api.post('/plaid/legacy-resync');
      const parts = [`Deleted ${data.deleted} legacy transaction${data.deleted !== 1 ? 's' : ''}`];
      if (data.synced > 0) parts.push(`re-imported ${data.synced} fresh`);
      if (data.errors?.length) parts.push(`${data.errors.length} connection error(s)`);
      showToast(parts.join(', '));
      await fetchStats();
    } catch {
      showToast('Re-sync failed');
    } finally {
      setProcessing(null);
    }
  };

  if (loadingStats) return <div style={{ fontSize: 13, color: '#888', marginTop: 16 }}>Scanning for legacy transactions...</div>;
  if (!stats) return null;
  if (stats.count === 0) return (
    <div style={{ marginTop: 16, fontSize: 13, color: '#16a34a' }}>✓ No legacy transactions — all imports have account tracking.</div>
  );

  const busy = !!processing;

  return (
    <div style={{ marginTop: 20, border: '1px solid #E5E5E5', borderRadius: 2 }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: '#FAFAFA', borderBottom: '1px solid #E5E5E5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Legacy Transactions</span>
          <span style={{ marginLeft: 10, background: '#E30613', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>{stats.count}</span>
        </div>
        <button className="btn-edit" onClick={() => setExpanded(e => !e)} style={{ fontSize: 12 }}>
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {/* Quickest Fix — always visible */}
      <div style={{ padding: '14px 16px', borderBottom: expanded ? '1px solid #E5E5E5' : 'none', background: '#fffbf0' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>⚡ Quickest fix</div>
        <p style={{ fontSize: 12, color: '#555', margin: '0 0 12px' }}>
          Delete all {stats.count} legacy transaction{stats.count !== 1 ? 's' : ''} and re-import fresh from your currently selected accounts.
          This gives you a clean import with full account tracking.
        </p>
        <button
          className="btn-primary"
          onClick={() => setConfirmQuickFix(true)}
          disabled={busy}
          style={{ fontSize: 13 }}
        >
          {processing === 'quickfix' ? 'Working…' : `Delete ${stats.count} legacy + Re-sync from Plaid`}
        </button>

        {confirmQuickFix && (
          <Modal
            title="Delete Legacy + Re-sync from Plaid"
            onClose={() => setConfirmQuickFix(false)}
            onSave={() => { setConfirmQuickFix(false); handleQuickFix(); }}
            saveLabel={`Delete ${stats.count} + Re-sync`}
          >
            <p style={{ margin: 0, fontSize: 14 }}>
              This will permanently delete <strong>{stats.count} legacy transaction{stats.count !== 1 ? 's' : ''}</strong> and re-import fresh from Plaid. Any manual categorization or tenant assignments on these transactions will be lost.
            </p>
          </Modal>
        )}
      </div>

      {expanded && (
        <>
          {/* Sample Transactions */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #E5E5E5' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
              Sample legacy transactions (showing up to 30 of {stats.count})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #E5E5E5', color: '#888', fontWeight: 600 }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #E5E5E5', color: '#888', fontWeight: 600 }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #E5E5E5', color: '#888', fontWeight: 600 }}>Amount</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #E5E5E5', color: '#888', fontWeight: 600 }}>Category</th>
                </tr>
              </thead>
              <tbody>
                {stats.samples.map(tx => (
                  <tr key={tx.id}>
                    <td style={{ padding: '4px 8px', color: '#666', fontFamily: 'monospace', fontSize: 11 }}>{tx.date}</td>
                    <td style={{ padding: '4px 8px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.description}>{tx.description}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>${Math.abs(parseFloat(tx.amount)).toLocaleString()}</td>
                    <td style={{ padding: '4px 8px', color: '#888' }}>{tx.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Assign to Account */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #E5E5E5' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Assign legacy transactions to an account</div>
            <p style={{ fontSize: 12, color: '#555', margin: '0 0 10px' }}>
              If you know all these transactions came from the same account, tag them so account-based cleanup works going forward.
            </p>
            {loadingAccounts ? (
              <div style={{ fontSize: 12, color: '#888' }}>Loading Plaid accounts…</div>
            ) : allAccounts.length === 0 ? (
              <div style={{ fontSize: 12, color: '#888' }}>No Plaid accounts found.</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  className="form-input form-input-sm"
                  value={selectedAccount}
                  onChange={e => setSelectedAccount(e.target.value)}
                  style={{ minWidth: 260 }}
                >
                  {allAccounts.map(a => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.institution_name} — {a.name} (····{a.mask})
                    </option>
                  ))}
                </select>
                <button className="btn-secondary" onClick={handleAssign} disabled={busy || !selectedAccount}>
                  {processing === 'assign' ? 'Assigning…' : `Assign all ${stats.count} to this account`}
                </button>
              </div>
            )}
          </div>

          {/* Delete All — nuclear option */}
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Delete all legacy transactions</div>
            <p style={{ fontSize: 12, color: '#555', margin: '0 0 10px' }}>
              Permanently removes all {stats.count} legacy transaction{stats.count !== 1 ? 's' : ''}.
              Type <strong>DELETE</strong> to confirm.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="form-input form-input-sm"
                placeholder='Type DELETE to confirm'
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                style={{ width: 200, fontFamily: 'monospace' }}
              />
              <button
                className="btn-primary"
                style={{ background: '#E30613', borderColor: '#E30613' }}
                disabled={deleteConfirm !== 'DELETE' || busy}
                onClick={handleDelete}
              >
                {processing === 'delete' ? 'Deleting…' : `Delete all ${stats.count}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
