import { useCallback, useEffect, useState } from "react";
import {
  api,
  getAdminKey,
  setAdminKey,
  type SourceRow,
  type CompanyRow,
  type UsageRow,
} from "../../api";

interface Stats {
  jobs: { total: number; embedded: number; pending: number };
}

export default function AdminPage() {
  const [keyInput, setKeyInput] = useState(getAdminKey() ?? "");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [sources, setSources] = useState<SourceRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Board form
  const [bName, setBName] = useState("");
  const [bSlug, setBSlug] = useState("");
  const [bHq, setBHq] = useState("");
  const [bType, setBType] = useState<"greenhouse" | "lever" | "ashby">("greenhouse");
  const [bBusy, setBBusy] = useState(false);
  const [bError, setBError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!authed) return;
    setLoadError(null);
    try {
      const [s, st, u, c] = await Promise.all([
        api<{ items: SourceRow[] }>("/sources"),
        api<Stats>("/admin/stats", { admin: true }),
        api<{ items: UsageRow[] }>("/chat/usage", { admin: true }),
        api<{ items: CompanyRow[] }>("/admin/companies", { admin: true }),
      ]);
      setSources(s.items);
      setStats(st);
      setUsage(u.items);
      setCompanies(c.items);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [authed]);

  // Try the stored key on mount.
  useEffect(() => {
    if (getAdminKey()) {
      api<Stats>("/admin/stats", { admin: true })
        .then(() => setAuthed(true))
        .catch((err) => setAuthError((err as Error).message));
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 60s auto refresh.
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(loadAll, 60_000);
    return () => clearInterval(t);
  }, [authed, loadAll]);

  if (!authed) {
    return (
      <div className="card" style={{ maxWidth: 420 }}>
        <h3>Admin access</h3>
        <p className="muted">Enter the admin API key (sent as x-api-key).</p>
        <form
          className="filters-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            setAuthError(null);
            setAdminKey(keyInput);
            try {
              await api<Stats>("/admin/stats", { admin: true });
              setAuthed(true);
            } catch (err) {
              setAdminKey(null);
              setAuthError((err as Error).message);
            }
          }}
        >
          <input
            type="password"
            placeholder="admin key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit">Unlock</button>
        </form>
        {authError && <p className="error-text">{authError}</p>}
      </div>
    );
  }

  async function addBoard(e: React.FormEvent) {
    e.preventDefault();
    setBError(null);
    setBBusy(true);
    try {
      await api("/admin/companies", {
        method: "POST",
        admin: true,
        body: { name: bName, ats_type: bType, board_slug: bSlug, hq_location: bHq || undefined },
      });
      setBName("");
      setBSlug("");
      setBHq("");
      await loadAll();
    } catch (err) {
      setBError((err as Error).message);
    } finally {
      setBBusy(false);
    }
  }

  async function deleteBoard(id: string, hard: boolean) {
    if (hard && !window.confirm("Hard-delete this board? This cannot be undone.")) return;
    try {
      await api(`/admin/companies/${id}${hard ? "?hard=true" : ""}`, {
        method: "DELETE",
        admin: true,
      });
      await loadAll();
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }

  return (
    <div>
      {loadError && <p className="error-text">{loadError}</p>}

      <div className="card">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>Stats</h3>
          <button className="ghost" onClick={loadAll}>Refresh</button>
        </div>
        {stats && (
          <div className="stat-row" style={{ marginTop: 10 }}>
            <div className="stat">
              <div className="num">{stats.jobs.total}</div>
              <div className="label">jobs</div>
            </div>
            <div className="stat">
              <div className="num badge-ok">{stats.jobs.embedded}</div>
              <div className="label">embedded</div>
            </div>
            <div className="stat">
              <div className="num badge-warn">{stats.jobs.pending}</div>
              <div className="label">pending</div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Sources</h3>
        <table>
          <thead>
            <tr>
              <th>name</th><th>last run</th><th>status</th>
              <th>fetched</th><th>pending</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td className="muted">
                  {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "—"}
                </td>
                <td>
                  {s.lastStatus === "ok" ? (
                    <span className="badge-ok">ok</span>
                  ) : s.lastStatus === "error" ? (
                    <span className="badge-err" title={s.lastError ?? ""}>error</span>
                  ) : (
                    "—"
                  )}
                  {s.lastStatus === "error" && s.lastError && (
                    <div className="muted" style={{ fontSize: 12 }}>{s.lastError.slice(0, 120)}</div>
                  )}
                </td>
                <td>{s.jobsFetched}</td>
                <td>{s.embeddingPendingCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>ATS boards</h3>
        <form className="filters-inline" onSubmit={addBoard}>
          <input type="text" placeholder="Company name" value={bName}
            onChange={(e) => setBName(e.target.value)} required />
          <select value={bType} onChange={(e) => setBType(e.target.value as typeof bType)}>
            <option value="greenhouse">greenhouse</option>
            <option value="lever">lever</option>
            <option value="ashby">ashby</option>
          </select>
          <input type="text" placeholder="board slug" value={bSlug}
            onChange={(e) => setBSlug(e.target.value)} required />
          <input type="text" placeholder="HQ location (optional, e.g. Tokyo, Japan)" value={bHq}
            onChange={(e) => setBHq(e.target.value)} />
          <button type="submit" disabled={bBusy}>Add board</button>
        </form>
        {bError && <p className="error-text">{bError}</p>}
        <table>
          <thead>
            <tr><th>name</th><th>type</th><th>slug</th><th>jobs</th><th>state</th><th></th></tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.atsType}</td>
                <td className="muted">{c.boardSlug}</td>
                <td>{c.jobCount ?? 0}</td>
                <td>{c.enabled ? <span className="badge-ok">on</span> : <span className="muted">off</span>}</td>
                <td className="row-between" style={{ gap: 6, flexWrap: "nowrap" }}>
                  <button className="ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => deleteBoard(c.id, false)}>Disable</button>
                  <button className="danger" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => deleteBoard(c.id, true)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Chat usage (recent)</h3>
        {usage.length === 0 && <p className="muted">No chat requests yet.</p>}
        {usage.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>when</th><th>user</th><th>model</th>
                <th>prompt</th><th>completion</th><th>cached</th><th>latency</th>
              </tr>
            </thead>
            <tbody>
              {[...usage].reverse().map((u) => (
                <tr key={u.id}>
                  <td className="muted">{new Date(u.createdAt).toLocaleString()}</td>
                  <td>{u.userKey.slice(0, 12)}</td>
                  <td>{u.model}</td>
                  <td>{u.promptTokens}</td>
                  <td>{u.completionTokens}</td>
                  <td>{u.cached ? "✓" : ""}</td>
                  <td>{u.latencyMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
