"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { DEMO_EMAIL, DEMO_PASSWORD, isAuthenticated, login } from "@/lib/auth";
import { cn } from "@/lib/utils";

function DisabledAction({
  label,
  tooltip,
  className,
}: {
  label: string;
  tooltip: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-disabled="true"
        className={cn(buttonVariants({ variant: "outline" }), "cursor-not-allowed opacity-60", className)}
      >
        {label}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already-authenticated visitor landing on /login should go straight to
  // the app, not see the form again.
  useEffect(() => {
    if (isAuthenticated()) router.replace("/app");
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await login(email, password);
    if (result.ok) {
      router.replace("/app");
    } else {
      setError(result.message);
      setSubmitting(false);
    }
  }

  function fillDemoCredentials() {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="flex min-h-screen">
      {/* Left: brand panel */}
      <div className="relative hidden flex-1 flex-col justify-between border-r border-border bg-surface p-10 lg:flex">
        <div className="flex items-center gap-2 text-text-primary">
          <Sparkles className="h-5 w-5" />
          <span className="text-sm font-bold tracking-wide">ORACLE</span>
        </div>

        <div className="max-w-md">
          <p className="font-mono-label">PRIVATE INTELLIGENCE</p>
          <h1 className="mt-3 text-3xl font-semibold text-text-primary">
            Private AI for financial intelligence.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-text-muted">
            Research, analysis, risk and reporting for your organization — grounded in your own
            documents and institutional knowledge.
          </p>
        </div>

        <p className="text-xs text-text-muted">Your workspace is protected by access controls.</p>
      </div>

      {/* Right: sign-in form */}
      <div className="relative flex flex-1 flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="absolute top-6 right-6">
          <ThemeToggle />
        </div>

        {/* Wordmark shown in place of the brand panel on small screens */}
        <div className="mb-10 flex items-center gap-2 text-text-primary lg:hidden">
          <Sparkles className="h-5 w-5" />
          <span className="text-sm font-bold tracking-wide">ORACLE</span>
        </div>

        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-text-primary">Sign in to your workspace</h2>
          <p className="mt-2 text-sm text-text-muted">
            Enter your credentials to access your organization&apos;s research.
          </p>

          <div className="mt-6 rounded-lg border border-dashed border-border bg-surface p-3">
            <p className="font-mono-label">DEMO ACCESS</p>
            <p className="mt-1.5 font-mono text-xs text-text-muted">
              {DEMO_EMAIL} · {DEMO_PASSWORD}
            </p>
            <button
              type="button"
              onClick={fillDemoCredentials}
              className="mt-2 text-xs font-medium text-text-primary underline underline-offset-2 hover:text-text-muted"
            >
              Fill demo credentials
            </button>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="text-sm font-medium text-text-primary">
                Work email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                placeholder="system@oracle.local"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 h-10"
              />
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium text-text-primary">
                Password
              </label>
              <div className="relative mt-1.5">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-text-muted transition-colors hover:text-text-primary"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button type="submit" disabled={submitting} className="h-10 w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-muted">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <DisabledAction
            label="Continue with Google"
            tooltip="Not available in this demo — single shared login only."
            className="mt-4 h-10 w-full"
          />

          <div className="mt-6 flex items-center justify-between">
            <DisabledAction
              label="Forgot password?"
              tooltip="Not available — this demo uses one shared login."
              className="h-7 border-none bg-transparent px-0 text-xs underline underline-offset-2 hover:bg-transparent"
            />
            <DisabledAction
              label="Create account"
              tooltip="Not available — this is a single-account demo."
              className="h-7 border-none bg-transparent px-0 text-xs underline underline-offset-2 hover:bg-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
