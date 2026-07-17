import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./theme.css";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin-root font-sans antialiased">{children}</div>;
}
