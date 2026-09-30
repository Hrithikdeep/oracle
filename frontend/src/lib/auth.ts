import { API_BASE_URL } from "./config";

// Token storage for the app's single demo login (see backend/auth.py).
//
// Stored in localStorage rather than an httpOnly cookie: this is a
// client-side Next.js app talking to a separate FastAPI origin, there's one
// shared demo credential (not real per-user data), and a cookie-based flow
// would need the backend to set/read cross-origin cookies for no real
// security benefit here. localStorage is the pragmatic choice for this scope.
const TOKEN_KEY = "oracle_auth_token";

// Real demo credentials for this single-login demo app — not a secret (see
// the matching comment in backend/auth.py). Shown on the login page itself
// so a visitor never has to guess them.
export const DEMO_EMAIL = "system@oracle.local";
export const DEMO_PASSWORD = "oracle-demo-2026";


export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

export interface AuthUser {
  id: string;
  email: string;
}

/** Reads the current user's id/email straight out of the JWT payload — the
 * token is the only place this app has that info client-side (the login
 * response itself carries no user fields, see LoginResponse in
 * backend/api/auth.py, and there's no /users/me endpoint). No signature
 * verification here; that's the backend's job on every real request — this
 * is purely for display. */
export function getCurrentUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;

  try {
    const payloadSegment = token.split(".")[1];
    const json = atob(payloadSegment.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { sub?: string; email?: string };
    if (!payload.sub || !payload.email) return null;
    return { id: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export type LoginResult = { ok: true } | { ok: false; message: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }

  if (!res.ok) {
    if (res.status === 401) {
      return { ok: false, message: "Invalid email or password." };
    }
    return { ok: false, message: `Request failed (HTTP ${res.status}).` };
  }

  const data = (await res.json()) as { access_token: string };
  setToken(data.access_token);
  return { ok: true };
}

export function logout(): void {
  clearToken();
}

// Called from api.ts whenever a request comes back 401: the stored token is
// gone (never existed), invalid, or expired (ACCESS_TOKEN_EXPIRE_HOURS = 24
// in backend/auth.py) — most commonly a tab left open, or the backend
// restarting with the same JWT_SECRET but the browser holding a token for a
// user row a DB reset removed. AuthGuard alone doesn't catch this: it only
// checks token *presence* on mount, so a present-but-dead token lets the
// shell render and every data call then fails with its own inline error
// (see the Home page's per-section fetches). This clears the dead token and
// sends the user back to /login instead of leaving each section to fail
// silently on its own.
let redirectingToLogin = false;

export function handleUnauthorized(): void {
  clearToken();
  if (typeof window === "undefined" || redirectingToLogin) return;
  if (window.location.pathname === "/login") return;
  redirectingToLogin = true;
  window.location.href = "/login";
}
