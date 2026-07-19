import type { Metadata } from "next";
import "reactflow/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://pathforge-one-mu.vercel.app"),
  title: "PathForge",
  description:
    "Courses give you a syllabus. This gives you a map. Turn any learning goal into an interactive skill map.",
  openGraph: {
    title: "PathForge",
    description: "Courses give you a syllabus. This gives you a map.",
    url: "https://pathforge-one-mu.vercel.app",
    siteName: "PathForge",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PathForge",
    description: "Courses give you a syllabus. This gives you a map.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full w-full antialiased">
      <body className="h-full w-full overflow-hidden">{children}</body>
    </html>
  );
}
