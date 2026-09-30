// Single source of truth for the backend origin, shared by lib/api.ts and
// lib/auth.ts.
//
// NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so
// this must be set in the deploy environment (Vercel project settings)
// before the build runs — next.config.ts fails production builds without it,
// which is what keeps the localhost fallback below dev-only in practice.
const DEV_FALLBACK = "http://localhost:8000";

// `||` (not `??`) so an empty-string value falls back too; trailing slashes
// stripped so "https://api.example.com/" doesn't produce "//research".
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || DEV_FALLBACK).replace(
  /\/+$/,
  ""
);
