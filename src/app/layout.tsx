import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prediction Market Scanner",
  description: "Arbitrage detection across Polymarket and Kalshi",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-terminal-bg text-gray-100 antialiased">
        <div className="grid-pattern min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
