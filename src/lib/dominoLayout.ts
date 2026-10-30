/**
 * Snake layout for a domino line of play (units: short side = 1, long side = 2).
 * Starts from the first tile at the centre; the right arm runs E, then wraps
 * downward (S) and back W, the left arm runs W then wraps upward (N) and back E.
 * Doubles are placed crosswise. Each tile is oriented so the touching halves match.
 */
export type ChainTile = { a: number; b: number; double: boolean; seat: string; n: number };
export type Placed = { x: number; y: number; angle: number; first: number; second: number; n: number; seat: string; double: boolean };
export type EndMark = { x: number; y: number };
type V = { x: number; y: number };

const angleOf = (h: V) => (h.x === 1 ? 0 : h.y === 1 ? 90 : h.x === -1 ? 180 : 270);

function arm(tiles: ChainTile[], start: V, startPrevDouble: boolean, firstH: V, vertical: V, bound: number, reverseHalves: boolean) {
  const out: Placed[] = [];
  let P = { ...start };
  let h = firstH;
  let lastHorizontal = firstH;
  let prevDouble = startPrevDouble;
  let travelled = 0;
  const turn = (nh: V) => {
    const ext = prevDouble ? 1 : 0.5;
    P = { x: P.x - h.x * 0.5 + nh.x * ext, y: P.y - h.y * 0.5 + nh.y * ext };
    if (nh.y === 0) lastHorizontal = nh;
    h = nh;
    travelled = 0;
  };
  const step = (t: ChainTile | null) => {
    const dbl = t ? t.double : false;
    const L = dbl ? 1 : 2;
    if (!dbl) {
      if (h.y === 0 && (P.x + h.x * L) * h.x > bound) turn(vertical);
      else if (h.y !== 0 && travelled >= 2) turn({ x: -lastHorizontal.x, y: 0 });
    }
    const c = { x: P.x + (h.x * L) / 2, y: P.y + (h.y * L) / 2 };
    return { c, L, dbl };
  };
  for (const t of tiles) {
    const { c, L, dbl } = step(t);
    out.push({
      x: c.x, y: c.y, angle: angleOf(h) + (dbl ? 90 : 0),
      first: reverseHalves ? t.b : t.a, second: reverseHalves ? t.a : t.b,
      n: t.n, seat: t.seat, double: dbl,
    });
    P = { x: P.x + h.x * L, y: P.y + h.y * L };
    if (h.y !== 0) travelled += L;
    prevDouble = dbl;
  }
  // where the next (non-double) tile would go
  const save = { P, h, prevDouble, travelled, lastHorizontal };
  const { c } = step(null);
  const end: EndMark = c;
  void save;
  return { out, end };
}

export function layoutChain(chain: ChainTile[], anchor: number, bound = 6.5) {
  if (!chain.length) return { tiles: [] as Placed[], left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  const A = chain[anchor];
  const half = A.double ? 0.5 : 1;
  const tiles: Placed[] = [
    { x: 0, y: 0, angle: A.double ? 90 : 0, first: A.a, second: A.b, n: A.n, seat: A.seat, double: A.double },
  ];
  const R = arm(chain.slice(anchor + 1), { x: half, y: 0 }, A.double, { x: 1, y: 0 }, { x: 0, y: 1 }, bound, false);
  const L = arm(chain.slice(0, anchor).reverse(), { x: -half, y: 0 }, A.double, { x: -1, y: 0 }, { x: 0, y: -1 }, bound, true);
  return { tiles: [...tiles, ...R.out, ...L.out], left: L.end, right: R.end };
}
