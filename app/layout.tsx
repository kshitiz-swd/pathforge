import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import "reactflow/dist/style.css";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-newsreader",
  fallback: ["Georgia", "serif"],
});

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
    <html lang="en" className={`${newsreader.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
