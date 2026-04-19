import { useEffect, useState, useCallback } from 'react';
import { getSettings, updateSettings, api } from '../api';
import ConnectBank from '../components/ConnectBank';
import Toast, { useToast } from '../components/Toast';
import LegacyCleanup from '../components/LegacyCleanup';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function hour24ToDisplay(h24) {
  const h = parseInt(h24);
  if (h === 0)  return { hour: 12, ampm: 'AM' };
  if (h === 12) return { hour: 12, ampm: 'PM' };
  if (h < 12)   return { hour: h,      ampm: 'AM' };
  return           { hour: h - 12, ampm: 'PM' };
}

function displayToHour24(hour12, ampm) {
  const h = parseInt(hour12);
  if (ampm === 'AM') return h === 12 ? 0 : h;
  return h === 12 ? 12 : h + 12;
}

function buildSummary(s) {
  if (!s) return '...';
  const { hour, ampm } = hour24ToDisplay(s.alert_hour || '18');
  const timeStr = `${hour}:00 ${ampm}`;
  const email = s.notify_email || 'your email';
  const freq = s.alert_frequency || 'monthly';
  if (freq === 'weekly') {
    return `Sending every ${WEEKDAY_NAMES[parseInt(s.alert_weekday || '1')]} at ${timeStr} to ${email}`;
  }
  if (freq === 'twice') {
    return `Sending on the ${ordinal(parseInt(s.alert_day || '5'))} and ${ordinal(parseInt(s.alert_day2 || '20'))} of each month at ${timeStr} to ${email}`;
  }
  return `Sending on the ${ordinal(parseInt(s.alert_day || '5'))} of each month at ${timeStr} to ${email}`;
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();

  // Notifications state
  const [email, setEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [frequency, setFrequency] = useState('monthly');
  const [day, setDay] = useState('5');
  const [day2, setDay2] = useState('20');
  const [weekday, setWeekday] = useState('1');
  const [hour12, setHour12] = useState(6);
  const [ampm, setAmpm] = useState('PM');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [portfolioAllocation, setPortfolioAllocation] = useState('equal');
  const [savingAllocation, setSavingAllocation] = useState(false);

  const [accountConfirm, setAccountConfirm] = useState(null);
  // { connId, deselected: [{account_id, count}], total_count, newAccountIds, addedCount, accountNames }
  const [cleaningUp, setCleaningUp] = useState(false);

  // Full re-sync state: { connId, step: 'confirm'|'working', deleteExisting: bool }
  const [fullResync, setFullResync] = useState(null);

  // Reconnect state: connId being reconnected, or null
  const [reconnectConnId, setReconnectConnId] = useState(null);
  const [reconnectStatus, setReconnectStatus] = useState(null); // success message after reconnect

  // Bank connections state
  const [connections, setConnections] = useState([]);
  const [connectionAccounts, setConnectionAccounts] = useState({});
  const [pendingSelections, setPendingSelections] = useState({});
  const [savingAccounts, setSavingAccounts] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const fetchAccountsForConnections = useCallback(async (conns) => {
    const accountResults = {};
    const selectionResults = {};
    await Promise.all(conns.map(async (conn) => {
      try {
        const { data } = await api.get(`/plaid/accounts/${conn.id}`);
        accountResults[conn.id] = data;
        selectionResults[conn.id] = conn.enabled_account_ids || [];
      } catch {
        accountResults[conn.id] = [];
        selectionResults[conn.id] = conn.enabled_account_ids || [];
      }
    }));
    setConnectionAccounts(prev => ({ ...prev, ...accountResults }));
    setPendingSelections(prev => ({ ...prev, ...selectionResults }));
  }, []);

  const fetchConnections = useCallback(async () => {
    const { data } = await api.get('/plaid/connections');
    setConnections(data);
    if (data.length > 0) await fetchAccountsForConnections(data);
  }, [fetchAccountsForConnections]);

  useEffect(() => {
    Promise.all([getSettings(), fetchConnections()])
      .then(([s]) => {
        setSettings(s);
        setEmail(s.notify_email || '');
        setFrequency(s.alert_frequency || 'monthly');
        setDay(s.alert_day || '5');
        setDay2(s.alert_day2 || '20');
        setWeekday(s.alert_weekday || '1');
        const { hour, ampm: ap } = hour24ToDisplay(s.alert_hour || '18');
        setHour12(hour);
        setAmpm(ap);
        setPortfolioAllocation(s.portfolio_allocation || 'equal');
      })
      .finally(() => setLoading(false));
  }, [fetchConnections]);

  const handleSaveEmail = async () => {
    setSavingEmail(true);
    try {
      const result = await updateSettings({ notify_email: email });
      setSettings(result.settings);
      showToast('Notification email saved');
    } catch {
      showToast('Failed to save email');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const { data } = await api.post('/email/test');
      showToast(`${data.message} — ${data.paid} paid, ${data.unpaid} unpaid`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to send test email');
    } finally {
      setTestingEmail(false);
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const hour24 = String(displayToHour24(hour12, ampm));
      const result = await updateSettings({
        alert_frequency: frequency,
        alert_day:       day,
        alert_day2:      day2,
        alert_weekday:   weekday,
        alert_hour:      hour24,
      });
      setSettings(result.settings);
      showToast(`Schedule saved — cron updated to: ${result.expressions?.join(', ')}`);
    } catch {
      showToast('Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleBankConnected = async (institutionName, isReconnect = false) => {
    if (isReconnect) {
      setReconnectConnId(null);
      setReconnectStatus(institutionName);
    } else {
      showToast(`${institutionName} connected. Select accounts below.`);
    }
    await fetchConnections();
  };

  const handleAccountToggle = (connId, accountId) => {
    setPendingSelections(prev => {
      const current = prev[connId] || [];
      const updated = current.includes(accountId)
        ? current.filter(id => id !== accountId)
        : [...current, accountId];
      return { ...prev, [connId]: updated };
    });
  };

  const handleSaveAccounts = async (connId) => {
    const conn = connections.find(c => c.id === connId);
    const savedIds = conn?.enabled_account_ids || [];
    const newIds = pendingSelections[connId] || [];
    const deselectedIds = savedIds.filter(id => !newIds.includes(id));
    const addedIds = newIds.filter(id => !savedIds.includes(id));

    if (deselectedIds.length > 0) {
      // Count transactions that would be removed, then show confirm dialog
      setSavingAccounts(prev => ({ ...prev, [connId]: true }));
      try {
        const { data } = await api.post(`/plaid/connections/${connId}/count-deselected`, { new_account_ids: newIds });
        const accounts = connectionAccounts[connId] || [];
        const accountNames = deselectedIds.map(id => {
          const acct = accounts.find(a => a.account_id === id);
          return acct ? `${acct.name} (····${acct.mask})` : id;
        });
        setAccountConfirm({ connId, deselected: data.deselected, total_count: data.total_count, newAccountIds: newIds, addedCount: addedIds.length, accountNames });
      } catch {
        showToast('Failed to check transaction counts');
      } finally {
        setSavingAccounts(prev => ({ ...prev, [connId]: false }));
      }
      return;
    }

    // No deselection — save directly
    await doSaveAccounts(connId, newIds, false, addedIds.length);
  };

  const doSaveAccounts = async (connId, accountIds, deleteDeselected, addedCount) => {
    setSavingAccounts(prev => ({ ...prev, [connId]: true }));
    try {
      const { data } = await api.put(`/plaid/connections/${connId}/accounts`, {
        account_ids: accountIds,
        delete_deselected: deleteDeselected,
      });
      setConnections(prev => prev.map(c => c.id === connId ? { ...c, enabled_account_ids: accountIds } : c));
      setAccountConfirm(null);
      const parts = [];
      if (addedCount > 0) parts.push(`+${addedCount} account${addedCount !== 1 ? 's' : ''} pending sync`);
      if (data.removed_count > 0) parts.push(`-${data.removed_count} transaction${data.removed_count !== 1 ? 's' : ''} removed`);
      showToast(parts.length ? `Account settings updated: ${parts.join(', ')}` : 'Account selection saved');
    } catch {
      showToast('Failed to save account selection');
    } finally {
      setSavingAccounts(prev => ({ ...prev, [connId]: false }));
    }
  };

  const cancelAccountConfirm = () => {
    if (!accountConfirm) return;
    // Revert pending selection back to what was saved
    const conn = connections.find(c => c.id === accountConfirm.connId);
    setPendingSelections(prev => ({ ...prev, [accountConfirm.connId]: conn?.enabled_account_ids || [] }));
    setAccountConfirm(null);
  };

  const handleFullResync = async (deleteExisting) => {
    if (!fullResync) return;
    const connId = fullResync.connId;
    const conn = connections.find(c => c.id === connId);
    setFullResync({ connId, step: 'working', deleteExisting });
    try {
      const { data } = await api.post(`/plaid/connections/${connId}/full-resync`, { delete_existing: deleteExisting });
      const parts = [];
      if (deleteExisting && data.deleted > 0) parts.push(`deleted ${data.deleted} old transaction${data.deleted !== 1 ? 's' : ''}`);
      parts.push(`imported ${data.synced} transaction${data.synced !== 1 ? 's' : ''} from Plaid`);
      if (data.errors?.length) parts.push(`${data.errors.length} error(s)`);
      showToast(`${conn?.institution_name}: ${parts.join(', ')}`);
      setFullResync(null);
      if (data.errors?.length) {
        setSyncResult({ message: data.errors.map(e => `${e.institution}: ${e.error}`).join(' | '), type: 'warn' });
      }
    } catch (err) {
      showToast(err.response?.data?.error || 'Full re-sync failed');
      setFullResync(null);
    }
  };

  const handleCleanupOrphans = async () => {
    setCleaningUp(true);
    try {
      const { data } = await api.post('/plaid/cleanup-orphans');
      showToast(data.removed > 0 ? `Removed ${data.removed} orphaned transaction${data.removed !== 1 ? 's' : ''}` : 'No orphaned transactions found');
    } catch {
      showToast('Cleanup failed');
    } finally {
      setCleaningUp(false);
    }
  };

  const handleSync = async () => {
    const unconfigured = connections.filter(c => !c.enabled_account_ids?.length);
    if (connections.length === 0) {
      setSyncResult({ message: 'No bank accounts connected. Connect one below.', type: 'warn' });
      return;
    }
    if (unconfigured.length > 0) {
      setSyncResult({ message: `Select accounts to sync for: ${unconfigured.map(c => c.institution_name).join(', ')}`, type: 'warn' });
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data } = await api.post('/plaid/sync');
      let msg, type;
      if (data.errors?.length) {
        const detail = data.errors.map(e => `${e.institution}: ${e.error}`).join(' | ');
        msg = `Added ${data.synced} new transaction${data.synced !== 1 ? 's' : ''}. Error — ${detail}`;
        type = 'warn';
      } else if (data.synced > 0) {
        msg = `Added ${data.synced} new transaction${data.synced !== 1 ? 's' : ''}. ${data.skipped} already existed.`;
        type = 'success';
      } else {
        msg = `Already up to date — ${data.skipped} transaction${data.skipped !== 1 ? 's' : ''} checked, none new.`;
        type = 'success';
      }
      setSyncResult({ message: msg, type });
    } catch (err) {
      setSyncResult({ message: err.response?.data?.error || 'Sync failed.', type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  const alertClass = { success: 'alert-success', info: 'alert-info', warn: 'alert-warn', error: 'alert-error' };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* ── SECTION 1: NOTIFICATIONS ── */}
      <div className="settings-section">
        <div className="settings-section-title">Notifications</div>
        <p className="settings-section-desc">{buildSummary(settings)}</p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
          <div className="form-group" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
            <label>Notification Email</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <button className="btn-primary" onClick={handleSaveEmail} disabled={savingEmail}>
            {savingEmail ? 'Saving...' : 'Save Email'}
          </button>
          <button className="btn-secondary" onClick={handleTestEmail} disabled={testingEmail}>
            {testingEmail ? 'Sending...' : 'Send Test Email'}
          </button>
        </div>

        <div className="form-group">
          <label>Frequency</label>
          <div className="radio-group">
            {[['monthly','Monthly'],['twice','Twice a month'],['weekly','Weekly']].map(([val, label]) => (
              <label key={val} className={`radio-option ${frequency === val ? 'active' : ''}`}>
                <input type="radio" value={val} checked={frequency === val} onChange={() => setFrequency(val)} />
                {label}
              </label>
            ))}
          </div>
        </div>

        {frequency === 'monthly' && (
          <div className="form-group">
            <label>Day of Month</label>
            <select className="form-input form-input-sm" value={day} onChange={e => setDay(e.target.value)}>
              {days.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
            </select>
          </div>
        )}

        {frequency === 'twice' && (
          <div className="form-row">
            <div className="form-group">
              <label>First Day</label>
              <select className="form-input" value={day} onChange={e => setDay(e.target.value)}>
                {days.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Second Day</label>
              <select className="form-input" value={day2} onChange={e => setDay2(e.target.value)}>
                {days.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
              </select>
            </div>
          </div>
        )}

        {frequency === 'weekly' && (
          <div className="form-group">
            <label>Day of Week</label>
            <select className="form-input form-input-sm" value={weekday} onChange={e => setWeekday(e.target.value)}>
              {WEEKDAY_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>Time</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="form-input form-input-sm" value={hour12} onChange={e => setHour12(parseInt(e.target.value))}>
              {[12,1,2,3,4,5,6,7,8,9,10,11].map(h => <option key={h} value={h}>{h}:00</option>)}
            </select>
            <select className="form-input form-input-sm" value={ampm} onChange={e => setAmpm(e.target.value)}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
        </div>

        <button className="btn-primary" onClick={handleSaveSchedule} disabled={savingSchedule}>
          {savingSchedule ? 'Saving...' : 'Save Schedule'}
        </button>
      </div>

      {/* ── SECTION 2: PORTFOLIO ALLOCATION ── */}
      <div className="settings-section">
        <div className="settings-section-title">Portfolio Expense Allocation</div>
        <p className="settings-section-desc">When a transaction is marked "All Properties", how should it be split across properties in per-property P&L reports?</p>
        <div className="form-group" style={{ maxWidth: 320 }}>
          <label>Allocation Method</label>
          <select className="form-input" value={portfolioAllocation} onChange={e => setPortfolioAllocation(e.target.value)}>
            <option value="equal">Equal split — divide evenly across all properties</option>
            <option value="revenue_share">By revenue share — proportional to rent income</option>
            <option value="unit_count">By unit count — proportional to number of tenants</option>
            <option value="unallocated">Unallocated — show as separate line, don't split</option>
          </select>
        </div>
        <button
          className="btn-primary"
          disabled={savingAllocation}
          onClick={async () => {
            setSavingAllocation(true);
            try {
              await updateSettings({ portfolio_allocation: portfolioAllocation });
              showToast('Allocation method saved');
            } catch {
              showToast('Failed to save');
            } finally {
              setSavingAllocation(false);
            }
          }}
        >
          {savingAllocation ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* ── SECTION 3: BANK CONNECTIONS ── */}
      <div className="settings-section">
        <div className="settings-section-title">Bank Connections</div>
        <p className="settings-section-desc">Connect bank accounts via Plaid to import transactions automatically.</p>

        {syncResult && (
          <div className={`alert ${alertClass[syncResult.type]}`} style={{ marginBottom: 16 }}>{syncResult.message}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <ConnectBank onSuccess={handleBankConnected} />
          <button className="btn-secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync Transactions'}
          </button>
        </div>

        {/* Post-reconnect status message */}
        {reconnectStatus && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            <strong>{reconnectStatus} reconnected.</strong> Plaid is fetching up to 2 years of transaction history — this may take 2–5 minutes.
            Once ready, click <strong>Full Re-Sync (Pull Complete History)</strong> on the Dashboard or use the Full Re-Sync button in Account Selection below.
          </div>
        )}

        {connections.length === 0 ? (
          <p style={{ color: '#888', fontSize: 13 }}>No banks connected yet.</p>
        ) : (
          <>
            <table>
              <thead>
                <tr><th>Institution</th><th>Connected</th><th>Accounts Selected</th><th></th></tr>
              </thead>
              <tbody>
                {connections.map(conn => (
                  <tr key={conn.id}>
                    <td>{conn.institution_name}</td>
                    <td className="nowrap" style={{ color: '#666' }}>{new Date(conn.created_at).toLocaleDateString()}</td>
                    <td style={{ color: '#666' }}>
                      {conn.enabled_account_ids?.length
                        ? `${conn.enabled_account_ids.length} account${conn.enabled_account_ids.length !== 1 ? 's' : ''}`
                        : <span style={{ color: '#E30613' }}>None selected</span>
                      }
                    </td>
                    <td className="nowrap">
                      <button className="btn-edit" style={{ fontSize: 11 }} onClick={() => setReconnectConnId(conn.id === reconnectConnId ? null : conn.id)}>
                        {reconnectConnId === conn.id ? 'Cancel' : 'Reconnect Bank'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Reconnect warning panel */}
            {reconnectConnId && (() => {
              const conn = connections.find(c => c.id === reconnectConnId);
              return (
                <div style={{ border: '1px solid #E5A800', borderRadius: 2, padding: '16px 20px', marginTop: 16, background: '#FFFBEA' }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Reconnect {conn?.institution_name} for full history</div>
                  <p style={{ fontSize: 12, color: '#555', margin: '0 0 12px' }}>
                    To get up to 2 years of transaction history, you need to reconnect this bank. Your previously synced
                    transactions will remain, and we'll merge in any additional history found.
                  </p>
                  <p style={{ fontSize: 12, color: '#555', margin: '0 0 12px' }}>
                    After reconnecting: go to Account Selection below to re-enable your accounts, then click <strong>Full Re-Sync</strong>.
                  </p>
                  <ConnectBank
                    replaceConnectionId={reconnectConnId}
                    buttonLabel={`Reconnect ${conn?.institution_name}`}
                    onSuccess={handleBankConnected}
                  />
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* ── SECTION 3: ACCOUNT SELECTION ── */}
      {connections.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">Account Selection</div>
          <p className="settings-section-desc">Choose which accounts to include when syncing transactions.</p>

          {/* Confirmation dialog for deselecting accounts */}
          {accountConfirm && (
            <div style={{ border: '1px solid #E30613', borderRadius: 2, padding: '16px 20px', marginBottom: 20, background: '#FFF5F5' }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Remove transactions from {accountConfirm.accountNames.length === 1 ? accountConfirm.accountNames[0] : `${accountConfirm.accountNames.length} accounts`}?
              </div>
              <p style={{ fontSize: 13, color: '#555', margin: '0 0 12px' }}>
                {accountConfirm.accountNames.join(', ')} will be deselected.
                {accountConfirm.total_count > 0
                  ? ` This will permanently remove ${accountConfirm.total_count} transaction${accountConfirm.total_count !== 1 ? 's' : ''} linked to ${accountConfirm.accountNames.length === 1 ? 'that account' : 'those accounts'} from your database.`
                  : ' No transactions are linked to those accounts (they may have been added before account tracking was enabled).'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn-primary"
                  style={{ background: '#E30613', borderColor: '#E30613' }}
                  disabled={savingAccounts[accountConfirm.connId]}
                  onClick={() => doSaveAccounts(accountConfirm.connId, accountConfirm.newAccountIds, true, accountConfirm.addedCount)}
                >
                  {savingAccounts[accountConfirm.connId] ? 'Removing...' : `Yes, remove ${accountConfirm.total_count > 0 ? accountConfirm.total_count + ' ' : ''}transaction${accountConfirm.total_count !== 1 ? 's' : ''}`}
                </button>
                <button className="btn-edit" onClick={cancelAccountConfirm}>Cancel</button>
              </div>
            </div>
          )}

          {/* Full re-sync confirmation dialog */}
          {fullResync && fullResync.step === 'confirm' && (() => {
            const conn = connections.find(c => c.id === fullResync.connId);
            const txCount = (conn?.enabled_account_ids || []).length;
            return (
              <div style={{ border: '1px solid #E30613', borderRadius: 2, padding: '16px 20px', marginBottom: 20, background: '#FFF5F5' }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Full Re-Sync: {conn?.institution_name}</div>
                <p style={{ fontSize: 13, color: '#555', margin: '0 0 12px' }}>
                  This will clear the saved sync position and re-import all available history from Plaid (up to 24 months).
                  Would you like to delete existing transactions first for a clean import?
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn-primary" style={{ background: '#E30613', borderColor: '#E30613' }} onClick={() => handleFullResync(true)}>
                    Delete existing + re-import all
                  </button>
                  <button className="btn-secondary" onClick={() => handleFullResync(false)}>
                    Keep existing, just re-import missing
                  </button>
                  <button className="btn-edit" onClick={() => setFullResync(null)}>Cancel</button>
                </div>
              </div>
            );
          })()}

          {fullResync && fullResync.step === 'working' && (
            <div style={{ padding: '12px 16px', background: '#FAFAFA', border: '1px solid #E5E5E5', borderRadius: 2, marginBottom: 20, fontSize: 13, color: '#555' }}>
              Syncing full history from Plaid — this may take a minute or two for large accounts...
            </div>
          )}

          {connections.map(conn => {
            const accounts = connectionAccounts[conn.id];
            const selected = pendingSelections[conn.id] || [];
            const savedIds = conn.enabled_account_ids || [];
            const isSaving = savingAccounts[conn.id];
            const selectionChanged = JSON.stringify([...selected].sort()) !== JSON.stringify([...savedIds].sort());
            const isResyncing = fullResync?.connId === conn.id && fullResync?.step === 'working';

            return (
              <div key={conn.id} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{conn.institution_name}</div>
                {!accounts ? (
                  <div className="label">Loading accounts...</div>
                ) : accounts.length === 0 ? (
                  <div className="error" style={{ padding: 0 }}>Could not load accounts from Plaid.</div>
                ) : (
                  <>
                    {accounts.map(acct => (
                      <label key={acct.account_id} className="account-item" style={{ cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(acct.account_id)}
                          onChange={() => handleAccountToggle(conn.id, acct.account_id)}
                          style={{ width: 14, height: 14, accentColor: '#000', flexShrink: 0 }}
                        />
                        <div>
                          <div className="account-name">{acct.name}</div>
                          <div className="account-meta">{acct.subtype} ···· {acct.mask}</div>
                        </div>
                      </label>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                      <button
                        className="btn-primary"
                        disabled={isSaving || selected.length === 0 || !selectionChanged || !!accountConfirm}
                        onClick={() => handleSaveAccounts(conn.id)}
                      >
                        {isSaving ? 'Checking...' : 'Save Selection'}
                      </button>
                      <button
                        className="btn-edit"
                        disabled={!!fullResync || !!accountConfirm}
                        onClick={() => setFullResync({ connId: conn.id, step: 'confirm' })}
                        title="Clear sync cursor and re-import full transaction history from Plaid"
                      >
                        {isResyncing ? 'Syncing...' : 'Full Re-Sync'}
                      </button>
                      {savedIds.length > 0 && !selectionChanged && (
                        <span style={{ fontSize: 11, color: '#666' }}>
                          ✓ {savedIds.length} account{savedIds.length !== 1 ? 's' : ''} active
                        </span>
                      )}
                      {savedIds.length === 0 && (
                        <span style={{ fontSize: 11, color: '#E30613' }}>Select at least one account to enable sync</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          <div style={{ borderTop: '1px solid #E5E5E5', paddingTop: 16, marginTop: 8 }}>
            <button className="btn-secondary" onClick={handleCleanupOrphans} disabled={cleaningUp}>
              {cleaningUp ? 'Scanning...' : 'Clean up orphaned transactions'}
            </button>
            <p style={{ fontSize: 12, color: '#888', marginTop: 8, marginBottom: 0 }}>
              Removes any transactions linked to Plaid accounts that are no longer in your selection list.
            </p>
          </div>
        </div>
      )}

      {/* ── SECTION 4: LEGACY CLEANUP ── */}
      {connections.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">Legacy Transaction Cleanup</div>
          <p className="settings-section-desc">Transactions imported before account tracking was enabled have no account association. Use the tools below to resolve them.</p>
          <LegacyCleanup showToast={showToast} />
        </div>
      )}

      <Toast message={toast} />
    </div>
  );
}
