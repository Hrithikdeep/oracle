"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutGrid,
  ArrowRight,
  ChevronRight,
  Search,
  ShieldAlert,
  BarChart3,
  BookOpen,
  FileText,
  Target,
  FileCheck,
  Fingerprint,
  Table2,
  CheckCircle,
  Lock,
  ShieldCheck,
  Network,
  Briefcase,
  ScanSearch,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { isAuthenticated } from "@/lib/auth";
import { cn } from "@/lib/utils";

const CARD_HOVER = "transition-all hover:-translate-y-0.5 hover:border-text-muted/50";

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

const RISK_BADGE_CLASSES: Record<string, string> = {
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  orange: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
};

function RiskRow({ label, level, color }: { label: string; level: string; color: keyof typeof RISK_BADGE_CLASSES }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <span className="text-xs text-text-primary">{label}</span>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", RISK_BADGE_CLASSES[color])}>
        {level}
      </span>
    </div>
  );
}

function EvidenceChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] text-text-muted">
      {children}
    </span>
  );
}

function IconBox({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-background",
        className
      )}
    >
      <Icon className="h-5 w-5 text-text-primary" />
    </div>
  );
}

function NumberTag({ n }: { n: string }) {
  return <span className="font-mono text-xs text-text-muted">{n}</span>;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono-label">{children}</p>;
}

// ---------------------------------------------------------------------------
// Hero product mockup — static illustrative content only, explicitly labeled
// as such below the CTAs ("Research workspace · illustrative interface").
// "Northstar Industries" is a fictional name, not one of the real seeded dev
// companies (Microsoft, Coca-Cola, etc.), kept out of marketing copy.
// ---------------------------------------------------------------------------

const MOCKUP_SIDEBAR_ITEMS: { icon: LucideIcon; label: string }[] = [
  { icon: Search, label: "Research" },
  { icon: FileText, label: "Documents" },
  { icon: BarChart3, label: "Analysis" },
  { icon: ShieldAlert, label: "Risk" },
  { icon: BookOpen, label: "Knowledge" },
];

const MOCKUP_METRICS = [
  { label: "Revenue", value: "$8.42B", delta: "+6.8%" },
  { label: "EBITDA", value: "$2.14B", delta: "+4.1%" },
  { label: "Net leverage", value: "2.7x", delta: "-0.2x" },
];

const MOCKUP_CHART_BARS = [38, 52, 61, 74, 88];
const MOCKUP_CHART_YEARS = ["FY20", "FY21", "FY22", "FY23", "FY24"];

const MOCKUP_TABLE_ROWS = [
  { metric: "Gross margin", fy23: "38.6%", fy24: "39.2%", variance: "+60bps", positive: true },
  { metric: "FCF conversion", fy23: "71%", fy24: "68%", variance: "-3.0pp", positive: false },
];

const MOCKUP_RISKS: { label: string; level: string; color: keyof typeof RISK_BADGE_CLASSES }[] = [
  { label: "Refinancing exposure", level: "Moderate", color: "amber" },
  { label: "Margin pressure", level: "Low", color: "emerald" },
  { label: "Customer concentration", level: "Watch", color: "orange" },
];

const MOCKUP_EVIDENCE = ["Annual Report 2024 — p. 68", "Q4 Earnings Transcript — p. 12", "Credit Agreement — § 7.04"];

// ---------------------------------------------------------------------------
// Section 2 problem diagram data
// ---------------------------------------------------------------------------

const INPUTS = [
  "Annual Reports",
  "Filings",
  "Research",
  "Internal Knowledge",
  "Financial Data",
  "Risk Information",
];

const OUTPUTS = ["Research", "Risk Intelligence", "Analysis", "Reports", "Dashboards", "Monitoring"];

// ---------------------------------------------------------------------------
// Section 3 platform overview
// ---------------------------------------------------------------------------

const FEATURES: {
  n: string;
  icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
  emphasized?: boolean;
}[] = [
  {
    n: "01",
    icon: Search,
    title: "Research",
    tagline: "Find. Retrieve. Verify.",
    description:
      "Search financial documents, filings and approved knowledge sources with evidence-backed answers and source references.",
  },
  {
    n: "02",
    icon: ShieldAlert,
    title: "Risk Intelligence",
    tagline: "Detect. Analyze. Explain.",
    description:
      "Identify financial risks, anomalies, trends and red flags with traceable supporting evidence.",
    emphasized: true,
  },
  {
    n: "03",
    icon: BarChart3,
    title: "Financial Analysis",
    tagline: "Calculate. Compare. Interpret.",
    description:
      "Transform financial metrics into structured analysis, comparisons and decision-ready insights.",
  },
  {
    n: "04",
    icon: BookOpen,
    title: "Institutional Knowledge",
    tagline: "Your firm's knowledge, organized.",
    description:
      "Bring investment theses, internal research, analyst notes, methodologies and institutional knowledge into a controlled AI workspace.",
  },
  {
    n: "05",
    icon: FileText,
    title: "Reporting",
    tagline: "From analysis to decision-ready reports.",
    description:
      "Generate professional research reports, investment memos, risk reports and executive summaries.",
  },
  {
    n: "06",
    icon: Target,
    title: "Monitoring",
    tagline: "Know what changed.",
    description:
      "Continuously compare new information with previous intelligence and surface material changes and emerging risks.",
  },
];

