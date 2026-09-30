import path from "path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const nextConfig: NextConfig = {
  // Pin the workspace root to this directory — without this, Turbopack walks
  // up and finds an unrelated package-lock.json in the user's home directory,
  // causing a root-ambiguity warning.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default function config(phase: string): NextConfig {
  // NEXT_PUBLIC_* values are inlined into the client bundle at build time.
  // Without this, a production build with the variable unset would succeed
  // and quietly ship lib/config.ts's localhost dev fallback to real users,
  // whose browsers would then fail every API call.
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.NEXT_PUBLIC_API_BASE_URL) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not set. Production builds need the deployed backend's " +
        "public https URL (e.g. https://your-service.up.railway.app) — see frontend/.env.example."
    );
  }
  return nextConfig;
}
