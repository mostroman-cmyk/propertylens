import { useEffect, useState } from 'react';
import { getSettings, updateSettings, api } from '../api';
import Toast, { useToast } from '../components/Toast';

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
    const dayName = WEEKDAY_NAMES[parseInt(s.alert_weekday || '1')];
    return `Alerts are currently set to send every ${dayName} at ${timeStr} to ${email}`;
  }
  if (freq === 'twice') {
    const d1 = ordinal(parseInt(s.alert_day  || '5'));
    const d2 = ordinal(parseInt(s.alert_day2 || '20'));
    return `Alerts are currently set to send on the ${d1} and ${d2} of every month at ${timeStr} to ${email}`;
  }
  return `Alerts are currently set to send on the ${ordinal(parseInt(s.alert_day || '5'))} of every month at ${timeStr} to ${email}`;
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const { toast, showToast }    = useToast();

  // Email section state
  const [email, setEmail]         = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  // Schedule section state
  const [frequency, setFrequency] = useState('monthly');
  const [day,       setDay]       = useState('5');
  const [day2,      setDay2]      = useState('20');
  const [weekday,   setWeekday]   = useState('1');
  const [hour12,    setHour12]    = useState(6);
  const [ampm,      setAmpm]      = useState('PM');
  const [savingSchedule, setSavingSchedule] = useState(false);

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      setEmail(s.notify_email || '');
      setFrequency(s.alert_frequency || 'monthly');
      setDay(s.alert_day || '5');
      setDay2(s.alert_day2 || '20');
      setWeekday(s.alert_weekday || '1');
      const { hour, ampm: ap } = hour24ToDisplay(s.alert_hour || '18');
      setHour12(hour);
      setAmpm(ap);
    }).finally(() => setLoading(false));
  }, []);

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

  if (loading) return <div className="loading">Loading...</div>;

  const days = Array.from({ length: 28 }, (_, i) => i + 1);

  return (
    <div>
      <h1>Settings</h1>

      {/* Schedule summary */}
      <div className="settings-summary">
        <span className="settings-summary-icon">&#128197;</span>
        {buildSummary(settings)}
      </div>

      {/* ── Notification Email ── */}
      <div className="settings-section">
        <div className="settings-section-title">Notification Email</div>
        <p className="settings-section-desc">Rent alerts and monthly reports are sent to this address.</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
            <label>Email Address</label>
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
      </div>

      {/* ── Alert Schedule ── */}
      <div className="settings-section">
        <div className="settings-section-title">Alert Schedule</div>
        <p className="settings-section-desc">When should PropertyLens send your rent status report?</p>

        {/* Frequency */}
        <div className="form-group">
          <label>Frequency</label>
          <div className="radio-group">
            {[['monthly','Monthly'],['twice','Twice a month'],['weekly','Weekly']].map(([val, label]) => (
              <label key={val} className={`radio-option ${frequency === val ? 'active' : ''}`}>
                <input
                  type="radio"
                  value={val}
                  checked={frequency === val}
                  onChange={() => setFrequency(val)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Day picker — depends on frequency */}
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

        {/* Time picker */}
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

      <Toast message={toast} />
    </div>
  );
}