function FeatureCard({ n, icon, title, tagline, description, emphasized }: (typeof FEATURES)[number]) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border p-6",
        CARD_HOVER,
        emphasized ? "bg-surface" : "bg-background"
      )}
    >
      <div className="flex items-start justify-between">
        <IconBox icon={icon} />
        <NumberTag n={n} />
      </div>
      <h3 className="mt-5 text-base font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 text-sm text-text-muted italic">{tagline}</p>
      <p className="mt-3 text-sm leading-relaxed text-text-muted">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 4 how it works
// ---------------------------------------------------------------------------

const STEPS = [
  { n: "01", title: "Connect", desc: "Bring together documents, research and approved information sources." },
  { n: "02", title: "Understand", desc: "AI retrieves and organizes the evidence relevant to the task." },
  { n: "03", title: "Analyze", desc: "Research, financial analysis and risk intelligence work together." },
  { n: "04", title: "Synthesize", desc: "Turn verified evidence into clear decision-ready intelligence." },
  { n: "05", title: "Act", desc: "Use reports, dashboards and monitoring to support better decisions." },
];

// ---------------------------------------------------------------------------
// Section 5 evidence & control
// ---------------------------------------------------------------------------

const EVIDENCE_CARDS: { icon: LucideIcon; label: string; description: string }[] = [
  {
    icon: FileCheck,
    label: "Source-Grounded",
    description: "Answers are tied to the underlying evidence.",
  },
  {
    icon: Fingerprint,
    label: "Traceable",
    description: "Follow insights back to their source documents and pages.",
  },
  {
    icon: Table2,
    label: "Deterministic Financial Calculations",
    description:
      "Financial calculations should be computed using structured data and deterministic logic rather than relying on language-model arithmetic.",
  },
  {
    icon: CheckCircle,
    label: "Human Control",
    description: "AI supports professional judgment. It does not replace it.",
  },
];

