import { useEffect, useRef, useState } from "react";
import { api } from "./api";

interface SuggestProps {
  field: "q" | "company" | "location" | "skill";
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

/** Text input with server-backed autocomplete dropdown. */
export default function Suggest({
  field,
  value,
  onChange,
  onCommit,
  placeholder,
  className,
  style,
  disabled,
}: SuggestProps) {
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Debounced fetch of suggestions.
  useEffect(() => {
    const t = setTimeout(() => {
      const p = value.trim();
      if (p.length < 2) {
        setItems([]);
        return;
      }
      api<{ items: string[] }>(`/suggest?field=${field}&prefix=${encodeURIComponent(p)}`)
        .then((d) => setItems(d.items.filter((i) => i.toLowerCase() !== p.toLowerCase())))
        .catch(() => setItems([]));
    }, 200);
    return () => clearTimeout(t);
  }, [value, field]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(item: string) {
    onChange(item);
    setOpen(false);
    onCommit?.();
  }

  return (
    <span className="suggest" ref={wrapRef} style={{ position: "relative", display: "flex", flex: 1, minWidth: 0 }}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        className={className}
        style={style}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && open && items.length > 0) {
            // Let a suggestion win only if the text exactly matches one;
            // otherwise submit the typed value.
            const hit = items.find((i) => i.toLowerCase() === value.trim().toLowerCase());
            if (hit) {
              e.preventDefault();
              pick(hit);
            } else {
              setOpen(false);
              // No exact match: let forms submit naturally; standalone
              // inputs (e.g. filter fields) commit the typed value.
              onCommit?.();
            }
          }
        }}
      />
      {open && items.length > 0 && (
        <ul className="suggest-list">
          {items.map((item) => (
            <li key={item}>
              <button type="button" onClick={() => pick(item)}>
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
