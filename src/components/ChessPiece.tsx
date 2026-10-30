// Simple Staunton-style chess pieces drawn in code (no external assets).
// White = ivory with dark outline, black = near-black with light outline.
type Props = { color: "w" | "b"; type: string; className?: string };

export default function ChessPiece({ color, type, className }: Props) {
  const fill = color === "w" ? "#fbf5e6" : "#1f1f22";
  const stroke = color === "w" ? "#1b1b1b" : "#e9e4d6";
  const detail = color === "w" ? "#1b1b1b" : "#e9e4d6";
  const common = { fill, stroke, strokeWidth: 1.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  const base = <path {...common} d="M11 39h23v-3.5c0-1.5-1-2.5-2.5-2.5h-18c-1.5 0-2.5 1-2.5 2.5z" />;
  let body: React.ReactNode = null;
  switch (type) {
    case "p":
      body = (
        <>
          <path {...common} d="M15 33c0-5 3-8 5-10-2-1-3-3-3-5 0-3 2.5-5.5 5.5-5.5S28 15 28 18c0 2-1 4-3 5 2 2 5 5 5 10z" />
          {base}
        </>
      );
      break;
    case "r":
      body = (
        <>
          <path {...common} d="M13 11h4v3h3v-3h5v3h3v-3h4v6l-3 3v10l3 3H13l3-3V20l-3-3z" />
          <path fill="none" stroke={detail} strokeWidth={1.3} d="M16 20h13M16 30h13" />
          {base}
        </>
      );
      break;
    case "n":
      body = (
        <>
          <path {...common} d="M14 33c0-6 6-8 7-14-3 2-5 3-7 3-2 0-3-2-2-3.5L19 11l1-3 2 2.5c6 0 11 5 11 13v9.5z" />
          <circle cx={18.5} cy={15} r={1.2} fill={detail} />
          {base}
        </>
      );
      break;
    case "b":
      body = (
        <>
          <circle {...common} cx={22.5} cy={8.5} r={2.2} />
          <path {...common} d="M16 31c-2-4-2-10 1-14 2-3 4-5 5.5-6.5C24 12 26 14 28 17c3 4 3 10 1 14z" />
          <path fill="none" stroke={detail} strokeWidth={1.3} d="M20.5 18.5l4 4M22.5 15v6" />
          <path {...common} d="M15 31h15v2H15z" />
          {base}
        </>
      );
      break;
    case "q":
      body = (
        <>
          <path {...common} d="M12 31l-3-17 6 9 2-11 5.5 10L28 12l2 11 6-9-3 17z" />
          {[9, 17, 22.5, 28, 36].map((x, i) => (
            <circle key={i} {...common} cx={x} cy={i === 0 || i === 4 ? 12.5 : i === 2 ? 9.5 : 10.5} r={2} />
          ))}
          <path fill="none" stroke={detail} strokeWidth={1.3} d="M13 28h19" />
          {base}
        </>
      );
      break;
    case "k":
      body = (
        <>
          <path fill="none" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" d="M22.5 5v7M19 8.5h7" />
          <path fill="none" stroke={fill} strokeWidth={1.1} strokeLinecap="round" d="M22.5 5v7M19 8.5h7" />
          <path {...common} d="M12 32c-4-5-4-13 2-15 4-1 7 2 8.5 5 1.5-3 4.5-6 8.5-5 6 2 6 10 2 15z" />
          <path {...common} d="M20 20c0-3 1-6 2.5-7.5C24 14 25 17 25 20l-2.5 3z" />
          <path fill="none" stroke={detail} strokeWidth={1.3} d="M13 28h19" />
          {base}
        </>
      );
      break;
  }
  return (
    <svg viewBox="0 0 45 45" className={className} aria-hidden="true" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))" }}>
      {body}
    </svg>
  );
}
