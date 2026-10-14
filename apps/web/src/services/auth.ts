import {
  type LoginInput,
  okSchema,
  type Staff,
  staffSchema,
} from "@esim-erp/contracts";
import { request } from "@/lib/http";

export function loginStaff(input: LoginInput): Promise<Staff> {
  return request("/api/auth/login", staffSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logoutStaff() {
  return request("/api/auth/logout", okSchema, { method: "POST" });
}
