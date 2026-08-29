import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrueMask",
  description: "Protect sensitive information. Prove image integrity.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
