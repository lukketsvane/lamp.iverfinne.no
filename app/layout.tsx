import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="no">
      <body>{children}</body>
    </html>
  );
}
