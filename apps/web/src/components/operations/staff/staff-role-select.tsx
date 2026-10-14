"use client";

import { STAFF_ROLES, type StaffRole } from "@esim-erp/contracts";
import type { FocusEventHandler, Ref } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const STAFF_ROLE_LABELS = {
  admin: "Admin",
  sales: "Sales",
  operations: "Operasional",
  finance: "Keuangan",
} satisfies Record<StaffRole, string>;

const STAFF_ROLE_OPTIONS = STAFF_ROLES.map((role) => ({
  label: STAFF_ROLE_LABELS[role],
  value: role,
}));

type StaffRoleSelectProps = {
  readonly describedBy?: string;
  readonly disabled?: boolean;
  readonly id: string;
  readonly inputRef?: Ref<HTMLButtonElement>;
  readonly isInvalid: boolean;
  readonly onBlur: FocusEventHandler<HTMLButtonElement>;
  readonly onChange: (role: StaffRole) => void;
  readonly value: StaffRole;
};

export function StaffRoleSelect({
  describedBy,
  disabled,
  id,
  inputRef,
  isInvalid,
  onBlur,
  onChange,
  value,
}: StaffRoleSelectProps) {
  return (
    <Select
      disabled={disabled}
      items={STAFF_ROLE_OPTIONS}
      onValueChange={(role) => {
        if (role) onChange(role);
      }}
      value={value}
    >
      <SelectTrigger
        aria-describedby={describedBy}
        aria-invalid={isInvalid}
        className="w-full"
        id={id}
        onBlur={onBlur}
        ref={inputRef}
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAFF_ROLE_OPTIONS.map((role) => (
          <SelectItem key={role.value} value={role.value}>
            {role.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
