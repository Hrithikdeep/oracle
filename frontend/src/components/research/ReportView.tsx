import type { ResearchReport } from "@/lib/types";

/** Renders a ResearchReport for /app/projects/[id]'s Report tab. */
export function ReportView({ report }: { report: ResearchReport }) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <p className="font-mono-label mb-2">EXECUTIVE SUMMARY</p>
        <p className="text-sm whitespace-pre-wrap text-text-primary">{report.executive_summary}</p>
      </section>

      {Object.entries(report.sections).map(([title, body]) => (
        <section key={title}>
          <p className="font-mono-label mb-2">{title.toUpperCase()}</p>
          <p className="text-sm whitespace-pre-wrap text-text-primary">{body}</p>
        </section>
      ))}

      {report.recommendation && (
        <section>
          <p className="font-mono-label mb-2">RECOMMENDATION</p>
          <p className="text-sm whitespace-pre-wrap text-text-primary">{report.recommendation}</p>
        </section>
      )}

      {report.limitations.length > 0 && (
        <section>
          <p className="font-mono-label mb-2">LIMITATIONS</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted">
            {report.limitations.map((limitation, i) => (
              <li key={i}>{limitation}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
