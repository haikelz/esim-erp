"use client";

import type { Staff } from "@esim-erp/contracts";
import { useQueryClient } from "@tanstack/react-query";
// One opacity-only page transition honors the brief's explicit Framer Motion requirement.
import { motion } from "framer-motion";
import {
  CircleAlert,
  ContactRound,
  LayoutDashboard,
  LogOut,
  Package,
  Radio,
  Receipt,
  ScrollText,
  ShoppingBag,
  SunMoon,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { logoutStaff } from "@/services/auth";

const NAVIGATION = [
  {
    href: "/app",
    label: "Ringkasan",
    icon: LayoutDashboard,
  },
  {
    href: "/app/products",
    label: "Paket & supplier",
    icon: Package,
  },
  {
    href: "/app/orders",
    label: "Order & fulfillment",
    icon: ShoppingBag,
  },
  {
    href: "/app/customers",
    label: "Pelanggan",
    icon: ContactRound,
    roles: ["admin", "sales"],
  },
  {
    href: "/app/exceptions",
    label: "Pengecualian operasional",
    icon: CircleAlert,
  },
  {
    href: "/app/billing",
    label: "Billing & finance",
    icon: Receipt,
    roles: ["admin", "finance"],
  },
  {
    href: "/app/staff",
    label: "Administrasi staf",
    icon: Users,
    roles: ["admin"],
  },
  {
    href: "/app/audit",
    label: "Riwayat audit",
    icon: ScrollText,
    roles: ["admin"],
  },
] as const;

type NavigationProps = { readonly staff: Staff };

function Navigation({ staff }: NavigationProps) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAVIGATION.filter(
            (entry) =>
              !("roles" in entry) ||
              entry.roles.some((role) => role === staff.role),
          ).map((entry) => {
            const isActive =
              entry.href === "/app"
                ? pathname === entry.href
                : pathname.startsWith(entry.href);
            return (
              <SidebarMenuItem key={entry.href}>
                <SidebarMenuButton
                  aria-current={isActive ? "page" : undefined}
                  isActive={isActive}
                  onClick={() => setOpenMobile(false)}
                  render={<Link href={entry.href} />}
                >
                  <entry.icon aria-hidden="true" />
                  <span>{entry.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

type AppShellProps = { readonly children: ReactNode; readonly staff: Staff };

export function AppShell({ children, staff }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logoutStaff();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Sesi server belum dapat dicabut. Sesi browser telah ditutup.",
        { duration: Number.POSITIVE_INFINITY },
      );
    } finally {
      queryClient.clear();
      router.replace("/auth/login");
      router.refresh();
    }
  }

  const activePage =
    NAVIGATION.find(
      (entry) => entry.href !== "/app" && pathname.startsWith(entry.href),
    ) ?? NAVIGATION[0];

  return (
    <SidebarProvider>
      <a
        className="sr-only z-50 bg-background p-3 text-sm underline focus:not-sr-only focus:absolute"
        href="#main-content"
      >
        Lewati navigasi
      </a>
      <Sidebar>
        <SidebarHeader className="gap-3 border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <Link className="flex items-center gap-2 font-semibold" href="/app">
              <Radio aria-hidden="true" className="size-5" />
              <span>eSIM ERP</span>
            </Link>
            <SidebarTrigger
              aria-label="Tutup navigasi"
              className="md:hidden"
              render={(buttonProps) => (
                <button type="button" {...buttonProps}>
                  <X aria-hidden="true" />
                </button>
              )}
              title="Tutup navigasi"
              type="button"
            />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Navigasi utama">
            <Navigation staff={staff} />
          </nav>
        </SidebarContent>
        <SidebarFooter className="gap-3 border-t p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium">{staff.name}</p>
            <span className="text-xs text-muted-foreground">
              Akses: {staff.role}
            </span>
          </div>
          <Button
            disabled={isLoggingOut}
            onClick={handleLogout}
            size="sm"
            type="button"
            variant="outline"
          >
            <LogOut aria-hidden="true" data-icon="inline-start" />
            Keluar
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0" id="main-content" tabIndex={-1}>
        <header className="sticky top-0 z-20 flex min-h-12 items-center justify-between gap-3 border-b bg-background px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger
              aria-label="Buka atau tutup navigasi"
              type="button"
            />
            <span className="truncate text-sm text-muted-foreground">
              {activePage.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label="Tema tampilan"
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <SunMoon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTheme("light")}>
                  Terang
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")}>
                  Gelap
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("system")}>
                  Sistem
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <motion.div
          animate={{ opacity: 1 }}
          className="mx-auto flex w-full min-w-0 max-w-[96rem] flex-col gap-6 px-4 py-6 lg:px-6"
          initial={{ opacity: 0 }}
          key={pathname}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </SidebarInset>
    </SidebarProvider>
  );
}
