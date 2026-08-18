import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  uploadCv,
  setActiveCvId,
  type JobsPage,
  type Job,
} from "../api";
import {
  avatarColor,
  formatSalary,
  initials,
  sourceLabel,
  timeAgo,
  workplaceLabel,
} from "../utils";
import Suggest from "../Suggest";

const MAX_BYTES = 4 * 1024 * 1024;
const OK_EXTS = ["pdf", "docx", "doc", "txt", "md"];

const SENIORITY = ["intern", "junior", "mid", "senior", "lead", "staff", "manager", "director+"];
const SOURCES = ["arbeitnow", "remotive", "remoteok", "greenhouse", "lever", "ashby"];

export default function JobsPage() {
  // Search
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");

  // Filters
  const [workplace, setWorkplace] = useState("any");
  const [seniority, setSeniority] = useState<string[]>([]);
  const [salaryMin, setSalaryMin] = useState("");
  const [postedWithin, setPostedWithin] = useState("");
  const [visa, setVisa] = useState(false);
  const [source, setSource] = useState("");
  const [skill, setSkill] = useState("");

  // Results
  const [page, setPage] = useState<JobsPage | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const cursor = cursors[pageIndex] ?? null;
  const applied = useRef(false);

  const load = useCallback(async (cursorOverride?: string | null) => {
    const cur = cursorOverride !== undefined ? cursorOverride : cursor;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (q.trim()) params.set("q", q.trim());
      if (location.trim()) params.set("location", location.trim());
      if (workplace !== "any") params.set("workplace", workplace);
      if (seniority.length > 0) params.set("seniority", seniority.join(","));
      if (salaryMin) params.set("salary_min", salaryMin);
      if (postedWithin) params.set("posted_within", postedWithin);
      if (visa) params.set("visa", "true");
      if (source) params.set("source", source);
      if (skill.trim()) params.set("skill", skill.trim());
      if (cur) params.set("cursor", cur);
      const data = await api<JobsPage>(`/jobs?${params}`);
      setPage(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, location, workplace, seniority, salaryMin, postedWithin, visa, source, skill, cursor]);

  // Reload when filters change (debounced via explicit apply + effect on state).
  useEffect(() => {
    document.title = "Remote & tech jobs — Jobsieve";
    return () => { document.title = "Jobsieve — Remote tech jobs, matched to your CV"; };
  }, []);
  useEffect(() => {
    if (applied.current) {
      applied.current = false;
      return;
    }
    setCursors([null]);
    setPageIndex(0);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workplace, seniority, salaryMin, postedWithin, visa, source]);

  function runSearch() {
    setCursors([null]);
    setPageIndex(0);
    load(null);
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch();
  }

  function goNext() {
    if (page?.cursor) {
      setCursors((c) => [...c, page.cursor]);
      setPageIndex((i) => i + 1);
      load(page.cursor);
    }
  }
  function goPrev() {
    const prevIdx = pageIndex - 1;
    if (prevIdx >= 0) {
      setPageIndex(prevIdx);
      load(cursors[prevIdx] ?? null);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!OK_EXTS.includes(ext)) {
      setUploadError(`Unsupported file type ".${ext}" — use PDF, DOCX, or TXT`);
      e.target.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError("File is larger than 4 MB");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const result = await uploadCv(file);
      setActiveCvId(result.id);
      window.location.href = `/cv/${result.id}`;
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const activeFilters =
    (workplace !== "any" ? 1 : 0) + seniority.length + (salaryMin ? 1 : 0) +
    (postedWithin ? 1 : 0) + (visa ? 1 : 0) + (source ? 1 : 0);

  function resetFilters() {
    setWorkplace("any");
    setSeniority([]);
    setSalaryMin("");
    setPostedWithin("");
    setVisa(false);
    setSource("");
  }

  return (
    <div>
      <div className="hero">
        <h1>Find your next remote or tech job</h1>
        <p className="sub">
          {page ? `${page.items.length}${page.cursor ? "+" : ""} live roles` : "Live roles"} aggregated from
          Arbeitnow, Remotive, RemoteOK and company ATS boards — matched to your CV without AI cost.
        </p>
        <form className="search-bar" onSubmit={applySearch}>
          <label className="field">
            <span>⌕</span>
            <Suggest
              field="q"
              placeholder="Role, skill, or company"
              value={q}
              onChange={setQ}
              onCommit={runSearch}
            />
          </label>
          <label className="field">
            <span>◎</span>
            <Suggest
              field="location"
              placeholder="Location (e.g. London, Japan)"
              value={location}
              onChange={setLocation}
              onCommit={runSearch}
            />
          </label>
          <button type="submit" disabled={loading}>Search</button>
        </form>
        <div className="row-between" style={{ marginTop: 12 }}>
          <label className="muted" style={{ fontSize: 13 }}>
            Have a CV? Upload it for instant matches (PDF/DOCX/TXT · no AI used for parsing)
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md"
              onChange={onFile}
              disabled={uploading}
              style={{ marginLeft: 10, fontSize: 12 }}
            />
          </label>
        </div>
        {uploadError && <p className="error-text">{uploadError}</p>}
      </div>

      <div className="layout">
        <aside className="filters">
          <div className="row-between">
            <h3>Filters {activeFilters > 0 && <span className="pill pill-seniority">{activeFilters}</span>}</h3>
            {activeFilters > 0 && (
              <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={resetFilters}>
                Reset
              </button>
            )}
          </div>

          <div className="filter-group">
            <label>Workplace</label>
            <div className="radio-row">
              {["any", "remote", "hybrid", "onsite"].map((w) => (
                <label key={w}>
                  <input
                    type="radio"
                    name="workplace"
                    checked={workplace === w}
                    onChange={() => setWorkplace(w)}
                  />
                  {w === "any" ? "Any" : w === "onsite" ? "On-site" : w[0]!.toUpperCase() + w.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label>Seniority</label>
            <div className="radio-row">
              {SENIORITY.map((s) => (
                <label key={s}>
                  <input
                    type="checkbox"
                    checked={seniority.includes(s)}
                    onChange={(e) =>
                      setSeniority((list) =>
                        e.target.checked ? [...list, s] : list.filter((x) => x !== s),
                      )
                    }
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label>Minimum salary</label>
            <select value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)}>
              <option value="">Any</option>
              <option value="30000">30k+</option>
              <option value="60000">60k+</option>
              <option value="80000">80k+</option>
              <option value="100000">100k+</option>
              <option value="150000">150k+</option>
              <option value="200000">200k+</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Posted</label>
            <select value={postedWithin} onChange={(e) => setPostedWithin(e.target.value)}>
              <option value="">Any time</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Skill filter</label>
            <Suggest
              field="skill"
              placeholder="e.g. react"
              value={skill}
              onChange={setSkill}
              onCommit={runSearch}
            />
          </div>

          <label className="check-row">
            <input type="checkbox" checked={visa} onChange={(e) => setVisa(e.target.checked)} />
            Visa sponsorship / relocation
          </label>
        </aside>

        <div>
          <div className="results-head">
            <span>
              {loading ? "Searching…" : page ? `${page.items.length}${page.cursor ? "+" : ""} results` : ""}
              {q && ` for “${q}”`}
            </span>
          </div>

          {error && <p className="error-text">{error}</p>}

          {!loading && page?.items.length === 0 && (
            <div className="empty">
              <div className="big">🔍</div>
              <strong>No jobs match your filters</strong>
              <p>Try removing a filter or broadening your search.</p>
              <button className="subtle" onClick={resetFilters}>Reset filters</button>
            </div>
          )}

          {page?.items.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}

          {page && page.items.length > 0 && (
            <div className="pager">
              <button className="ghost" onClick={goPrev} disabled={pageIndex === 0}>
                ← Previous
              </button>
              <span className="muted">page {pageIndex + 1}</span>
              <button className="ghost" onClick={goNext} disabled={!page.cursor}>
                Next →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const wp = workplaceLabel(job.remoteAllowed, job.location);
  const salary = formatSalary(job.salaryMin ?? null, job.salaryMax ?? null, job.salaryCurrency ?? null, job.salaryPeriod ?? null);
  const src = (job as Job & { sources?: string[] }).sources?.[0];
  return (
    <Link to={`/jobs/${job.id}`} className="job-card">
      <div className="avatar" style={{ background: avatarColor(job.company) }}>
        {initials(job.company)}
      </div>
      <div className="job-main">
        <span className="job-title">{job.title}</span>
        <div className="job-co">
          {job.company}
          {src && <span className="faint"> · via {sourceLabel(src)}</span>}
        </div>
        <div className="job-meta">
          {wp.kind !== "any" && (
            <span className={`pill pill-${wp.kind}`}>{wp.label}</span>
          )}
          {job.seniority && <span className="pill pill-seniority">{job.seniority}</span>}
          {salary && <span className="pill pill-salary">{salary}</span>}
          {job.location && <span className="item">◎ {job.location}</span>}
        </div>
      </div>
      <div className="job-side">
        <span className="time">{timeAgo(job.postedAt ?? null)}</span>
        {job.remoteAllowed === 1 && <span className="faint" style={{ fontSize: 11 }}>🌍 remote</span>}
      </div>
    </Link>
  );
}
