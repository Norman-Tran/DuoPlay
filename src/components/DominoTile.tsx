// Ivory domino tile drawn as SVG. Horizontal by default: `a` on the left, `b` on the right.
const PIPS: Record<number, [number, number][]> = {
  0: [],
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** Tile body centred on (0,0), size 2u x 1u. For use inside an <svg>. */
export function TileShape({ a, b, u, highlight }: { a: number; b: number; u: number; highlight?: boolean }) {
  const r = u * 0.12;
  const half = (v: number, cx: number) =>
    PIPS[v].map(([x, y], i) => <circle key={i} cx={cx + x * u * 0.26} cy={y * u * 0.26} r={u * 0.085} fill="#111" />);
  return (
    <g>
      <rect x={-u + u * 0.04} y={-u / 2 + u * 0.08} width={2 * u} height={u} rx={r} fill="rgba(0,0,0,0.35)" />
      <rect
        x={-u + u * 0.02} y={-u / 2 + u * 0.02} width={2 * u - u * 0.04} height={u - u * 0.04} rx={r}
        fill="#f6f0df" stroke={highlight ? "#22d3ee" : "#3b3326"} strokeWidth={highlight ? u * 0.08 : u * 0.03}
      />
      <line x1={0} y1={-u * 0.38} x2={0} y2={u * 0.38} stroke="#5b5243" strokeWidth={u * 0.035} />
      <circle cx={0} cy={0} r={u * 0.05} fill="#a08a5a" />
      {half(a, -u / 2)}
      {half(b, u / 2)}
    </g>
  );
}

/** Standalone tile (hand). Vertical: `a` on top. */
export default function DominoTile({ a, b, size = 34, highlight }: { a: number; b: number; size?: number; highlight?: boolean }) {
  return (
    <svg width={size} height={size * 2} viewBox={`${-size / 2} ${-size} ${size} ${size * 2}`} aria-label={`${a}-${b}`}>
      <g transform="rotate(90)">
        <TileShape a={a} b={b} u={size} highlight={highlight} />
      </g>
    </svg>
  );
}
