import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { formatDate } from './utils/format';
import Dashboard from './pages/Dashboard';
import Properties from './pages/Properties';
import Tenants from './pages/Tenants';
import Transactions from './pages/Transactions';
import CategorizationRules from './pages/CategorizationRules';
import MerchantRules from './pages/MerchantRules';
import ReviewClassifications from './pages/ReviewClassifications';
import Predictions from './pages/Predictions';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Login from './pages/Login';
import './App.css';

const NAV_LINKS = [
  { to: '/',                    label: 'Dashboard',     end: true },
  { to: '/properties',          label: 'Properties' },
  { to: '/tenants',             label: 'Tenants' },
  { to: '/transactions',        label: 'Transactions' },
  { to: '/categorization-rules',label: 'Rules' },
  { to: '/merchant-rules',      label: 'Merchant Rules' },
  { to: '/review',              label: 'Review' },
  { to: '/predictions',         label: 'Predictions' },
  { to: '/reports',             label: 'Reports' },
  { to: '/settings',            label: 'Settings' },
];

function TopBar({ onMenuToggle }) {
  const dateStr = formatDate(new Date(), 'header');
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="hamburger" onClick={onMenuToggle} aria-label="Open navigation menu">
          <span /><span /><span />
        </button>
        <span className="topbar-brand">PROPERTYLENS</span>
      </div>
      <span className="topbar-meta topbar-date">{dateStr}</span>
    </header>
  );
}

function AuthenticatedApp() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [navOpen]);

  return (
    <div className="app">
      <TopBar onMenuToggle={() => { console.log('hamburger clicked, navOpen now:', !navOpen); setNavOpen(o => !o); }} />
      <nav className="sidebar">
        {NAV_LINKS.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end}>{label}</NavLink>
        ))}
      </nav>
      {navOpen && (
        <>
          <div
            onClick={() => setNavOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9998 }}
          />
          <nav
            className="mobile-nav"
            style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 260, background: '#fff', borderRight: '1px solid #E5E5E5', display: 'flex', flexDirection: 'column', overflowY: 'auto', zIndex: 9999 }}
          >
            <div className="mobile-nav-header">
              <span className="topbar-brand">PROPERTYLENS</span>
              <button className="mobile-nav-close" onClick={() => setNavOpen(false)} aria-label="Close menu">&#215;</button>
            </div>
            {NAV_LINKS.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} onClick={() => setNavOpen(false)}>{label}</NavLink>
            ))}
          </nav>
        </>
      )}
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/properties" element={<Properties />} />
          <Route path="/tenants" element={<Tenants />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/categorization-rules" element={<CategorizationRules />} />
          <Route path="/merchant-rules" element={<MerchantRules />} />
          <Route path="/review" element={<ReviewClassifications />} />
          <Route path="/predictions" element={<Predictions />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>
    </div>
  );
}

function AppRouter() {
  const { authenticated } = useAuth();

  // While checking auth status, show nothing to avoid flash
  if (authenticated === null) {
    return (
      <div style={{ minHeight: '100vh', background: '#FAFAFA' }} />
    );
  }

  if (!authenticated) {
    return <Login />;
  }

  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </AuthProvider>
  );
}
