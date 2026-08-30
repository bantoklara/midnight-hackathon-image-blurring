"use client";

import dynamic from "next/dynamic";

const TrueMaskApp = dynamic(() => import("@/components/TrueMaskApp"), { 
  ssr: false,
  loading: () => <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white">Loading TrueMask...</div>
});

export default function Home() {
  return <TrueMaskApp />;
}
