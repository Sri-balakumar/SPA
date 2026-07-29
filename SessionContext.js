// Shared auth store: logged-in flag + the current user (from Odoo session_info).
// Kept in memory for the session; a Logout deep in the app can flip it back to login.
import React, { createContext, useContext, useState } from 'react';
import { odooLogout } from './odoo';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState(null);   // session_info: { uid, name, username, db, ... }

  // Log in: remember the user and flip into the app.
  function login(sessionInfo) {
    setUser(sessionInfo || null);
    setLoggedIn(true);
  }

  // Log out of the CURRENT session, but KEEP the device set up: the saved staff
  // login and the device registration stay, so re-opening the app on this same
  // (registered) device auto-logs-in and goes straight to the spa page — no login,
  // no QR again. (A full reset is the long-press-logo "Device reset" on the login screen.)
  function logout() {
    odooLogout();
    setUser(null);
    setLoggedIn(false);
  }

  return (
    <SessionContext.Provider value={{ loggedIn, user, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
