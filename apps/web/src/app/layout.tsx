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
