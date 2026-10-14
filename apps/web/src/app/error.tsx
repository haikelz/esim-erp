"use client";

import { ErrorNotice } from "@/components/common/data-state";

type ErrorPageProps = { readonly retry: () => void };

export default function ErrorPage({ retry }: ErrorPageProps) {
  return (
    <ErrorNotice
      error={
        new Error(
          "Halaman belum dapat dibuka. Pastikan API lokal sedang berjalan atau hubungi administrator.",
        )
      }
      onRetry={retry}
    />
  );
}
