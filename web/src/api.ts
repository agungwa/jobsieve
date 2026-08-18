/**
 * Shared API client. Base path `/api` — in dev Vite proxies to the backend,
 * in prod the backend serves both the SPA and the API.
 */

const ADMIN_KEY_STORAGE = "jobsfound.adminKey";
const CV_STORAGE = "jobsfound.cvId";
const GLM_KEY_STORAGE = "jobsfound.glmKey";
const GLM_MODEL_STORAGE = "jobsfound.glmModel";
const GLM_BASE_STORAGE = "jobsfound.glmBaseUrl";

export function getAdminKey(): string | null {
  return localStorage.getItem(ADMIN_KEY_STORAGE);
}
export function setAdminKey(key: string | null): void {
  if (key === null) localStorage.removeItem(ADMIN_KEY_STORAGE);
  else localStorage.setItem(ADMIN_KEY_STORAGE, key);
}

export function getActiveCvId(): string | null {
  return localStorage.getItem(CV_STORAGE);
}
export function setActiveCvId(id: string | null): void {
  if (id === null) localStorage.removeItem(CV_STORAGE);
  else localStorage.setItem(CV_STORAGE, id);
}

/**
 * Bring-your-own AI key — lives ONLY in this browser's localStorage.
 * Sent per-request as x-glm-key; the server uses it for that single call
 * and never stores or logs it.
 */
export function getGlmKey(): string | null {
  return localStorage.getItem(GLM_KEY_STORAGE);
}
export function setGlmKey(key: string | null): void {
  if (key === null || !key.trim()) localStorage.removeItem(GLM_KEY_STORAGE);
  else localStorage.setItem(GLM_KEY_STORAGE, key.trim());
}
export function getGlmModel(): string | null {
  return localStorage.getItem(GLM_MODEL_STORAGE);
}
export function setGlmModel(model: string | null): void {
  if (model === null || !model.trim()) localStorage.removeItem(GLM_MODEL_STORAGE);
  else localStorage.setItem(GLM_MODEL_STORAGE, model.trim());
}
export function getGlmBaseUrl(): string | null {
  return localStorage.getItem(GLM_BASE_STORAGE);
}
export function setGlmBaseUrl(url: string | null): void {
  if (url === null || !url.trim()) localStorage.removeItem(GLM_BASE_STORAGE);
  else localStorage.setItem(GLM_BASE_STORAGE, url.trim());
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let code = "http_error";
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as Record<string, unknown>;
    code = typeof body.error === "string" ? body.error : code;
    message =
      typeof body.message === "string" ? body.message : message;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, code, message);
}

export async function api<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    admin?: boolean;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.admin) {
    const key = getAdminKey();
    if (!key) throw new ApiError(403, "no_key", "Admin key not set");
    headers["x-api-key"] = key;
  }
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function uploadCv(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/cv", { method: "POST", body: fd });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as UploadResult;
}

// ── Response types (mirror the backend) ────────────────────────────────────

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remoteAllowed?: 0 | 1 | null;
  seniority: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  summary: string;
  description?: string | null;
  url: string;
  postedAt: string | null;
  skills?: string[];
  score?: number;
}

export interface JobsPage {
  items: Job[];
  cursor: string | null;
}

export interface UploadResult {
  id: string;
  filename: string;
  embeddingStatus: "pending" | "embedded" | "failed";
  skillsFound: number;
  estimatedYearsExperience: number | null;
  targetRole: string | null;
  createdAt: string;
}

export interface CvProfile {
  id: string;
  filename: string;
  contentType: string;
  contacts: {
    email: string | null;
    phone: string | null;
    github: string | null;
    linkedin: string | null;
    url: string | null;
  };
  skills: Array<{ skill: string; occurrences: number }>;
  estimatedYearsExperience: number | null;
  targetRole: string | null;
  embeddingStatus: "pending" | "embedded" | "failed";
}

export interface MatchResult {
  items: Job[];
  cv_id: string;
}

export interface ChatReply {
  reply: string;
  cached: boolean;
  model: string;
  byok?: boolean;
  usage?: { promptTokens: number; completionTokens: number; latencyMs: number };
}

export interface SourceRow {
  name: string;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  jobsFetched: number;
  embeddingPendingCount: number;
}

export interface CompanyRow {
  id: string;
  name: string;
  atsType: "greenhouse" | "lever" | "ashby";
  boardSlug: string;
  hqLocation?: string | null;
  enabled: 0 | 1;
  jobCount?: number;
}

export interface UsageRow {
  id: string;
  userKey: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cached: 0 | 1;
  latencyMs: number;
  createdAt: string;
}
