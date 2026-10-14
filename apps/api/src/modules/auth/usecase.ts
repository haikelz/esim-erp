import type { LoginInput, Staff, StaffRole } from "@esim-erp/contracts";
import { DomainError } from "../errors";

export type AuthRepository = {
  findCredentials: (
    email: string,
  ) => Promise<(Staff & { passwordHash: string }) | undefined>;
  allowLogin: (key: string) => Promise<boolean>;
  createSession: (
    tokenHash: string,
    userId: string,
    expiresAt: Date,
    passwordHash: string,
  ) => Promise<void>;
  findSession: (tokenHash: string) => Promise<Staff | undefined>;
  revokeSession: (tokenHash: string) => Promise<void>;
};

export type AuthCrypto = {
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (
    password: string,
    hash: string | undefined,
  ) => Promise<boolean>;
  hashToken: (token: string) => Promise<string>;
  randomToken: () => string;
};

export async function login(
  repository: AuthRepository,
  crypto: AuthCrypto,
  input: LoginInput,
) {
  if (!(await repository.allowLogin(input.email))) {
    throw new DomainError(
      "login_rate_limited",
      429,
      "Terlalu banyak percobaan. Tunggu satu menit lalu coba lagi.",
    );
  }

  const credentials = await repository.findCredentials(input.email);
  const isValid = await crypto.verifyPassword(
    input.password,
    credentials?.passwordHash,
  );
  if (!isValid || !credentials) {
    throw new DomainError(
      "invalid_credentials",
      401,
      "Email atau kata sandi salah.",
    );
  }

  const token = crypto.randomToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await repository.createSession(
    await crypto.hashToken(token),
    credentials.id,
    expiresAt,
    credentials.passwordHash,
  );

  const { passwordHash: _passwordHash, ...staff } = credentials;
  return { staff, token, expiresAt };
}

export async function authenticate(
  repository: AuthRepository,
  crypto: AuthCrypto,
  token: string | undefined,
): Promise<Staff> {
  if (!token || token.length > 128) {
    throw new DomainError(
      "unauthenticated",
      401,
      "Silakan masuk ke akun staf.",
    );
  }

  const staff = await repository.findSession(await crypto.hashToken(token));
  if (!staff) {
    throw new DomainError(
      "session_expired",
      401,
      "Sesi berakhir. Silakan masuk lagi.",
    );
  }

  return staff;
}

export function requireRole(staff: Staff, roles: readonly StaffRole[]) {
  if (!roles.includes(staff.role)) {
    throw new DomainError(
      "forbidden",
      403,
      "Akun ini tidak memiliki izin untuk tindakan tersebut.",
    );
  }
}
