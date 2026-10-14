import {
  type ListQuery,
  listQuerySchema,
  okSchema,
  type PasswordSetupInput,
  passwordSetupInputSchema,
  type StaffAccessLink,
  type StaffInvite,
  type StaffMember,
  type StaffPage,
  type StaffUpdate,
  staffAccessLinkSchema,
  staffInviteSchema,
  staffMemberSchema,
  staffPageSchema,
  staffUpdateSchema,
} from "@esim-erp/contracts";
import { request } from "@/lib/http";

export function listStaff(
  query: ListQuery,
  signal?: AbortSignal,
): Promise<StaffPage> {
  const filters = listQuerySchema.parse(query);
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: String(filters.limit),
    search: filters.search,
  });

  return request(`/api/backend/staff?${params}`, staffPageSchema, { signal });
}

export function inviteStaff(input: StaffInvite): Promise<StaffAccessLink> {
  return request("/api/backend/staff", staffAccessLinkSchema, {
    method: "POST",
    body: JSON.stringify(staffInviteSchema.parse(input)),
  });
}

export function updateStaff(
  id: string,
  input: StaffUpdate,
): Promise<StaffMember> {
  return request(
    `/api/backend/staff/${encodeURIComponent(id)}`,
    staffMemberSchema,
    {
      method: "PATCH",
      body: JSON.stringify(staffUpdateSchema.parse(input)),
    },
  );
}

export function createStaffAccessLink(id: string): Promise<StaffAccessLink> {
  return request(
    `/api/backend/staff/${encodeURIComponent(id)}/access-link`,
    staffAccessLinkSchema,
    { method: "POST" },
  );
}

export function setStaffPassword(input: PasswordSetupInput) {
  return request("/api/auth/set-password", okSchema, {
    method: "POST",
    body: JSON.stringify(passwordSetupInputSchema.parse(input)),
  });
}
