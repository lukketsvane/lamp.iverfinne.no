import type { Metadata, Viewport } from "next";
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
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "lamp",
  },
  formatDetection: { telephone: false },
};

// iOS-native chrome: cover the full screen (under the notch/home indicator),
// lock zoom so pinch/double-tap don't fight the 3D gestures.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efece4" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
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
