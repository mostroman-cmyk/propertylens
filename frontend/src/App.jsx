import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Properties from './pages/Properties';
import Tenants from './pages/Tenants';
import Transactions from './pages/Transactions';
import CategorizationRules from './pages/CategorizationRules';
import ReviewClassifications from './pages/ReviewClassifications';
import Predictions from './pages/Predictions';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
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

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <TopBar />
        <nav className="sidebar">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/properties">Properties</NavLink>
          <NavLink to="/tenants">Tenants</NavLink>
          <NavLink to="/transactions">Transactions</NavLink>
          <NavLink to="/categorization-rules">Rules</NavLink>
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
            <Route path="/review" element={<ReviewClassifications />} />
            <Route path="/predictions" element={<Predictions />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
