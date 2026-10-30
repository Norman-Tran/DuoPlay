// Classic-style UNO card drawn in SVG (no external assets).
export type UnoCardT = { id: string; color: "r" | "y" | "g" | "b" | "w"; value: string };

export const UNO_HEX: Record<string, string> = { r: "#e2231a", y: "#f6c400", g: "#2aa84a", b: "#0b63c5", w: "#111" };

function label(value: string) {
  if (value === "skip") return "⊘";
  if (value === "reverse") return "⇄";
  if (value === "draw2") return "+2";
  if (value === "wild4") return "+4";
  if (value === "wild") return "";
  return value;
}

export function UnoBack({ w = 64 }: { w?: number }) {
  const h = w * 1.5;
  return (
    <svg width={w} height={h} viewBox="0 0 64 96" aria-hidden="true">
      <rect x={1} y={1} width={62} height={94} rx={7} fill="#fff" stroke="#bbb" />
      <defs>
        <clipPath id="uno-back-clip"><rect x={4.5} y={4.5} width={55} height={87} rx={5} /></clipPath>
      </defs>
      <rect x={4.5} y={4.5} width={55} height={87} rx={5} fill="#111" />
      <g clipPath="url(#uno-back-clip)"><ellipse cx={32} cy={48} rx={18} ry={33} transform="rotate(35 32 48)" fill="#e2231a" /></g>
      <text x={32} y={55} textAnchor="middle" fontSize={19} fontWeight={900} fontStyle="italic" fill="#f6c400" stroke="#111" strokeWidth={1.2}
        transform="rotate(-18 32 50)" style={{ paintOrder: "stroke" }}>UNO</text>
    </svg>
  );
}

export default function UnoCard({ card, w = 64 }: { card: UnoCardT; w?: number }) {
  const h = w * 1.5;
  const fill = UNO_HEX[card.color];
  const wild = card.color === "w";
  const txt = label(card.value);
  const small = txt.length > 1 ? 9 : 11;
  const clip = `uc-${card.id}`;
  return (
    <svg width={w} height={h} viewBox="0 0 64 96" aria-label={`${card.color} ${card.value}`}>
      <defs>
        <clipPath id={clip}><rect x={4.5} y={4.5} width={55} height={87} rx={5} /></clipPath>
      </defs>
      <rect x={1} y={1} width={62} height={94} rx={7} fill="#fff" stroke="#bbb" />
      <rect x={4.5} y={4.5} width={55} height={87} rx={5} fill={fill} />
      <g clipPath={`url(#${clip})`}><g transform="rotate(35 32 48)">
        {wild ? (
          <>
            <clipPath id={`o-${card.id}`}><ellipse cx={32} cy={48} rx={18} ry={33} /></clipPath>
            <g clipPath={`url(#o-${card.id})`}>
              <rect x={0} y={0} width={32} height={48} fill={UNO_HEX.r} />
              <rect x={32} y={0} width={32} height={48} fill={UNO_HEX.b} />
              <rect x={0} y={48} width={32} height={48} fill={UNO_HEX.y} />
              <rect x={32} y={48} width={32} height={48} fill={UNO_HEX.g} />
            </g>
            <ellipse cx={32} cy={48} rx={18} ry={33} fill="none" stroke="#fff" strokeWidth={3} />
          </>
        ) : (
          <ellipse cx={32} cy={48} rx={18} ry={33} fill="#fff" />
        )}
      </g></g>
      {txt && (
        <text x={32} y={59} textAnchor="middle" fontSize={txt.length > 1 ? 26 : 32} fontWeight={900}
          fill={wild ? "#fff" : fill} stroke={wild ? "#111" : "#111"} strokeWidth={wild ? 2 : 1.4} style={{ paintOrder: "stroke" }}
          fontFamily="Arial Black, Arial, sans-serif">
          {txt}
        </text>
      )}
      <text x={9} y={17} fontSize={small} fontWeight={900} fill="#fff" stroke="#111" strokeWidth={0.8} style={{ paintOrder: "stroke" }}>{txt || "W"}</text>
      <text x={55} y={79} fontSize={small} fontWeight={900} fill="#fff" stroke="#111" strokeWidth={0.8} style={{ paintOrder: "stroke" }}
        textAnchor="end" transform="rotate(180 50 75)">{txt || "W"}</text>
    </svg>
  );
}
