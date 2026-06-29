import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import "./globals.css";

// Display serif for the model name, matching the reference typography.
const serif = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

// Clean grotesque sans for taglines and UI chrome.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "lamp · iverfinne.no",
  description: "3D-modellvisar — ein modell om gongen.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="no" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
