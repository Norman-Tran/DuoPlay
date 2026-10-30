import Link from "next/link";

/** Button-styled back link with a left-sliding arrow on hover. */
export default function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="btn-fx group inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm font-medium text-cyan-300 hover:border-cyan-500/70 hover:bg-slate-900"
    >
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-translate-x-1 group-focus-visible:-translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
        aria-hidden="true"
      >
        <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </Link>
  );
}
