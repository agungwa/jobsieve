import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  getActiveCvId,
  setActiveCvId,
  type CvProfile,
  type Job,
  type MatchResult,
} from "../api";
import { avatarColor, formatSalary, initials, timeAgo, workplaceLabel } from "../utils";

export default function MatchPage() {
  const [cvId, setCvId] = useState<string | null>(getActiveCvId());
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [skill, setSkill] = useState("");
  const [remote, setRemote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!cvId) return;
    setError(null);
    setRetrying(false);
    try {
      const params = new URLSearchParams({ cv_id: cvId, limit: "20" });
      if (skill.trim()) params.set("skill", skill.trim());
      if (remote) params.set("remote", "true");
      const data = await api<MatchResult>(`/match?${params}`);
      setResult(data);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      if (msg.includes("not embedded") || msg.includes("pending")) {
        setRetrying(true);
      }
    }
  }, [cvId, skill, remote]);

  useEffect(() => {
    document.title = "Your matches — Jobsieve";
    return () => { document.title = "Jobsieve — Remote tech jobs, matched to your CV"; };
  }, []);

  useEffect(() => {
    if (!cvId) return;
    api<CvProfile>(`/cv/${cvId}`)
      .then((p) => {
        setProfile(p);
        if (p.embeddingStatus === "pending") {
          // CV still processing — retry the whole flow shortly.
          setTimeout(load, 5000);
        }
      })
      .catch((err) => setError((err as Error).message));
  }, [cvId, load]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-retry while the CV is still pending.
  useEffect(() => {
    if (!retrying) return;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [retrying, load]);

  if (!cvId) {
    return (
      <div className="empty">
        <div className="big">📄</div>
        <strong>No CV uploaded yet</strong>
        <p>Upload your CV to see semantic matches ranked by similarity.</p>
        <Link to="/"><button className="subtle">Upload a CV</button></Link>
      </div>
    );
  }

  const topSkills = profile
    ? [...profile.skills].sort((a, b) => b.occurrences - a.occurrences).slice(0, 5)
    : [];

  return (
    <div>
      <div className="card">
        <div className="row-between">
          <div className="detail-head" style={{ gap: 12 }}>
            <div className="avatar" style={{ background: avatarColor(profile?.targetRole ?? "cv") }}>
              {profile?.targetRole ? initials(profile.targetRole) : "CV"}
            </div>
            <div>
              <strong style={{ fontSize: 15 }}>Your matches</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                {profile?.targetRole ?? "unknown role"}
                {profile?.estimatedYearsExperience !== null && profile?.estimatedYearsExperience !== undefined
                  ? ` · ${profile.estimatedYearsExperience} yrs exp`
                  : ""}
                {topSkills.length > 0 && ` · ${topSkills.map((s) => s.skill).join(", ")}`}
              </div>
            </div>
          </div>
          <button
            className="ghost"
            onClick={() => {
              setActiveCvId(null);
              setCvId(null);
            }}
          >
            Forget CV
          </button>
        </div>
      </div>

      <form
        className="filters-inline"
        style={{ margin: "0 0 14px" }}
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <input
          type="text"
          placeholder="Filter by skill"
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
        />
        <label className="check-row">
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} /> remote only
        </label>
        <button type="submit" className="ghost">Apply</button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {retrying && <p className="muted">CV is still being embedded — retrying every 5s…</p>}

      {result && result.items.length === 0 && !error && (
        <div className="empty">
          <div className="big">🤝</div>
          <strong>No matches right now</strong>
          <p>Try removing the skill filter, or check back after the next ingest run.</p>
        </div>
      )}

      {result?.items.map((job) => (
        <MatchCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function MatchCard({ job }: { job: Job }) {
  const wp = workplaceLabel(job.remoteAllowed, job.location);
  const salary = formatSalary(job.salaryMin ?? null, job.salaryMax ?? null, job.salaryCurrency ?? null, job.salaryPeriod ?? null);
  return (
    <Link to={`/jobs/${job.id}`} className="job-card">
      <div className="avatar" style={{ background: avatarColor(job.company) }}>
        {initials(job.company)}
      </div>
      <div className="job-main">
        <span className="job-title">{job.title}</span>
        <div className="job-co">{job.company}</div>
        <div className="job-meta">
          {wp.kind !== "any" && <span className={`pill pill-${wp.kind}`}>{wp.label}</span>}
          {job.seniority && <span className="pill pill-seniority">{job.seniority}</span>}
          {salary && <span className="pill pill-salary">{salary}</span>}
          {job.location && <span className="item">◎ {job.location}</span>}
        </div>
      </div>
      <div className="job-side">
        {job.score !== undefined && (
          <span className="score-badge">{Math.round(job.score * 100)}% match</span>
        )}
        <span className="time">{timeAgo(job.postedAt ?? null)}</span>
      </div>
    </Link>
  );
}
