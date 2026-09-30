import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsTabBar } from "@/components/settings/SettingsTabBar";

// Same hardcoded values WorkspaceSwitcher.tsx already shows in the topbar —
// there's no Organization model or workspace-settings endpoint in the
// backend, so this mirrors that existing constant rather than inventing a
// different name/description for the same workspace.
const WORKSPACE = {
  name: "Acme Capital",
  tagline: "Investment Intelligence",
};

export default function OrganizationPage() {
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
            <Building2 className="h-6 w-6 text-text-muted" />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">{WORKSPACE.name}</p>
            <p className="text-xs text-text-muted">{WORKSPACE.tagline}</p>
          </div>
        </div>

        <p className="mt-4 text-xs text-text-muted">
          This is the single workspace shown in the switcher at the top of the app — there&apos;s
          no Organization model in the backend yet, so nothing below is configurable.
        </p>

        <div className="mt-4">
          <Button
            variant="outline"
            disabled
            title="Coming soon — no workspace-settings endpoint exists yet."
            className="disabled:cursor-not-allowed"
          >
            Save Changes
          </Button>
        </div>
      </div>

      <div className="mt-4 max-w-lg rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-text-primary">Team members</p>
        <p className="mt-1 text-xs text-text-muted">
          Coming soon. This workspace currently supports a single user — there&apos;s no
          multi-user or invite system in the backend yet.
        </p>
      </div>
    </div>
  );
}
