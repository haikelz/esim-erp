"use client";

import type { StaffAccessLink, StaffMember } from "@esim-erp/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { RecordsTable } from "@/components/common/records-table";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import type { DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useListQuery } from "@/hooks/list-query";
import {
  useCreateStaffAccessLink,
  useStaff,
  useUpdateStaff,
} from "@/hooks/staff";
import { formatDate } from "@/lib/format";
import { StaffInviteDialog, StaffUpdateDialog } from "./staff-form-dialog";
import { STAFF_ROLE_LABELS } from "./staff-role-select";

type StaffAction = {
  readonly kind: "access_link" | "cancel_invitation";
  readonly member: StaffMember;
};
type StaffPageProps = { readonly currentStaffId: string };

export function StaffPage({ currentStaffId }: StaffPageProps) {
  const list = useListQuery();
  const [isInviting, setIsInviting] = useState(false);
  const [editing, setEditing] = useState<StaffMember>();
  const [action, setAction] = useState<StaffAction>();
  const [actionError, setActionError] = useState<string>();
  const [accessLink, setAccessLink] = useState<StaffAccessLink>();
  const staff = useStaff(list.query);
  const access = useCreateStaffAccessLink();
  const update = useUpdateStaff();

  async function handleConfirm() {
    if (!action || access.isPending || update.isPending) return;

    setActionError(undefined);
    try {
      if (action.kind === "cancel_invitation") {
        await update.mutateAsync({
          id: action.member.id,
          values: { role: action.member.role, isActive: false },
        });
        toast.success("Tautan undangan dicabut. Akun tetap tidak aktif.");
      } else {
        setAccessLink(
          await access.submit({ kind: "replace", id: action.member.id }),
        );
      }
      setAction(undefined);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Permintaan belum dapat diproses.",
      );
    }
  }

  async function handleCopy() {
    if (!accessLink) return;

    try {
      await navigator.clipboard.writeText(accessLink.url);
      toast.success("Tautan disalin. Bagikan hanya kepada staf yang dituju.");
    } catch {
      toast.error(
        "Clipboard tidak tersedia. Salin tautan dari kolom dengan keyboard.",
        { duration: Number.POSITIVE_INFINITY },
      );
    }
  }

  const columns = useMemo<ColumnDef<DataGridFeatures, StaffMember>[]>(() => {
    function selectAction(next: StaffAction) {
      setActionError(undefined);
      setAction(next);
    }

    return [
      {
        accessorKey: "name",
        header: "Staf",
        size: 235,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium">
              {row.original.name}
              {row.original.id === currentStaffId ? " (Anda)" : ""}
            </span>
            <span className="break-all text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Peran",
        size: 140,
        cell: ({ row }) => (
          <Badge variant="outline">
            {STAFF_ROLE_LABELS[row.original.role]}
          </Badge>
        ),
      },
      {
        accessorKey: "isActive",
        header: "Akses",
        size: 175,
        cell: ({ row }) => (
          <Badge
            variant={
              !row.original.onboardedAt
                ? "warning-light"
                : row.original.isActive
                  ? "success-light"
                  : "secondary"
            }
          >
            {!row.original.onboardedAt
              ? "Belum diaktifkan"
              : row.original.isActive
                ? "Aktif"
                : "Nonaktif"}
          </Badge>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Dibuat (WIB)",
        size: 185,
        cell: ({ row }) => (
          <span className="text-xs">{formatDate(row.original.createdAt)}</span>
        ),
      },
      {
        id: "actions",
        header: "Tindakan",
        size: 280,
        cell: ({ row }) =>
          row.original.id === currentStaffId ? (
            <span className="text-xs text-muted-foreground">Akun Anda</span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {row.original.onboardedAt ? (
                <Button
                  aria-label={`Kelola akses ${row.original.name}`}
                  id={`staff-access-${row.original.id}`}
                  onClick={() => setEditing(row.original)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Kelola akses
                </Button>
              ) : (
                <Button
                  aria-label={`Batalkan undangan ${row.original.name}`}
                  onClick={() =>
                    selectAction({
                      kind: "cancel_invitation",
                      member: row.original,
                    })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Batalkan undangan
                </Button>
              )}
              {!row.original.onboardedAt || row.original.isActive ? (
                <Button
                  aria-label={`Buat tautan ${row.original.name}`}
                  onClick={() =>
                    selectAction({ kind: "access_link", member: row.original })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {row.original.onboardedAt
                    ? "Reset kata sandi"
                    : "Buat tautan baru"}
                </Button>
              ) : null}
            </div>
          ),
      },
    ];
  }, [currentStaffId]);

  return (
    <>
      <PageHeader
        action={
          <Button onClick={() => setIsInviting(true)} size="sm" type="button">
            <UserPlus aria-hidden="true" data-icon="inline-start" />
            Undang staf
          </Button>
        }
        description="Undang staf dan atur aksesnya."
        title="Administrasi staf"
      />
      <RecordsTable
        columns={columns}
        emptyAction={
          <Button onClick={() => setIsInviting(true)} size="sm" type="button">
            Undang staf
          </Button>
        }
        emptyDescription="Undang staf untuk memberi akses ke ERP."
        error={staff.error}
        isLoading={staff.isPending || staff.isPlaceholderData}
        list={list}
        onRetry={() => {
          void staff.refetch();
        }}
        rows={staff.isPlaceholderData ? [] : (staff.data?.staff ?? [])}
        searchPlaceholder="Cari nama atau email staf…"
        title="Daftar staf"
        total={staff.data?.total ?? 0}
      />
      {isInviting ? (
        <StaffInviteDialog
          onClose={() => setIsInviting(false)}
          onCreated={setAccessLink}
        />
      ) : null}
      {editing ? (
        <StaffUpdateDialog
          key={editing.id}
          member={editing}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !access.isPending && !update.isPending)
            setAction(undefined);
        }}
        open={Boolean(action)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action?.kind === "cancel_invitation"
                ? "Batalkan undangan?"
                : "Buat tautan akses baru?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action?.member.name}.{" "}
              {action?.kind === "cancel_invitation"
                ? "Seluruh tautan akun ini dicabut dan akun tetap tidak aktif."
                : action?.member.onboardedAt
                  ? "Seluruh sesi akun ini langsung dicabut. Kata sandi berubah setelah tautan dipakai; tautan sebelumnya tidak lagi berlaku."
                  : "Tautan sebelumnya tidak lagi berlaku. Bagikan tautan baru hanya kepada staf ini."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={access.isPending || update.isPending}
              size="sm"
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              aria-busy={access.isPending || update.isPending}
              disabled={access.isPending || update.isPending}
              onClick={() => void handleConfirm()}
              size="sm"
              type="button"
            >
              {action?.kind === "cancel_invitation"
                ? "Batalkan undangan"
                : "Buat tautan baru"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        onOpenChange={(open) => {
          if (!open) setAccessLink(undefined);
        }}
        open={Boolean(accessLink)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tautan akses staf</DialogTitle>
            <DialogDescription>
              {accessLink?.staff.name} · {accessLink?.staff.email}. Bagikan
              tautan sekali pakai melalui kanal internal yang aman.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-access-url">Tautan rahasia</Label>
            <Input
              autoComplete="off"
              id="staff-access-url"
              readOnly
              type="password"
              value={accessLink?.url ?? ""}
            />
            <p className="text-xs text-muted-foreground">
              Berlaku sampai{" "}
              {accessLink ? formatDate(accessLink.expiresAt) : "—"} WIB. Salin
              sebelum menutup dialog.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setAccessLink(undefined)}
              size="sm"
              type="button"
              variant="outline"
            >
              Tutup
            </Button>
            <Button onClick={() => void handleCopy()} size="sm" type="button">
              <Copy aria-hidden="true" data-icon="inline-start" />
              Salin tautan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
