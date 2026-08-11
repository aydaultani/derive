import type { Metadata, Viewport } from "next";
import { Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const displayFace = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const monoFace = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "DERIVE — one spin a day",
  description:
    "Enter a NYC address or ZIP. DERIVE deals you a real place, reachable by subway, with a dare attached. No rerolls.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${displayFace.variable} ${monoFace.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-ground text-platform">{children}</body>
    </html>
  );
}
