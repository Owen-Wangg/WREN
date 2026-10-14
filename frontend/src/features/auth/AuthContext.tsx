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
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { authService } from './defaultAuthService';
import type { AuthSession } from './authService';

import type { Role } from '@wren/types';

const ROLE_OVERRIDE_KEY = 'wren_role_override';

const ROLE_PRIORITY: Role[] = ['TechnicalAdmin', 'DepartmentAdmin', 'Student'];

const authUserSchema = z.object({
  userId: z.string().min(1),
  email: z.string().min(1),
  firstName: z.string().nullish().transform((value) => value ?? ''),
  lastName: z.string().nullish().transform((value) => value ?? ''),
  roles: z.array(z.enum(['Student', 'DepartmentAdmin', 'TechnicalAdmin'])),
  administeredDepartmentIds: z.array(z.string().min(1)).optional().default([]),
});

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

function highestRole(roles: Role[]): Role {
  return ROLE_PRIORITY.find(r => roles.includes(r)) ?? 'Student';
}

export interface AuthUser {
  readonly userId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
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
  /**
   * Re-fetch `/v1/auth/me` so role / department-admin appointments made after
   * sign-in are reflected without a full reload. Keeps the current user on
   * transient failures.
   */
  readonly refreshUser: () => Promise<void>;
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
  // AuthProvider renders inside QueryClientProvider (see AppProviders.tsx), so
  // this is the shared app-lifetime client. Clearing it at every identity
  // boundary prevents one user's cached drafts/debriefs/metadata from being
  // served to the next user on a shared browser tab.
  const queryClient = useQueryClient();

  // Restore session and fetch user from DATABASE on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        // Ask Cognito for the current session rather than trusting the copied
        // access token in localStorage. getSession validates and refreshes it.
        const accessToken = await authService.getAccessToken();
        if (accessToken) {
          // CRITICAL: Fetch user identity from DATABASE with the current token.
          const userFromDb = await fetchUserIdentity(apiBaseUrl, accessToken);
          if (userFromDb) {
            setUser(userFromDb);
            setIsAuthenticated(true);
          } else {
            authService.signOut();
            queryClient.clear();
          }
        } else {
          setSession(null);
        }
      } catch (error) {
        console.error('Session restore failed:', error);
        authService.signOut();
        queryClient.clear();
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, [apiBaseUrl, queryClient]);

  const signIn = async (email: string, password: string) => {
    // Drop any cached data from a prior identity before establishing a new one,
    // so a sign-in without a preceding explicit sign-out never surfaces the
    // previous user's cached drafts/debriefs/metadata.
    queryClient.clear();

    // Step 1: Cognito authenticates
    const session = await authService.signIn({ email, password });
    setSession(session);

    // Step 2: CRITICAL - Fetch user identity from DATABASE
    const userFromDb = await fetchUserIdentity(apiBaseUrl, session.accessToken);

    if (userFromDb) {
      setUser(userFromDb);
      setIsAuthenticated(true);
      // Clear any stale persona override so login always starts at the highest role.
      setRoleOverride(null);
      try {
        localStorage.removeItem(ROLE_OVERRIDE_KEY);
      } catch {
        // ignore
      }
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
    // Purge all cached server state so the departing user's drafts/debriefs/
    // metadata cannot be served to the next user on a shared tab.
    queryClient.clear();
  };

  const getAccessToken = async (): Promise<string | null> => {
    return authService.getAccessToken();
  };

  const refreshUser = useCallback(async (): Promise<void> => {
    try {
      const accessToken = await authService.getAccessToken();
      if (!accessToken) return;
      const userFromDb = await fetchUserIdentity(apiBaseUrl, accessToken);
      if (!userFromDb) return;
      // Only swap the object when something changed, so consumers that
      // depend on `user` identity do not re-render on every refresh.
      setUser((prev) =>
        prev && JSON.stringify(prev) === JSON.stringify(userFromDb) ? prev : userFromDb,
      );
    } catch (error) {
      console.error('Failed to refresh user identity:', error);
    }
  }, [apiBaseUrl]);

  // Roles and department-admin appointments can change while the tab is open
  // (e.g. a System Admin appoints this user). Re-sync when the tab regains focus.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshUser();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, refreshUser]);

  const dbRoles = user?.roles ?? [];
  // Ignore a stale localStorage override that is not actually assigned.
  const effectiveOverride =
    roleOverride && dbRoles.includes(roleOverride) ? roleOverride : null;
  const activeRole: Role = effectiveOverride ?? highestRole(dbRoles);

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
    refreshUser,
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

    const data: unknown = await response.json();
    const result = authUserSchema.safeParse(data);
    if (!result.success) {
      console.error('Invalid user response from /v1/auth/me:', result.error.issues);
      return null;
    }

    return result.data;
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
