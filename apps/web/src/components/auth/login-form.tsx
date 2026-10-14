"use client";

import { type LoginInput, loginInputSchema } from "@esim-erp/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginStaff } from "@/services/auth";

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<LoginInput>({
    defaultValues: { email: "", password: "" },
    resolver: zodResolver(loginInputSchema),
  });

  async function handleSubmit(values: LoginInput) {
    try {
      await loginStaff(values);
      queryClient.clear();
      router.replace("/app");
      router.refresh();
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error ? error.message : "Login gagal. Coba lagi.",
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
              <h1>Masuk ke ERP</h1>
            </CardTitle>
            <CardDescription>
              Akses operasional travel eSIM untuk staf internal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={form.handleSubmit(handleSubmit)}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email staf</Label>
                <Input
                  aria-describedby={
                    form.formState.errors.email ? "email-error" : undefined
                  }
                  aria-invalid={Boolean(form.formState.errors.email)}
                  autoComplete="username"
                  id="email"
                  type="email"
                  {...form.register("email")}
                />
                {form.formState.errors.email ? (
                  <p className="text-sm text-destructive" id="email-error">
                    {form.formState.errors.email.message}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Kata sandi</Label>
                <Input
                  aria-describedby={
                    form.formState.errors.password
                      ? "password-error"
                      : undefined
                  }
                  aria-invalid={Boolean(form.formState.errors.password)}
                  autoComplete="current-password"
                  id="password"
                  type="password"
                  {...form.register("password")}
                />
                {form.formState.errors.password ? (
                  <p className="text-sm text-destructive" id="password-error">
                    {form.formState.errors.password.message}
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
                className="w-full"
                disabled={form.formState.isSubmitting}
                type="submit"
              >
                {form.formState.isSubmitting ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : null}
                Masuk
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Tidak ada pendaftaran publik. Akun dikelola admin.
        </p>
      </div>
    </main>
  );
}
