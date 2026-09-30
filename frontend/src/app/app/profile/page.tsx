"use client";

import { useEffect, useState } from "react";
import { UserCircle } from "lucide-react";
import { SettingsTabBar } from "@/components/settings/SettingsTabBar";
import { getCurrentUser } from "@/lib/auth";

// There's still no /users/me endpoint and the JWT payload only carries
// {sub, email} (see backend/auth.py:create_access_token) — no "name" claim.
// Rather than hardcode a display name, derive one from the real session's
// email so this stays correct if the underlying account's email ever
// changes, instead of silently drifting from it like the old constant did.
function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0];
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

export default function ProfilePage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(getCurrentUser()?.email ?? null);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-3xl font-semibold text-text-primary">Settings</h1>
      <p className="mt-2 text-sm text-text-muted">
        Manage your profile and workspace preferences.
      </p>

      <div className="mt-6">
        <SettingsTabBar />
      </div>

      <div className="mt-6 max-w-lg rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-border">
            <UserCircle className="h-6 w-6 text-text-muted" />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {email ? displayNameFromEmail(email) : "—"}
            </p>
            <p className="text-xs text-text-muted">{email ?? "Not signed in"}</p>
          </div>
        </div>

        <p className="mt-4 text-xs text-text-muted">
          Multi-user accounts and team management are coming in a future release. Every research
          session in this workspace currently runs as this single account — there&apos;s no
          per-person identity yet, and nothing here is editable.
        </p>
      </div>
    </div>
  );
}
