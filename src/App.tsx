import { useState } from 'react';
import { LocaleProvider } from './i18n/LocaleContext';
import { AuthPortal } from './components/AuthPortal';
import { InvestorPortal } from './components/InvestorPortal';
import { TraderPortal } from './components/TraderPortal';
import { AdminPortal } from './components/AdminPortal';
import { apiFetch, setAuthToken } from './lib/api';
import type { User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);

  const handleAuthenticated = (token: string, authenticatedUser: User) => {
    setAuthToken(token);
    setUser(authenticatedUser);
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore error on logout
    }
    setAuthToken(null);
    setUser(null);
  };

  return (
    <LocaleProvider
      initialCountry={user?.country}
      initialLang={user?.preferred_language}
    >
      {!user ? (
        <AuthPortal onAuthenticated={handleAuthenticated} />
      ) : user.role === 'admin' ? (
        <AdminPortal user={user} onLogout={handleLogout} onUserRefresh={setUser} />
      ) : user.role === 'trader' ? (
        <TraderPortal user={user} onLogout={handleLogout} onUserRefresh={setUser} />
      ) : (
        <InvestorPortal
          user={user}
          onLogout={handleLogout}
          onUserRefresh={(updated) => setUser(updated)}
        />
      )}
    </LocaleProvider>
  );
}
