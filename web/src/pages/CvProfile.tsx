import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type CvProfile } from "../api";

export default function CvProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const p = await api<CvProfile>(`/cv/${id}`);
        setProfile(p);
        if (p.embeddingStatus === "pending" && attempts.current < 10) {
          setPolling(true);
          attempts.current++;
          timer = setTimeout(load, 5000);
        } else {
          setPolling(false);
        }
      } catch (err) {
        setError((err as Error).message);
        setPolling(false);
      }
    }
    load();
    return () => clearTimeout(timer);
  }, [id]);

  if (error) {
    return (
      <div className="card">
        <p className="error-text">{error}</p>
        <Link to="/">← Back to jobs</Link>
      </div>
    );
  }
  if (!profile) return <p className="muted">Loading…</p>;

  const statusBadge =
    profile.embeddingStatus === "embedded" ? (
      <span className="badge-ok">embedded ✓</span>
    ) : profile.embeddingStatus === "failed" ? (
      <span className="badge-err">embedding failed</span>
    ) : (
      <span className="badge-warn">embedding in progress…</span>
    );

  return (
    <div>
      <div className="card">
        <div className="row-between">
          <h2 style={{ margin: 0 }}>Your profile</h2>
          {statusBadge}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          {profile.filename} · {profile.targetRole ?? "target role unknown"} ·{" "}
          {profile.estimatedYearsExperience !== null
            ? `${profile.estimatedYearsExperience} yrs experience`
            : "experience unknown"}
        </div>
        <div style={{ marginTop: 10 }}>
          {profile.contacts.email && <div>✉ {profile.contacts.email}</div>}
          {profile.contacts.phone && <div>☎ {profile.contacts.phone}</div>}
          {profile.contacts.github && <div>⌥ {profile.contacts.github}</div>}
          {profile.contacts.linkedin && <div>in {profile.contacts.linkedin}</div>}
        </div>
      </div>

      <div className="card">
        <h3>Skills ({profile.skills.length})</h3>
        {profile.skills.length === 0 && <p className="muted">No skills detected.</p>}
        {profile.skills
          .sort((a, b) => b.occurrences - a.occurrences)
          .map((s) => (
            <span key={s.skill} className="tag">
              {s.skill} ×{s.occurrences}
            </span>
          ))}
      </div>

      {polling && <p className="muted">Embedding your profile — this page updates automatically…</p>}

      <div className="row-between">
        <Link to="/">← Upload another</Link>
        {profile.embeddingStatus === "embedded" && (
          <Link to="/match">
            <button>See my matches →</button>
          </Link>
        )}
      </div>
    </div>
  );
}
