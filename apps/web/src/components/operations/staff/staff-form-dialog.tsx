"use client";

import {
  type StaffAccessLink,
  type StaffInvite,
  type StaffMember,
  type StaffUpdate,
  staffInviteSchema,
  staffUpdateSchema,
} from "@esim-erp/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/reui/alert";
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
import { Switch } from "@/components/ui/switch";
import { useCreateStaffAccessLink, useUpdateStaff } from "@/hooks/staff";
import { StaffRoleSelect } from "./staff-role-select";

type StaffInviteDialogProps = {
  readonly onClose: () => void;
  readonly onCreated: (link: StaffAccessLink) => void;
};

export function StaffInviteDialog({
  onClose,
  onCreated,
}: StaffInviteDialogProps) {
  const form = useForm<StaffInvite>({
    defaultValues: { name: "", email: "", role: "sales" },
    resolver: zodResolver(staffInviteSchema),
  });
  const invitation = useCreateStaffAccessLink();

  async function handleSubmit(values: StaffInvite) {
    try {
      const link = await invitation.submit({ kind: "invite", values });
      onCreated(link);
      onClose();
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Undangan belum dapat dibuat.",
      });
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !invitation.isPending) onClose();
      }}
      open
    >
      <DialogContent showCloseButton={!invitation.isPending}>
        <DialogHeader>
          <DialogTitle>Undang staf</DialogTitle>
          <DialogDescription>
            Akun aktif setelah staf menetapkan kata sandi. Bagikan tautan
            melalui kanal internal yang aman.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit(handleSubmit)}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-name">Nama staf</Label>
            <Input
              aria-describedby={
                form.formState.errors.name ? "staff-name-error" : undefined
              }
              aria-invalid={Boolean(form.formState.errors.name)}
              autoComplete="name"
              id="staff-name"
              maxLength={100}
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <p className="text-sm text-destructive" id="staff-name-error">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-email">Email staf</Label>
            <Input
              aria-describedby={
                form.formState.errors.email ? "staff-email-error" : undefined
              }
              aria-invalid={Boolean(form.formState.errors.email)}
              autoComplete="email"
              id="staff-email"
              maxLength={254}
              type="email"
              {...form.register("email")}
            />
            {form.formState.errors.email ? (
              <p className="text-sm text-destructive" id="staff-email-error">
                {form.formState.errors.email.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-role">Peran staf</Label>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <StaffRoleSelect
                  disabled={invitation.isPending}
                  id="staff-role"
                  inputRef={field.ref}
                  isInvalid={Boolean(form.formState.errors.role)}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                  value={field.value}
                />
              )}
            />
          </div>
          {form.formState.errors.root ? (
            <Alert variant="destructive">
              <AlertDescription>
                {form.formState.errors.root.message}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              disabled={invitation.isPending}
              onClick={onClose}
              size="sm"
              type="button"
              variant="outline"
            >
              Batal
            </Button>
            <Button
              aria-busy={invitation.isPending}
              disabled={invitation.isPending}
              size="sm"
              type="submit"
            >
              Buat undangan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type StaffUpdateDialogProps = {
  readonly member: StaffMember;
  readonly onClose: () => void;
};

export function StaffUpdateDialog({ member, onClose }: StaffUpdateDialogProps) {
  const form = useForm<StaffUpdate>({
    defaultValues: { role: member.role, isActive: member.isActive },
    resolver: zodResolver(staffUpdateSchema),
  });
  const update = useUpdateStaff();

  async function handleSubmit(values: StaffUpdate) {
    try {
      await update.mutateAsync({ id: member.id, values });
      toast.success("Akses staf diperbarui.");
      onClose();
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Akses belum dapat disimpan.",
      });
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !update.isPending) onClose();
      }}
      open
    >
      <DialogContent
        finalFocus={() => document.getElementById(`staff-access-${member.id}`)}
        showCloseButton={!update.isPending}
      >
        <DialogHeader>
          <DialogTitle>Kelola akses staf</DialogTitle>
          <DialogDescription>
            {member.name} · {member.email}. Perubahan peran atau status mencabut
            seluruh sesi aktif akun ini.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit(handleSubmit)}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-update-role">Peran staf</Label>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <StaffRoleSelect
                  disabled={update.isPending}
                  id="staff-update-role"
                  inputRef={field.ref}
                  isInvalid={Boolean(form.formState.errors.role)}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                  value={field.value}
                />
              )}
            />
          </div>
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <Label className="justify-between" htmlFor="staff-active">
                Izinkan akun masuk
                <Switch
                  checked={field.value}
                  disabled={update.isPending}
                  id="staff-active"
                  onCheckedChange={field.onChange}
                />
              </Label>
            )}
          />
          <p className="text-xs text-muted-foreground">
            Admin terakhir tidak dapat dinonaktifkan.
          </p>
          {form.formState.errors.root ? (
            <Alert variant="destructive">
              <AlertDescription>
                {form.formState.errors.root.message}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              disabled={update.isPending}
              onClick={onClose}
              size="sm"
              type="button"
              variant="outline"
            >
              Batal
            </Button>
            <Button
              aria-busy={update.isPending}
              disabled={update.isPending}
              size="sm"
              type="submit"
            >
              {form.watch("isActive") ? "Simpan akses" : "Nonaktifkan akun"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
