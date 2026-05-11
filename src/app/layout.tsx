import type { Metadata } from "next";
import {
  Hind_Siliguri,
  Inter,
  JetBrains_Mono,
  Source_Serif_4,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";

const uiSans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const legacyUiSans = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const banglaSans = Hind_Siliguri({
  variable: "--font-hind-siliguri",
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
});

const uiMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const paperSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "FSQuest",
  description:
    "Bangla question paper generator for primary school teachers, with OCR indexing and DOCX export.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${uiSans.variable} ${legacyUiSans.variable} ${banglaSans.variable} ${uiMono.variable} ${paperSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
