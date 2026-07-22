/**
 * AuthContext - Complete Implementation
 *
 * CRITICAL ARCHITECTURE:
 * - Cognito: Identity provider (proves who you are)
 * - Database: Source of truth for roles (what you can do)
 *
 * Flow:
 * 1. User signs in with Cognito
 * 2. Frontend calls GET /v1/auth/me with JWT
 * 3. Backend queries DATABASE for user roles
 * 4. Frontend stores roles from DATABASE (never trusts JWT claims)
 * 5. useAuthorization hooks use DATABASE roles
 * 6. Every API call re-checks database permissions
 *
 * Additionally, a client-side `activeRole` override lets testers switch the
 * persona UI (Student / Department Admin / System Admin) without changing DB
 * assignments. Route guards use database roles; RoleContext uses `activeRole`.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { authService } from './defaultAuthService';
import type { AuthSession } from './authService';

import type { Role } from '@wren/types';

const ROLE_OVERRIDE_KEY = 'wren_role_override';

function readStoredRoleOverride(): Role | null {
  try {
    const raw = localStorage.getItem(ROLE_OVERRIDE_KEY);
    if (raw === 'Student' || raw === 'DepartmentAdmin' || raw === 'TechnicalAdmin') {
      return raw;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export interface AuthUser {
  readonly userId: string;
  readonly email: string;
  /** Roles from DATABASE (never from JWT). Used for route access & APIs. */
  readonly roles: Array<'Student' | 'DepartmentAdmin' | 'TechnicalAdmin'>;
  /** Administered departments from DATABASE */
  readonly administeredDepartmentIds: string[];
}

export interface AuthContextValue {
  readonly isLoading: boolean;
  readonly isAuthenticated: boolean;
  readonly user: AuthUser | null;
  readonly session: AuthSession | null;
  /** Roles returned by `/v1/auth/me` (database), ignoring view-as. */
  readonly dbRoles: Role[];
  /**
   * Persona currently shown in the UI (Profile "view as"). Does not change
   * Cognito/DB roles or route allow-lists — only navigation / RoleContext.
   */
  readonly activeRole: Role;
  /** Client-side persona switch for demos/testing. */
  readonly setActiveRole: (role: Role) => void;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  readonly children: React.ReactNode;
  readonly apiBaseUrl: string;
}

export function AuthProvider({ children, apiBaseUrl }: AuthProviderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [roleOverride, setRoleOverride] = useState<Role | null>(() => readStoredRoleOverride());

  // Restore session and fetch user from DATABASE on mount
  useEffect(() => {
    const restoreSession = async () => {
      const stored = localStorage.getItem('cognito_session');
      if (stored) {
        try {
          const session = JSON.parse(stored) as AuthSession;
          setSession(session);

          // CRITICAL: Fetch user identity from DATABASE
          const userFromDb = await fetchUserIdentity(apiBaseUrl, session.accessToken);
          if (userFromDb) {
            setUser(userFromDb);
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem('cognito_session');
          }
        } catch (error) {
          console.error('Session restore failed:', error);
          localStorage.removeItem('cognito_session');
        }
      }
      setIsLoading(false);
    };

    restoreSession();
  }, [apiBaseUrl]);

  const signIn = async (email: string, password: string) => {
    // Step 1: Cognito authenticates
    const session = await authService.signIn({ email, password });
    setSession(session);

    // Step 2: CRITICAL - Fetch user identity from DATABASE
    const userFromDb = await fetchUserIdentity(apiBaseUrl, session.accessToken);

    if (userFromDb) {
      setUser(userFromDb);
      setIsAuthenticated(true);
    } else {
      authService.signOut();
      throw new Error('Failed to load user identity from database');
    }
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    await authService.signUp({ email, password, firstName, lastName });
  };

  const signOut = async () => {
    authService.signOut();
    setSession(null);
    setUser(null);
    setIsAuthenticated(false);
    setRoleOverride(null);
    try {
      localStorage.removeItem(ROLE_OVERRIDE_KEY);
    } catch {
      // ignore
    }
  };

  const getAccessToken = async (): Promise<string | null> => {
    return authService.getAccessToken();
  };

  const dbRoles = user?.roles ?? [];
  // Ignore a stale localStorage override that is not actually assigned.
  const effectiveOverride =
    roleOverride && dbRoles.includes(roleOverride) ? roleOverride : null;
  const activeRole: Role = effectiveOverride ?? dbRoles[0] ?? 'Student';

  const setActiveRole = (role: Role) => {
    if (user && !user.roles.includes(role)) {
      return;
    }
    setRoleOverride(role);
    try {
      localStorage.setItem(ROLE_OVERRIDE_KEY, role);
    } catch {
      // ignore
    }
  };

  const value: AuthContextValue = {
    isLoading,
    isAuthenticated,
    // Keep full DB roles on `user` so route guards do not kick you to `/`
    // when switching "view as" while still on an admin URL.
    user,
    session,
    dbRoles,
    activeRole,
    setActiveRole,
    signIn,
    signUp,
    signOut,
    getAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Fetch user identity from DATABASE (not from JWT)
 *
 * CRITICAL: Calls /v1/auth/me which queries database for roles
 * This ensures database is always the source of truth
 */
async function fetchUserIdentity(apiBaseUrl: string, accessToken: string): Promise<AuthUser | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch user identity:', response.status);
      return null;
    }

    const data = await response.json();

    // Validate response
    if (!data.userId || !Array.isArray(data.roles)) {
      console.error('Invalid user response from /v1/auth/me:', data);
      return null;
    }

    return {
      userId: data.userId,
      email: data.email,
      roles: data.roles,
      administeredDepartmentIds: data.administeredDepartmentIds || [],
    };
  } catch (error) {
    console.error('Failed to fetch user identity:', error);
    return null;
  }
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
