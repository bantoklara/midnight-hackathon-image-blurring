import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrueMask",
  description: "Protect sensitive information. Prove image integrity.",
};

/**
 * Which checkout is serving this page.
 *
 * A stale `next dev` from an unrelated copy of this project once served the app
 * on :3000 for hours, and its hardcoded demo detections were mistaken for broken
 * MediaPipe output. This is a Server Component, so `process.cwd()` is the real
 * directory — no env plumbing needed, and it never ships in a production build.
 */
const devCheckout =
  process.env.NODE_ENV === "development" ? process.cwd() : null;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        {devCheckout && (
          <div
            title={devCheckout}
            className="pointer-events-none fixed bottom-2 left-2 z-50 max-w-[90vw] truncate rounded-md border border-white/10 bg-black/70 px-2 py-1 font-mono text-[10px] text-white/40"
          >
            dev · {devCheckout}
          </div>
        )}
      </body>
    </html>
  );
}
