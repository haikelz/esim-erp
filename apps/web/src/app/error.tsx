"use client";

import { ErrorNotice } from "@/components/common/data-state";

type ErrorPageProps = { readonly retry: () => void };

export default function ErrorPage({ retry }: ErrorPageProps) {
  return (
    <ErrorNotice
      error={
        new Error(
          "Halaman belum dapat dibuka. Coba lagi atau hubungi administrator.",
        )
      }
      onRetry={retry}
    />
  );
}
