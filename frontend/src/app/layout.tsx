import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DocMind AI — Neural Document Intelligence Platform",
  description:
    "Upload PDF, DOCX, CSV, and XLSX files for instant AI-powered Q&A and summaries using hierarchical hybrid RAG with cross-encoder reranking and persistent cross-session memory.",
  keywords: [
    "document summarizer",
    "AI",
    "RAG",
    "semantic search",
    "document analysis",
    "hierarchical chunking",
    "BM25",
    "cross-encoder",
    "reranking",
    "Gemini",
    "Groq",
    "LLM",
  ],
  authors: [{ name: "DocMind AI" }],
  creator: "DocMind AI",
  applicationName: "DocMind AI",
  category: "productivity",
  openGraph: {
    title: "DocMind AI — Neural Document Intelligence",
    description:
      "High-precision document Q&A with hybrid RAG, cross-encoder reranking, and global cross-session memory.",
    type: "website",
    locale: "en_US",
    siteName: "DocMind AI",
  },
  twitter: {
    card: "summary_large_image",
    title: "DocMind AI — Neural Document Intelligence",
    description:
      "High-precision document Q&A with hybrid RAG, cross-encoder reranking, and global cross-session memory.",
  },
  robots: {
    index: false,
    follow: false,
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="DocMind AI" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body>{children}</body>
    </html>
  );
}
