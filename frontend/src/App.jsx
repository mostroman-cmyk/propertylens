import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Properties from './pages/Properties';
import Tenants from './pages/Tenants';
import Transactions from './pages/Transactions';
import CategorizationRules from './pages/CategorizationRules';
import Settings from './pages/Settings';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <nav className="sidebar">
          <div className="logo">PropertyLens</div>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/properties">Properties</NavLink>
          <NavLink to="/tenants">Tenants</NavLink>
          <NavLink to="/transactions">Transactions</NavLink>
          <NavLink to="/categorization-rules">Rules</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/properties" element={<Properties />} />
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/categorization-rules" element={<CategorizationRules />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
