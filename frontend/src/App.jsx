import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
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

function TopBar() {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });
  return (
    <div className="topbar">
      <span className="topbar-brand">PROPERTYLENS</span>
      <span className="topbar-meta">{dateStr}</span>
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <div className="app">
      <TopBar />
      <nav className="sidebar">
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/properties">Properties</NavLink>
        <NavLink to="/tenants">Tenants</NavLink>
        <NavLink to="/transactions">Transactions</NavLink>
        <NavLink to="/categorization-rules">Rules</NavLink>
        <NavLink to="/merchant-rules">Merchant Rules</NavLink>
        <NavLink to="/review">Review</NavLink>
        <NavLink to="/predictions">Predictions</NavLink>
        <NavLink to="/reports">Reports</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
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
          {/* Catch-all: stay on whatever route was requested */}
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
