import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import GameBackground from "@/components/GameBackground";
import GuardShell from "@/components/GuardShell";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DuoPlay — Game 2 người",
  description: "Trang web game giải trí chỉ dành cho 2 người: caro, cờ vua, bong bóng, bida…",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-slate-950 text-slate-100`}>
        <GameBackground />
        <GuardShell />
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6">
          <header className="mb-8 flex items-center justify-between">
            <Link href="/" className="text-xl font-bold tracking-tight text-cyan-300">
              Duo<span className="text-fuchsia-300">Play</span></Link>
            <span className="text-xs text-slate-400">Chơi chung · 2 người</span>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="mt-10 border-t border-slate-800 pt-4 text-center text-xs text-slate-500">
            Local-only prototype · không cần tài khoản
          </footer>
        </div>
      </body>
    </html>
  );
}