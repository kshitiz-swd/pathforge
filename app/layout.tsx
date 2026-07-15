import type { Metadata } from "next";
import "reactflow/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "PathForge",
  description: "Turn any learning goal into an interactive skill tree.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
