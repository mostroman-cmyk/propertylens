import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, checkAuth, logout as apiLogout } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // null = checking, true = authenticated, false = not authenticated
  const [authenticated, setAuthenticated] = useState(null);

  useEffect(() => {
    checkAuth()
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
  }, []);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch {}
    setAuthenticated(false);
  }, []);

  // Axios interceptor: redirect to login on any 401
  useEffect(() => {
    const id = api.interceptors.response.use(
      res => res,
      err => {
        if (err.response?.status === 401) {
          setAuthenticated(false);
        }
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, setAuthenticated, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
