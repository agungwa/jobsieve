import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Job } from "../api";
import {
  avatarColor,
  formatSalary,
  initials,
  timeAgo,
  workplaceLabel,
} from "../utils";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<Job>(`/jobs/${id}`)
      .then((j) => {
        setJob(j);
        document.title = `${j.title} · ${j.company} — Jobsieve`;
      })
      .catch((err) => setError((err as Error).message));
    return () => { document.title = "Jobsieve — Remote tech jobs, matched to your CV"; };
  }, [id]);

  if (error) {
    return (
      <div className="card">
        <p className="error-text">{error}</p>
        <Link to="/" className="subtle">← Back to jobs</Link>
      </div>
    );
  }
  if (!job) return <p className="muted">Loading…</p>;

  const wp = workplaceLabel(job.remoteAllowed, job.location);
  const salary = formatSalary(
    job.salaryMin ?? null,
    job.salaryMax ?? null,
    job.salaryCurrency ?? null,
    job.salaryPeriod ?? null,
  );

  return (
    <div>
      <div className="card">
        <div className="detail-head">
          <div className="avatar" style={{ background: avatarColor(job.company), width: 56, height: 56, fontSize: 19 }}>
            {initials(job.company)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{job.title}</h2>
            <div className="job-co" style={{ fontSize: 14 }}>
              {job.company}
              {job.location ? ` · ◎ ${job.location}` : ""}
            </div>
            <div className="job-meta">
              {wp.kind !== "any" && <span className={`pill pill-${wp.kind}`}>{wp.label}</span>}
              {job.seniority && <span className="pill pill-seniority">{job.seniority}</span>}
              {salary && <span className="pill pill-salary">{salary}</span>}
              {job.postedAt && <span className="item faint">posted {timeAgo(job.postedAt)}</span>}
            </div>
          </div>
          <a href={job.url} target="_blank" rel="noreferrer">
            <button>Apply ↗</button>
          </a>
        </div>
        {job.skills && job.skills.length > 0 && (
          <>
            <div className="section-label">Skills</div>
            {job.skills.map((s) => (
              <span key={s} className="tag">{s}</span>
            ))}
          </>
        )}
      </div>

      {job.description && (
        <div className="card">
          <div className="section-label" style={{ marginTop: 0 }}>Description</div>
          <div className="description">{job.description}</div>
        </div>
      )}

      <Link to="/" className="muted">← Back to jobs</Link>
    </div>
  );
}
