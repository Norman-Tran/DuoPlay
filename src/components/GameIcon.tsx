// Inline SVG game icons; animations live in globals.css (.gi-*), triggered by parent `.group` hover/focus.
export default function GameIcon({ id }: { id: string }) {
  const cls = "gi h-12 w-12 overflow-visible";
  switch (id) {
    case "caro":
      return (
        <svg viewBox="0 0 48 48" className={cls} aria-hidden="true">
          <path d="M16 4v40M32 4v40M4 16h40M4 32h40" stroke="#475569" strokeWidth={1.5} />
          <path className="gi-x" d="M6 6l8 8M14 6l-8 8" stroke="#f472b6" strokeWidth={3} strokeLinecap="round" strokeDasharray={40} />
          <circle className="gi-o" cx={24} cy={24} r={5} fill="none" stroke="#22d3ee" strokeWidth={3} strokeDasharray={40} />
          <path className="gi-line" d="M6 42L42 6" stroke="#facc15" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={60} strokeDashoffset={0} opacity={0.85} />
        </svg>
      );
    case "chess":
      return (
        <svg viewBox="0 0 48 48" className={cls} aria-hidden="true">
          <g className="gi-knight">
            <path d="M14 40c0-7 7-9 8-16-3 2-6 3-8 3-2 0-3-2-2-4l8-9 1-4 3 3c7 0 12 6 12 15v12z" fill="#fbf5e6" stroke="#1b1b1b" strokeWidth={1.8} strokeLinejoin="round" />
            <circle cx={19} cy={17} r={1.3} fill="#1b1b1b" />
          </g>
          <path d="M11 44h26" stroke="#94a3b8" strokeWidth={2.5} strokeLinecap="round" />
        </svg>
      );
    case "mines":
      return (
        <svg viewBox="0 0 48 48" className={cls} aria-hidden="true">
          <g className="gi-mine">
            <path d="M18 14v-4M18 38v4M6 26H2M34 26h-4M9 17l-3-3M27 35l3 3M9 35l-3 3" stroke="#cbd5e1" strokeWidth={2.5} strokeLinecap="round" />
            <circle cx={18} cy={26} r={11} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2} />
            <circle cx={14} cy={22} r={3} fill="#f8fafc" opacity={0.6} />
          </g>
          <path d="M26 16c3-3 4-6 7-7" stroke="#a16207" strokeWidth={2} fill="none" />
          <circle className="gi-spark" cx={34} cy={8} r={3} fill="#fbbf24" />
          <g className="gi-flag">
            <path d="M38 44V24" stroke="#e2e8f0" strokeWidth={2} />
            <path d="M38 24l9 4-9 4z" fill="#ef4444" />
          </g>
        </svg>
      );
    case "pool":
      return (
        <svg viewBox="0 0 48 48" className={cls} aria-hidden="true">
          <circle cx={42} cy={24} r={5} fill="#020617" stroke="#78350f" strokeWidth={2} />
          <path className="gi-cue" d="M0 24h12" stroke="#d6a76b" strokeWidth={3} strokeLinecap="round" />
          <g className="gi-ball">
            <circle cx={24} cy={24} r={9} fill="#111827" stroke="#e5e7eb" strokeWidth={1} />
            <circle cx={24} cy={21} r={4} fill="#f8fafc" />
            <text x={24} y={22.6} textAnchor="middle" fontSize={5} fontWeight={700} fill="#111827">8</text>
          </g>
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 48 48" className={cls} aria-hidden="true">
          <circle className="gi-bubble" cx={18} cy={22} r={10} fill="#38bdf8" opacity={0.5} />
          <circle className="gi-bubble" cx={32} cy={30} r={7} fill="#a78bfa" opacity={0.5} />
        </svg>
      );
  }
}
