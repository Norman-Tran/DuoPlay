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
    case "wordle":
      return (
        <svg viewBox="0 0 48 48" className={cls} aria-hidden="true">
          {[
            ["gi-wt", "#6aaa64", "W"],
            ["gi-wt2", "#c9b458", "O"],
            ["gi-wt3", "#787c7e", "R"],
          ].map(([c, fill, ch], i) => (
            <g key={i} className={c}>
              <rect x={2 + i * 15.5} y={14} width={13} height={13} rx={1.5} fill={fill} />
              <text x={8.5 + i * 15.5} y={24.5} textAnchor="middle" fontSize={10} fontWeight={800} fill="#fff">{ch}</text>
            </g>
          ))}
          <rect x={2} y={31} width={13} height={13} rx={1.5} fill="none" stroke="#565758" strokeWidth={1.5} />
          <rect x={17.5} y={31} width={13} height={13} rx={1.5} fill="none" stroke="#565758" strokeWidth={1.5} />
          <rect x={33} y={31} width={13} height={13} rx={1.5} fill="none" stroke="#565758" strokeWidth={1.5} />
        </svg>
      );
    case "domino":
      return (
        <svg viewBox="0 0 48 48" className={cls} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <g key={i} className={i === 0 ? "gi-d1" : i === 1 ? "gi-d2" : ""}>
              <rect x={6 + i * 13} y={10} width={11} height={30} rx={2} fill="#f5eedc" stroke="#1c1917" strokeWidth={1.2} />
              <path d={`M${7.5 + i * 13} 25h8`} stroke="#1c1917" strokeWidth={1} />
              <circle cx={11.5 + i * 13} cy={17.5} r={1.6} fill="#1c1917" />
              <circle cx={9 + i * 13} cy={30} r={1.4} fill="#1c1917" />
              <circle cx={14 + i * 13} cy={35} r={1.4} fill="#1c1917" />
            </g>
          ))}
        </svg>
      );
    case "uno":
      return (
        <svg viewBox="0 0 48 48" className={cls} aria-hidden="true">
          <defs>
            <clipPath id="gi-uno-clip">
              <rect x={16} y={9} width={16} height={26} rx={2} />
            </clipPath>
          </defs>
          {[
            ["gi-u1", "#0b63c5", -16, ""],
            ["gi-u3", "#2aa84a", 16, ""],
            ["", "#e2231a", 0, "UNO"],
          ].map(([c, fill, rot, txt], i) => (
            <g key={i} className={c as string}>
              <g transform={`rotate(${rot} 24 44)`}>
                <rect x={14} y={7} width={20} height={30} rx={3} fill="#fff" stroke="#d4d4d4" strokeWidth={0.5} />
                <rect x={16} y={9} width={16} height={26} rx={2} fill={fill as string} />
                <g clipPath="url(#gi-uno-clip)">
                  <ellipse cx={24} cy={22} rx={6.2} ry={10.5} transform="rotate(35 24 22)" fill="#fff" />
                </g>
                {txt ? (
                  <text x={24} y={24.6} textAnchor="middle" fontSize={7.2} fontWeight={900} fontStyle="italic"
                    fill="#f6c400" stroke="#111" strokeWidth={0.9} style={{ paintOrder: "stroke" }}
                    transform="rotate(-18 24 22)" fontFamily="Arial Black, Arial, sans-serif">UNO</text>
                ) : (
                  <text x={24} y={26} textAnchor="middle" fontSize={10} fontWeight={900} fill={fill as string}
                    fontFamily="Arial Black, Arial, sans-serif">7</text>
                )}
              </g>
            </g>
          ))}
        </svg>
      );
    case "go":
      return (
        <svg viewBox="0 0 48 48" className={cls} aria-hidden="true">
          <defs>
            <radialGradient id="gib" cx="35%" cy="30%" r="70%"><stop offset="0%" stopColor="#666" /><stop offset="100%" stopColor="#050505" /></radialGradient>
            <radialGradient id="giw" cx="35%" cy="30%" r="75%"><stop offset="0%" stopColor="#fff" /><stop offset="100%" stopColor="#bdb6a6" /></radialGradient>
          </defs>
          <rect x={2} y={2} width={44} height={44} rx={4} fill="#dcae5d" />
          {[10, 18, 26, 34, 42].map((k) => (
            <g key={k} stroke="#5b4018" strokeWidth={0.8}><path d={`M6 ${k - 4}H42M${k - 4} 6V42`} /></g>
          ))}
          <circle className="gi-s1" cx={14} cy={14} r={5.5} fill="url(#gib)" />
          <circle className="gi-s2" cx={22} cy={22} r={5.5} fill="url(#giw)" />
          <circle className="gi-s3" cx={30} cy={22} r={5.5} fill="url(#gib)" />
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
