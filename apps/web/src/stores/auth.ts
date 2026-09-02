import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchSetupStatus, logoutSession } from '../api/client';

export interface AuthUser {
  id: string;
  account?: string;
  displayName?: string;
  role?: string;
}

export interface AuthWorkspace {
  id: string;
  name?: string;
}

interface JwtPayload {
  uid?: string;
  wid?: string;
  role?: string;
  exp?: number;
}

/**
 * Decodes a JWT payload without verifying the signature. Used to decide
 * whether a token is worth restoring into the in-memory auth state. The
 * server is still the source of truth — any 401 response will trigger the
 * axios interceptor to refresh or redirect to /login.
 */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const decoded = atob(parts[1]);
    const payload = JSON.parse(decoded) as JwtPayload;
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function isExpired(payload: JwtPayload, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (typeof payload.exp !== 'number') return false;
  return payload.exp <= nowSec;
}

export const useAuthStore = defineStore('auth', () => {
  const initialized = ref<boolean | null>(null);
  const user = ref<AuthUser | null>(null);
  const workspace = ref<AuthWorkspace | null>(null);

  async function checkSetupStatus() {
    try {
      const res = await fetchSetupStatus();
      initialized.value = res.data.initialized;
    } catch {
      initialized.value = false;
    }
  }

  function setAuth(data: { accessToken: string; refreshToken: string; user: any; workspace: any }) {
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    user.value = data.user;
    workspace.value = data.workspace;
  }

  /**
   * KI-009: on page reload, the in-memory user/workspace is gone even though
   * the access/refresh tokens are still in localStorage. This method decodes
   * the JWT payload (no signature check — server is the source of truth) and
   * rehydrates user/workspace so the UI does not flash to a logged-out state.
   * It is a no-op when no token is stored, the token is malformed, the
   * payload has no uid, or the token has already expired.
   */
  function restoreSession(): boolean {
    const token = localStorage.getItem('accessToken');
    if (!token) return false;

    const payload = decodeJwtPayload(token);
    if (!payload || !payload.uid) return false;
    if (isExpired(payload)) {
      // Expired token: clear it so subsequent refresh attempts start clean.
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      return false;
    }

    user.value = {
      id: payload.uid,
      role: payload.role || 'VIEWER',
    };
    if (payload.wid) {
      workspace.value = { id: payload.wid };
    }
    return true;
  }

  function logout() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) void logoutSession(refreshToken).catch(() => undefined);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    user.value = null;
    workspace.value = null;
    window.location.hash = '#/login';
  }

  return { initialized, user, workspace, checkSetupStatus, setAuth, logout, restoreSession };
});
