import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
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

const NAV_ITEMS = [
  { path: '/',                     label: 'Dashboard' },
  { path: '/properties',           label: 'Properties' },
  { path: '/tenants',              label: 'Tenants' },
  { path: '/transactions',         label: 'Transactions' },
  { path: '/categorization-rules', label: 'Rules' },
  { path: '/merchant-rules',       label: 'Merchant Rules' },
  { path: '/review',               label: 'Review' },
  { path: '/predictions',          label: 'Predictions' },
  { path: '/reports',              label: 'Reports' },
  { path: '/settings',             label: 'Settings' },
];

function AuthenticatedApp() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const location = useLocation();
  const { logout } = useAuth();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* TOP BAR */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        height: 44,
        borderBottom: '1px solid #E5E5E5',
        background: 'white',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        {isMobile && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(prev => !prev); }}
            style={{
              display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5,
              width: 44, height: 44, padding: 11, marginLeft: -11, marginRight: 4,
              background: 'transparent', border: 'none', cursor: 'pointer',
              WebkitTapHighlightColor: 'rgba(0,0,0,0.1)', flexShrink: 0,
            }}
            aria-label="Open menu"
          >
            <span style={{ display: 'block', width: 22, height: 2, background: '#000', borderRadius: 1 }} />
            <span style={{ display: 'block', width: 22, height: 2, background: '#000', borderRadius: 1 }} />
            <span style={{ display: 'block', width: 22, height: 2, background: '#000', borderRadius: 1 }} />
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="18" height="18" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <defs>
              <clipPath id="rpg-house">
                <path d="M4 28 L32 8 L60 28 L60 56 L4 56Z"/>
              </clipPath>
            </defs>
            <rect x="0" y="0" width="21" height="64" fill="#E30613" clipPath="url(#rpg-house)"/>
            <rect x="21" y="0" width="22" height="64" fill="#6B3FA0" clipPath="url(#rpg-house)"/>
            <rect x="43" y="0" width="21" height="64" fill="#2D7A3E" clipPath="url(#rpg-house)"/>
            <rect x="26" y="40" width="12" height="16" fill="#fff"/>
            <rect x="9" y="32" width="11" height="11" rx="1" fill="#fff"/>
            <rect x="44" y="32" width="11" height="11" rx="1" fill="#fff"/>
          </svg>
          <span style={{ fontWeight: 700, letterSpacing: '0.18em', fontSize: 12 }}>REDPURPLEGREEN</span>
        </div>
        <div style={{ marginLeft: 'auto', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#666' }}>
          {formatDate(new Date(), 'header')}
        </div>
      </header>

      {/* MOBILE DRAWER + OVERLAY */}
      {isMobile && menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 9998,
            }}
          />
          <nav style={{
            position: 'fixed', top: 0, left: 0,
            width: 'min(280px, 85vw)',
            height: '100vh',
            background: 'white',
            zIndex: 9999,
            boxShadow: '2px 0 16px rgba(0,0,0,0.18)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 12px 0 24px', height: 56, borderBottom: '1px solid #E5E5E5',
              flexShrink: 0,
            }}>
              <div style={{ fontWeight: 700, letterSpacing: '0.18em', fontSize: 11 }}>REDPURPLEGREEN</div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 44, height: 44,
                  background: 'none', border: 'none', fontSize: 26, cursor: 'pointer',
                  color: '#333', lineHeight: 1, flexShrink: 0,
                }}
                aria-label="Close menu"
              >
                ×
              </button>
            </div>

            {/* Nav items */}
            <div style={{ flex: 1 }}>
              {NAV_ITEMS.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 24px',
                    minHeight: 52,
                    color: isActive(item.path) ? '#000' : '#444',
                    fontWeight: isActive(item.path) ? 600 : 400,
                    textDecoration: 'none',
                    borderLeft: `3px solid ${isActive(item.path) ? '#000' : 'transparent'}`,
                    borderBottom: '1px solid #F0F0F0',
                    fontSize: 15,
                    letterSpacing: '0.01em',
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Logout */}
            <div style={{ borderTop: '1px solid #E5E5E5', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); logout(); }}
                style={{
                  display: 'flex', alignItems: 'center',
                  width: '100%', padding: '0 24px', minHeight: 52,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#E30613', fontWeight: 500, fontSize: 15,
                  letterSpacing: '0.01em', textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                Log Out
              </button>
            </div>
          </nav>
        </>
      )}

      {/* MAIN LAYOUT */}
      <div style={{ display: 'flex' }}>
        {/* DESKTOP SIDEBAR */}
        {!isMobile && (
          <aside style={{
            width: 200,
            borderRight: '1px solid #E5E5E5',
            padding: '24px 0',
            minHeight: 'calc(100vh - 44px)',
            flexShrink: 0,
            position: 'sticky',
            top: 44,
            alignSelf: 'flex-start',
            height: 'calc(100vh - 44px)',
            overflowY: 'auto',
          }}>
            {NAV_ITEMS.map(item => (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  display: 'block',
                  padding: '7px 24px',
                  color: isActive(item.path) ? '#000' : '#666',
                  fontWeight: isActive(item.path) ? 600 : 400,
                  textDecoration: 'none',
                  fontSize: 13,
                  borderLeft: `2px solid ${isActive(item.path) ? '#000' : 'transparent'}`,
                }}
              >
                {item.label}
              </Link>
            ))}
          </aside>
        )}

        {/* MAIN CONTENT */}
        <main style={{ flex: 1, padding: isMobile ? '16px 14px' : 32, maxWidth: 1400, overflowY: 'auto' }}>
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
    </div>
  );
}

function AppRouter() {
  const { authenticated } = useAuth();

  if (authenticated === null) {
    return <div style={{ minHeight: '100vh', background: '#FAFAFA' }} />;
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
