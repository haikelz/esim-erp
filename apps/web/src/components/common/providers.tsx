"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { HttpError } from "@/lib/http";

type ProvidersProps = { readonly children: ReactNode };

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: {
            staleTime: 10000,
            retry: (count, error) =>
              count < 1 && !(error instanceof HttpError && error.status < 500),
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster closeButton position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
