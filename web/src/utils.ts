/** Shared display helpers. */

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function initials(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
}

const AVATAR_COLORS = [
  "#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626",
  "#7c3aed", "#db2777", "#2563eb", "#65a30d", "#ea580c",
];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null,
): string | null {
  if (min === null && max === null) return null;
  const cur = currency ? currency.replace(/^EUR$/, "€").replace(/^USD|GBP$/, (m) => (m === "USD" ? "$" : "£")) : "";
  const fmt = (n: number) => {
    if (n >= 1000) return `${cur}${Math.round(n / 1000)}k`;
    return `${cur}${n}`;
  };
  const range =
    min !== null && max !== null
      ? `${fmt(min)} – ${fmt(max)}`
      : min !== null
        ? `${fmt(min)}+`
        : `${fmt(max!)}-`;
  const suffix =
    period === "hourly" ? "/hr" : period === "monthly" ? "/mo" : period === "yearly" ? "/yr" : "";
  return `${range}${suffix}`;
}

export type Workplace = "remote" | "hybrid" | "onsite" | "any";

export function workplaceLabel(
  remoteAllowed: 0 | 1 | null | undefined,
  location: string | null,
): { label: string; kind: Workplace } {
  const loc = location ?? "";
  if (/hybrid/i.test(loc)) return { label: "Hybrid", kind: "hybrid" };
  if (remoteAllowed === 1 || /remote/i.test(loc)) return { label: "Remote", kind: "remote" };
  if (remoteAllowed === 0 || loc) return { label: "On-site", kind: "onsite" };
  return { label: "—", kind: "any" };
}

export function sourceLabel(s: string): string {
  return s.split(":")[0]!;
}
