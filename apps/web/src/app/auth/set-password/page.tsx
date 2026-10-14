import type { Metadata } from "next";
import { PasswordSetupForm } from "@/components/auth/password-setup-form";

export const metadata: Metadata = {
  title: "Tetapkan kata sandi",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PasswordSetupForm />;
}
