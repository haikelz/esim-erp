import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/common/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ERP eSIM", template: "%s | ERP eSIM" },
  description: "Operasional internal untuk penjualan travel eSIM.",
  robots: { index: false, follow: false },
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml" },
    apple: { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
  },
  appleWebApp: { capable: true, title: "ERP eSIM", statusBarStyle: "default" },
};

type RootLayoutProps = { readonly children: ReactNode };

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      lang="id"
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