function EvidenceCard({ icon, label, description }: (typeof EVIDENCE_CARDS)[number]) {
  return (
    <div className={cn("rounded-lg border border-border bg-background p-5", CARD_HOVER)}>
      <IconBox icon={icon} />
      <p className="mt-4 text-xs font-bold tracking-wide text-text-primary uppercase">{label}</p>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 6 private intelligence pillars
// ---------------------------------------------------------------------------

const PILLARS: { n: string; icon: LucideIcon; title: string }[] = [
  { n: "01", icon: Lock, title: "Private Data" },
  { n: "02", icon: ShieldCheck, title: "Controlled Access" },
  { n: "03", icon: Network, title: "Organization-Specific Intelligence" },
];

function PillarCard({ n, icon, title }: (typeof PILLARS)[number]) {
  return (
    <div className="rounded-lg border border-border bg-background p-6">
      <div className="flex items-start justify-between">
        <IconBox icon={icon} />
        <span className="font-mono text-xs text-text-muted">PILLAR {n}</span>
      </div>
      <h3 className="mt-6 text-base font-semibold text-text-primary">{title}</h3>
      <div className="mt-4 h-px w-full bg-border" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 7 use cases
// ---------------------------------------------------------------------------

const USE_CASES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Briefcase,
    title: "Investment Research",
    description: "Synthesize filings, research and evidence into structured investment insight.",
  },
  {
    icon: ScanSearch,
    title: "Due Diligence",
    description: "Review large evidence sets and surface material findings efficiently.",
  },
  {
    icon: ShieldAlert,
    title: "Risk Intelligence",
    description: "Trace risk signals, changes and supporting evidence across source material.",
  },
  {
    icon: TrendingUp,
    title: "Portfolio Intelligence",
    description: "Connect company-level intelligence to a broader portfolio view.",
  },
  {
    icon: BookOpen,
    title: "Institutional Knowledge",
    description: "Make approved internal research and methodology easier to retrieve and use.",
  },
  {
    icon: FileText,
    title: "Executive Reporting",
    description: "Turn validated analysis into concise, decision-ready communication.",
  },
];

function UseCaseCard({ icon, title, description }: (typeof USE_CASES)[number]) {
  return (
    <div className={cn("rounded-lg border border-border bg-background p-6", CARD_HOVER)}>
      <IconBox icon={icon} />
      <h3 className="mt-5 text-base font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 8 product evolution
// ---------------------------------------------------------------------------

const EVOLUTION_STEPS: { n: string; icon: LucideIcon; label: string }[] = [
  { n: "01", icon: Search, label: "Research" },
  { n: "02", icon: BarChart3, label: "Analysis" },
  { n: "03", icon: FileText, label: "Reports" },
  { n: "04", icon: Table2, label: "Interactive Dashboards" },
  { n: "05", icon: Target, label: "Continuous Monitoring" },
];

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

// None of these route anywhere real yet (no About/Security/Contact/Privacy/
// Terms pages exist) — rendered as static labels rather than dead links, same
// call as the top nav's non-anchored items.
const FOOTER_COLUMNS: { heading: string; items: string[] }[] = [
  {
    heading: "PLATFORM",
    items: ["Research", "Risk Intelligence", "Financial Analysis", "Knowledge", "Reporting", "Monitoring"],
  },
  {
    heading: "SOLUTIONS",
    items: ["Investment Research", "Due Diligence", "Portfolio Intelligence", "Financial Reporting"],
  },
  { heading: "COMPANY", items: ["About", "Research", "Security", "Contact"] },
  { heading: "LEGAL", items: ["Privacy", "Terms"] },
];

export default function RootPage() {
  const router = useRouter();

  // Matches the login page's own already-authenticated redirect — an
  // already-signed-in visitor shouldn't land on marketing copy.
  useEffect(() => {
    if (isAuthenticated()) router.replace("/app");
  }, [router]);

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 text-text-primary">
            <LayoutGrid className="h-5 w-5" />
            <span className="text-sm font-bold tracking-wide">ORACLE</span>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            <button
              type="button"
              onClick={() => scrollTo("platform")}
              className="text-sm text-text-muted transition-colors hover:text-text-primary"
            >
              Platform
            </button>
            <button
              type="button"
              onClick={() => scrollTo("solutions")}
              className="text-sm text-text-muted transition-colors hover:text-text-primary"
            >
              Solutions
            </button>
            <button
              type="button"
              onClick={() => scrollTo("security")}
              className="text-sm text-text-muted transition-colors hover:text-text-primary"
            >
              Security
            </button>
            {/* No dedicated sections exist for these — static labels, not
                dead links, same pattern as the footer below. */}
            <span className="text-sm text-text-muted">Research</span>
            <span className="text-sm text-text-muted">Company</span>
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="text-sm font-medium text-text-muted transition-colors hover:text-text-primary"
            >
              Sign in
            </Link>
            <Button render={<Link href="/login" />} nativeButton={false} size="sm">
              Request a Private Demo
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Section 1: Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
          <Eyebrow>Private AI for Financial Intelligence</Eyebrow>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-text-primary sm:text-5xl">
            The Intelligence Layer for Financial Institutions.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-text-muted">
            Private AI systems that transform financial research, risk analysis, institutional
            knowledge, and reporting into decision-ready intelligence.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button render={<Link href="/login" />} nativeButton={false} size="lg" className="h-11 px-6">
              Request a Private Demo
            </Button>
            <Button variant="outline" size="lg" className="h-11 px-6" onClick={() => scrollTo("platform")}>
              Explore the Platform
            </Button>
          </div>
          <p className="mt-4 text-xs text-text-muted">Research workspace · illustrative interface</p>

          {/* Product mockup — the hero's visual anchor */}
          <div className="mt-12 overflow-hidden rounded-xl border border-border bg-background text-left shadow-2xl">
            <div className="flex flex-col sm:flex-row">
              {/* Sidebar */}
              <div className="flex shrink-0 flex-col justify-between bg-[#0a0a0a] p-4 sm:w-52">
                <div>
                  <p className="text-xs font-medium text-white/50">Workspace 01</p>
                  <nav className="mt-6 space-y-1">
                    {MOCKUP_SIDEBAR_ITEMS.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-white/70"
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </div>
                    ))}
                  </nav>
                </div>
                <div className="mt-6 flex items-center gap-2 rounded-md bg-white/5 px-2.5 py-2 text-xs text-white/60 sm:mt-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Active research
                </div>
              </div>

              {/* Main panel */}
              <div className="flex-1 p-6 sm:p-8">
                <h3 className="text-lg font-semibold text-text-primary">
                  Northstar Industries · FY analysis
                </h3>
                <p className="mt-1 text-xs text-text-muted">
                  Evidence set updated from approved source documents · 12 sources indexed
                </p>

                {/* Metric cards */}
                <div className="mt-6 grid grid-cols-3 gap-3">
                  {MOCKUP_METRICS.map((metric) => (
                    <div key={metric.label} className="rounded-lg border border-border p-3">
                      <p className="text-xs text-text-muted">{metric.label}</p>
                      <p className="mt-1 text-lg font-semibold text-text-primary">{metric.value}</p>
                      <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        {metric.delta}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Mini chart */}
                <div className="mt-6 rounded-lg border border-border p-4">
                  <p className="text-xs text-text-muted">Operating trend FY20 — FY24</p>
                  <div className="mt-3 flex h-20 items-end gap-3">
                    {MOCKUP_CHART_BARS.map((h, i) => (
                      <div key={i} className="flex-1 rounded-t bg-text-primary/15" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                  <div className="mt-1.5 flex gap-3">
                    {MOCKUP_CHART_YEARS.map((year) => (
                      <span key={year} className="flex-1 text-center text-[10px] text-text-muted">
                        {year}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Table */}
                <div className="mt-6 overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-surface text-text-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Metric</th>
                        <th className="px-3 py-2 text-right font-medium">FY23</th>
                        <th className="px-3 py-2 text-right font-medium">FY24</th>
                        <th className="px-3 py-2 text-right font-medium">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MOCKUP_TABLE_ROWS.map((row) => (
                        <tr key={row.metric} className="border-t border-border">
                          <td className="px-3 py-2 text-text-primary">{row.metric}</td>
                          <td className="px-3 py-2 text-right text-text-muted">{row.fy23}</td>
                          <td className="px-3 py-2 text-right text-text-muted">{row.fy24}</td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right font-medium",
                              row.positive
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            )}
                          >
                            {row.variance}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Risk indicators */}
                <div className="mt-6">
                  <p className="text-xs font-semibold text-text-primary">Risk indicators</p>
                  <div className="mt-2 space-y-2">
                    {MOCKUP_RISKS.map((risk) => (
                      <RiskRow key={risk.label} {...risk} />
                    ))}
                  </div>
                </div>

                {/* Evidence references */}
                <div className="mt-6">
                  <p className="text-xs font-semibold text-text-primary">Evidence references</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MOCKUP_EVIDENCE.map((ref) => (
                      <EvidenceChip key={ref}>{ref}</EvidenceChip>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: The problem */}
        <section className="mx-auto max-w-6xl px-6 py-28">
          <h2 className="max-w-3xl text-4xl font-semibold tracking-tight text-text-primary sm:text-5xl">
            Financial intelligence is buried in information.
          </h2>
          <p className="mt-6 max-w-[32rem] text-base leading-relaxed text-text-muted">
            Annual reports, filings, research notes, internal documents, financial models and risk
            information create enormous amounts of information. The challenge is turning that
            information into reliable, decision-ready intelligence.
          </p>

          <div className="mt-16 grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_auto_1fr]">
            {/* Left: inputs */}
            <div className="grid grid-cols-2 gap-3">
              {INPUTS.map((label, i) => (
                <div key={label} className="rounded-lg border border-border bg-background p-4">
                  <NumberTag n={String(i + 1).padStart(2, "0")} />
                  <p className="mt-2 text-sm font-medium text-text-primary">{label}</p>
                </div>
              ))}
            </div>

            {/* Center: connector + intelligence layer node */}
            <div className="flex flex-col items-center gap-3 lg:flex-row lg:gap-0">
              <div className="hidden h-px w-10 bg-border lg:block" />
              <div className="flex w-48 flex-col items-center gap-2 rounded-lg border border-border bg-surface p-5 text-center">
                <IconBox icon={Network} />
                <p className="text-sm font-semibold text-text-primary">One Intelligence Layer</p>
              </div>
              <div className="hidden h-px w-10 bg-border lg:block" />
            </div>

            {/* Right: outputs */}
            <div className="flex flex-col gap-2">
              {OUTPUTS.map((label) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3"
                >
                  <span className="text-sm font-medium text-text-primary">{label}</span>
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 3: Platform overview */}
        <section id="platform" className="mx-auto max-w-6xl px-6 py-28">
          <h2 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
            One platform for financial intelligence.
          </h2>
          <p className="mt-4 max-w-xl text-base text-text-muted">
            From research to reporting, bring the entire intelligence workflow into one controlled
            environment.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <FeatureCard key={feature.n} {...feature} />
            ))}
          </div>
        </section>

        {/* Section 4: How it works */}
        <section className="border-t border-border bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-28">
            <h2 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
              From information to intelligence.
            </h2>

            {/* Desktop: horizontal timeline */}
            <div className="relative mt-20 hidden md:block">
              <div className="absolute top-1.5 right-0 left-0 h-px bg-border" />
              <div className="relative grid grid-cols-5 gap-6">
                {STEPS.map((step) => (
                  <div key={step.n} className="flex flex-col items-center text-center">
                    <span className="h-3 w-3 border border-text-primary bg-surface" />
                    <span className="mt-3 font-mono text-xs text-text-muted">{step.n}</span>
                    <p className="mt-2 text-sm font-semibold text-text-primary">{step.title}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{step.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile: vertical timeline */}
            <div className="mt-12 space-y-8 border-l border-border pl-6 md:hidden">
              {STEPS.map((step) => (
                <div key={step.n} className="relative">
                  <span className="absolute top-1 -left-[27px] h-3 w-3 border border-text-primary bg-surface" />
                  <span className="font-mono text-xs text-text-muted">{step.n}</span>
                  <p className="mt-1 text-sm font-semibold text-text-primary">{step.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 5: Evidence & control */}
        <section id="security" className="mx-auto max-w-6xl px-6 py-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <Eyebrow>EVIDENCE &amp; CONTROL</Eyebrow>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
                AI built for decisions that need evidence.
              </h2>
              <p className="mt-4 text-base text-text-muted">
                Financial decisions require more than plausible answers. The system is designed
                around evidence, traceability and human control.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-3">
              {EVIDENCE_CARDS.map((card) => (
                <EvidenceCard key={card.label} {...card} />
              ))}
            </div>
          </div>
        </section>

        {/* Section 6: Private intelligence */}
        <section className="border-t border-border bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-28">
            <Eyebrow>PRIVATE INTELLIGENCE</Eyebrow>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
              Your data. Your environment. Your intelligence.
            </h2>
            <p className="mt-4 max-w-xl text-base text-text-muted">
              Build AI workflows around the information, methodology and decision processes that
              matter to your organization.
            </p>

            <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {PILLARS.map((pillar) => (
                <PillarCard key={pillar.n} {...pillar} />
              ))}
            </div>
          </div>
        </section>

        {/* Section 7: Use cases */}
        <section id="solutions" className="mx-auto max-w-6xl px-6 py-28">
          <h2 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
            Built around real financial workflows.
          </h2>

          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((useCase) => (
              <UseCaseCard key={useCase.title} {...useCase} />
            ))}
          </div>
        </section>

        {/* Section 8: Product evolution */}
        <section className="border-t border-border bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-28">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
              <div>
                <Eyebrow>PRODUCT EVOLUTION</Eyebrow>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
                  From research to continuous intelligence.
                </h2>
                <p className="mt-4 max-w-md text-base text-text-muted">
                  Start with the information your teams already use. Turn analysis into structured
                  intelligence, dashboards and eventually continuous monitoring.
                </p>
              </div>

              <div className="divide-y divide-border rounded-lg border border-border bg-background">
                {EVOLUTION_STEPS.map((step) => (
                  <div key={step.n} className="flex items-center gap-4 p-4">
                    <IconBox icon={step.icon} className="h-10 w-10" />
                    <p className="flex-1 text-sm font-medium text-text-primary">{step.label}</p>
                    <span className="font-mono text-xs text-text-muted">{step.n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Section 9: Final CTA */}
        <section className="mx-auto max-w-3xl px-6 py-32 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
            Build your financial intelligence system.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-text-muted">
            Give your team a faster, more traceable way to research, analyze risk and turn
            financial information into decisions.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button render={<Link href="/login" />} nativeButton={false} size="lg" className="h-11 px-6">
              Request a Private Demo
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-11 px-6"
              onClick={() => scrollTo("platform")}
            >
              Explore the Platform
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 text-text-primary">
                <LayoutGrid className="h-5 w-5" />
                <span className="text-sm font-bold tracking-wide">ORACLE</span>
              </div>
              <p className="mt-3 max-w-[16rem] text-sm text-text-muted">
                Private intelligence infrastructure for financial institutions.
              </p>
            </div>

            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading}>
                <p className="font-mono-label">{column.heading}</p>
                <ul className="mt-3 space-y-2">
                  {column.items.map((item) => (
                    <li key={item} className="text-sm text-text-muted">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 border-t border-border pt-6">
            <p className="text-xs text-text-muted">
              © 2026 Oracle. All rights reserved. Private AI · Decision-ready intelligence
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
