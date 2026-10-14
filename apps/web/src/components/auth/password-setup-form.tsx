"use client";

import { passwordSetupInputSchema } from "@esim-erp/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetStaffPassword } from "@/hooks/staff";

const PASSWORD_FORM_SCHEMA = passwordSetupInputSchema
  .pick({ password: true })
  .extend({
    confirmation: z.string().min(1, "Ulangi kata sandi baru."),
  })
  .refine((values) => values.password === values.confirmation, {
    message: "Kata sandi tidak sama.",
    path: ["confirmation"],
  });

type PasswordFormValues = z.infer<typeof PASSWORD_FORM_SCHEMA>;

export function PasswordSetupForm() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string>();
  const [isLoaded, setIsLoaded] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const form = useForm<PasswordFormValues>({
    defaultValues: { password: "", confirmation: "" },
    resolver: zodResolver(PASSWORD_FORM_SCHEMA),
  });
  const { reset } = form;
  const setup = useSetStaffPassword();

  useEffect(() => {
    function loadGrant() {
      const fragment = window.location.hash;
      if (fragment) {
        const candidate = new URLSearchParams(fragment.slice(1)).get("token");
        const parsed =
          passwordSetupInputSchema.shape.token.safeParse(candidate);
        setToken(parsed.success ? parsed.data : undefined);
        setIsComplete(false);
        reset();
        // Keep access grants out of copied addresses and subsequent navigation.
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
      setIsLoaded(true);
    }

    loadGrant();
    window.addEventListener("hashchange", loadGrant);
    return () => window.removeEventListener("hashchange", loadGrant);
  }, [reset]);

  async function handleSubmit(values: PasswordFormValues) {
    if (!token) return;

    try {
      await setup.submit({ token, password: values.password });
      setToken(undefined);
      form.reset();
      queryClient.clear();
      setIsComplete(true);
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Kata sandi belum dapat disimpan. Coba lagi atau minta tautan baru ke admin.",
      });
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2 text-sm font-semibold">
          <Radio aria-hidden="true" className="size-5" />
          eSIM ERP
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>Tetapkan kata sandi</h1>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isComplete ? (
              <div className="flex flex-col gap-4">
                <Alert role="status" variant="success">
                  <AlertTitle>Kata sandi disimpan</AlertTitle>
                  <AlertDescription>
                    Masuk dengan email staf dan kata sandi baru. Tautan ini
                    sudah digunakan.
                  </AlertDescription>
                </Alert>
                <Button
                  nativeButton={false}
                  render={<Link href="/auth/login" />}
                >
                  Masuk ke ERP
                </Button>
              </div>
            ) : !isLoaded ? (
              <p className="text-sm text-muted-foreground" role="status">
                Memeriksa tautan…
              </p>
            ) : !token ? (
              <Alert variant="warning">
                <AlertTitle>Tautan tidak valid</AlertTitle>
                <AlertDescription>
                  Buka tautan lengkap dari admin atau minta tautan baru.
                </AlertDescription>
              </Alert>
            ) : (
              <form
                className="flex flex-col gap-4"
                noValidate
                onSubmit={form.handleSubmit(handleSubmit)}
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="new-password">Kata sandi baru</Label>
                  <Input
                    aria-describedby="new-password-help new-password-error"
                    aria-invalid={Boolean(form.formState.errors.password)}
                    autoComplete="new-password"
                    id="new-password"
                    maxLength={128}
                    type="password"
                    {...form.register("password")}
                  />
                  <p
                    className="text-xs text-muted-foreground"
                    id="new-password-help"
                  >
                    Gunakan minimal 12 karakter.
                  </p>
                  {form.formState.errors.password ? (
                    <p
                      className="text-sm text-destructive"
                      id="new-password-error"
                    >
                      {form.formState.errors.password.message}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="confirm-password">Ulangi kata sandi</Label>
                  <Input
                    aria-describedby={
                      form.formState.errors.confirmation
                        ? "confirm-password-error"
                        : undefined
                    }
                    aria-invalid={Boolean(form.formState.errors.confirmation)}
                    autoComplete="new-password"
                    id="confirm-password"
                    maxLength={128}
                    type="password"
                    {...form.register("confirmation")}
                  />
                  {form.formState.errors.confirmation ? (
                    <p
                      className="text-sm text-destructive"
                      id="confirm-password-error"
                    >
                      {form.formState.errors.confirmation.message}
                    </p>
                  ) : null}
                </div>
                {form.formState.errors.root ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {form.formState.errors.root.message}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Button
                  aria-busy={setup.isPending}
                  className="w-full"
                  disabled={setup.isPending}
                  type="submit"
                >
                  Simpan kata sandi
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
        {!isComplete ? (
          <Link
            className="text-center text-xs underline underline-offset-4"
            href="/auth/login"
          >
            Kembali ke halaman masuk
          </Link>
        ) : null}
      </div>
    </main>
  );
}
