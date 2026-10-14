import type {
  ListQuery,
  PasswordSetupInput,
  Staff,
  StaffAccessLink,
  StaffInvite,
  StaffMember,
  StaffPage,
  StaffUpdate,
} from "@esim-erp/contracts";
import type { AuthCrypto } from "../auth/usecase";
import { requireRole } from "../auth/usecase";
import { DomainError } from "../errors";

export const INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_LIFETIME_MS = 60 * 60 * 1000;

export type IssuedStaffAccess = Omit<StaffAccessLink, "url" | "expiresAt"> & {
  expiresAt: Date;
};

export type StaffRepository = {
  list: (query: ListQuery) => Promise<StaffPage>;
  invite: (
    actorId: string,
    input: StaffInvite,
    tokenHash: string,
  ) => Promise<IssuedStaffAccess>;
  update: (
    actorId: string,
    userId: string,
    input: StaffUpdate,
  ) => Promise<StaffMember>;
  issueAccessLink: (
    actorId: string,
    userId: string,
    tokenHash: string,
  ) => Promise<IssuedStaffAccess>;
  hasValidAccessToken: (tokenHash: string) => Promise<boolean>;
  consumeAccessToken: (
    tokenHash: string,
    passwordHash: string,
  ) => Promise<boolean>;
};

function accessLink(
  grant: IssuedStaffAccess,
  token: string,
  webOrigin: string,
): StaffAccessLink {
  const url = new URL("/auth/set-password", webOrigin);
  url.hash = new URLSearchParams({ token }).toString();

  return {
    ...grant,
    url: url.toString(),
    expiresAt: grant.expiresAt.toISOString(),
  };
}

export function listStaff(
  repository: StaffRepository,
  actor: Staff,
  query: ListQuery,
) {
  requireRole(actor, ["admin"]);
  return repository.list(query);
}

export async function inviteStaff(
  repository: StaffRepository,
  crypto: AuthCrypto,
  actor: Staff,
  input: StaffInvite,
  webOrigin: string,
) {
  requireRole(actor, ["admin"]);
  const token = crypto.randomToken();
  const grant = await repository.invite(
    actor.id,
    input,
    await crypto.hashToken(token),
  );

  return accessLink(grant, token, webOrigin);
}

export function updateStaff(
  repository: StaffRepository,
  actor: Staff,
  userId: string,
  input: StaffUpdate,
) {
  requireRole(actor, ["admin"]);
  return repository.update(actor.id, userId, input);
}

export async function issueStaffAccessLink(
  repository: StaffRepository,
  crypto: AuthCrypto,
  actor: Staff,
  userId: string,
  webOrigin: string,
) {
  requireRole(actor, ["admin"]);
  const token = crypto.randomToken();
  const grant = await repository.issueAccessLink(
    actor.id,
    userId,
    await crypto.hashToken(token),
  );

  return accessLink(grant, token, webOrigin);
}

export async function setStaffPassword(
  repository: StaffRepository,
  crypto: AuthCrypto,
  input: PasswordSetupInput,
) {
  const tokenHash = await crypto.hashToken(input.token);
  // Unknown or expired links must not consume the password KDF's CPU budget.
  if (!(await repository.hasValidAccessToken(tokenHash)))
    throw invalidAccessLink();

  const passwordHash = await crypto.hashPassword(input.password);
  if (!(await repository.consumeAccessToken(tokenHash, passwordHash)))
    throw invalidAccessLink();
}

function invalidAccessLink() {
  return new DomainError(
    "access_link_invalid",
    400,
    "Tautan sudah dipakai, kedaluwarsa, atau dicabut. Minta tautan baru ke admin.",
  );
}
