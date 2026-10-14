import { staffMemberSchema } from "@esim-erp/contracts";
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { DomainError } from "../modules/errors";
import {
  INVITATION_LIFETIME_MS,
  PASSWORD_RESET_LIFETIME_MS,
  type StaffRepository,
} from "../modules/staff/usecase";
import type { Database, Transaction } from "./database";
import { auditEvents, sessions, staffAccessTokens, users } from "./schema";

const STAFF_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  onboardedAt: users.onboardedAt,
  createdAt: users.createdAt,
};

type StaffRecord = Pick<typeof users.$inferSelect, keyof typeof STAFF_COLUMNS>;

function toStaffMember(user: StaffRecord) {
  return staffMemberSchema.parse({
    ...user,
    onboardedAt: user.onboardedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  });
}

async function lockStaffAdministration(transaction: Transaction) {
  // Serialize privilege changes and password redemption to preserve the last admin.
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(143103)`);
}

async function assertCurrentAdmin(transaction: Transaction, actorId: string) {
  const [actor] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, actorId),
        eq(users.role, "admin"),
        eq(users.isActive, true),
        isNotNull(users.onboardedAt),
      ),
    )
    .limit(1);
  if (!actor)
    throw new DomainError(
      "forbidden",
      403,
      "Akses admin sudah tidak berlaku. Masuk kembali dengan akun yang berwenang.",
    );
}

function validAccessToken(tokenHash: string) {
  return and(
    eq(staffAccessTokens.tokenHash, tokenHash),
    isNull(staffAccessTokens.usedAt),
    gt(staffAccessTokens.expiresAt, new Date()),
    or(
      and(eq(staffAccessTokens.purpose, "invite"), isNull(users.onboardedAt)),
      and(
        eq(staffAccessTokens.purpose, "reset"),
        eq(users.isActive, true),
        isNotNull(users.onboardedAt),
      ),
    ),
  );
}

export function createStaffRepository(database: Database): StaffRepository {
  async function list(query: Parameters<StaffRepository["list"]>[0]) {
    const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    const filter = query.search
      ? or(ilike(users.name, pattern), ilike(users.email, pattern))
      : undefined;
    const rows = await database
      .select(STAFF_COLUMNS)
      .from(users)
      .where(filter)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    const [totals] = await database
      .select({ total: count() })
      .from(users)
      .where(filter);

    return { staff: rows.map(toStaffMember), total: totals?.total ?? 0 };
  }

  async function invite(
    actorId: string,
    input: Parameters<StaffRepository["invite"]>[1],
    tokenHash: string,
  ) {
    return database.transaction(async (transaction) => {
      await lockStaffAdministration(transaction);
      await assertCurrentAdmin(transaction, actorId);
      const [user] = await transaction
        .insert(users)
        .values({
          ...input,
          isActive: false,
          onboardedAt: null,
          passwordHash: "password-not-set",
        })
        .onConflictDoNothing({ target: users.email })
        .returning(STAFF_COLUMNS);
      if (!user)
        throw new DomainError(
          "staff_email_exists",
          409,
          "Email sudah terdaftar. Kelola akun yang ada atau gunakan email lain.",
        );

      const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
      await transaction
        .insert(staffAccessTokens)
        .values({ tokenHash, userId: user.id, purpose: "invite", expiresAt });
      await transaction.insert(auditEvents).values({
        actorId,
        action: "staff.invited",
        resourceId: user.id,
        details: { role: user.role },
      });

      return {
        staff: toStaffMember(user),
        expiresAt,
        purpose: "invite" as const,
      };
    });
  }

  async function update(
    actorId: string,
    userId: string,
    input: Parameters<StaffRepository["update"]>[2],
  ) {
    return database.transaction(async (transaction) => {
      await lockStaffAdministration(transaction);
      await assertCurrentAdmin(transaction, actorId);
      const [user] = await transaction
        .select(STAFF_COLUMNS)
        .from(users)
        .where(eq(users.id, userId))
        .for("update")
        .limit(1);
      if (!user)
        throw new DomainError(
          "staff_not_found",
          404,
          "Akun staf tidak ditemukan.",
        );
      if (actorId === userId && (input.role !== "admin" || !input.isActive))
        throw new DomainError(
          "self_access_removal",
          409,
          "Anda tidak dapat menonaktifkan atau menghapus akses admin sendiri.",
        );
      if (input.isActive && !user.onboardedAt)
        throw new DomainError(
          "staff_setup_required",
          409,
          "Staf harus mengatur kata sandi melalui undangan sebelum akun diaktifkan.",
        );

      if (
        user.role === "admin" &&
        user.isActive &&
        (input.role !== "admin" || !input.isActive)
      ) {
        const [admins] = await transaction
          .select({ total: count() })
          .from(users)
          .where(
            and(
              eq(users.role, "admin"),
              eq(users.isActive, true),
              isNotNull(users.onboardedAt),
            ),
          );
        if (!admins || admins.total <= 1)
          throw new DomainError(
            "last_admin",
            409,
            "Pertahankan minimal satu akun admin aktif.",
          );
      }
      if (
        user.role === input.role &&
        user.isActive === input.isActive &&
        input.isActive
      )
        return toStaffMember(user);

      const [updated] = await transaction
        .update(users)
        .set(input)
        .where(eq(users.id, userId))
        .returning(STAFF_COLUMNS);
      if (!updated) throw new Error("Staff update returned no user");
      await transaction.delete(sessions).where(eq(sessions.userId, userId));
      if (!input.isActive)
        await transaction
          .update(staffAccessTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(staffAccessTokens.userId, userId),
              isNull(staffAccessTokens.usedAt),
            ),
          );
      await transaction.insert(auditEvents).values({
        actorId,
        action:
          !user.onboardedAt && !input.isActive
            ? "staff.invitation_cancelled"
            : "staff.updated",
        resourceId: userId,
        details: {
          previousRole: user.role,
          role: input.role,
          previousActive: user.isActive,
          isActive: input.isActive,
        },
      });

      return toStaffMember(updated);
    });
  }

  async function issueAccessLink(
    actorId: string,
    userId: string,
    tokenHash: string,
  ) {
    return database.transaction(async (transaction) => {
      await lockStaffAdministration(transaction);
      await assertCurrentAdmin(transaction, actorId);
      const [user] = await transaction
        .select(STAFF_COLUMNS)
        .from(users)
        .where(eq(users.id, userId))
        .for("update")
        .limit(1);
      if (!user)
        throw new DomainError(
          "staff_not_found",
          404,
          "Akun staf tidak ditemukan.",
        );
      if (user.onboardedAt && !user.isActive)
        throw new DomainError(
          "staff_inactive",
          409,
          "Aktifkan akun staf sebelum membuat tautan reset kata sandi.",
        );

      const purpose = user.onboardedAt
        ? ("reset" as const)
        : ("invite" as const);
      const expiresAt = new Date(
        Date.now() +
          (purpose === "invite"
            ? INVITATION_LIFETIME_MS
            : PASSWORD_RESET_LIFETIME_MS),
      );
      await transaction
        .update(staffAccessTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(staffAccessTokens.userId, userId),
            isNull(staffAccessTokens.usedAt),
          ),
        );
      await transaction
        .insert(staffAccessTokens)
        .values({ tokenHash, userId, purpose, expiresAt });
      if (purpose === "reset")
        await transaction.delete(sessions).where(eq(sessions.userId, userId));
      await transaction.insert(auditEvents).values({
        actorId,
        action:
          purpose === "invite"
            ? "staff.invitation_reissued"
            : "staff.password_reset_requested",
        resourceId: userId,
      });

      return { staff: toStaffMember(user), expiresAt, purpose };
    });
  }

  async function hasValidAccessToken(tokenHash: string) {
    const [token] = await database
      .select({ userId: staffAccessTokens.userId })
      .from(staffAccessTokens)
      .innerJoin(users, eq(users.id, staffAccessTokens.userId))
      .where(validAccessToken(tokenHash))
      .limit(1);
    return Boolean(token);
  }

  async function consumeAccessToken(tokenHash: string, passwordHash: string) {
    return database.transaction(async (transaction) => {
      await lockStaffAdministration(transaction);
      const [token] = await transaction
        .select({
          userId: staffAccessTokens.userId,
          purpose: staffAccessTokens.purpose,
        })
        .from(staffAccessTokens)
        .innerJoin(users, eq(users.id, staffAccessTokens.userId))
        .where(validAccessToken(tokenHash))
        .for("update")
        .limit(1);
      if (!token) return false;

      await transaction
        .update(users)
        .set({ passwordHash, onboardedAt: new Date(), isActive: true })
        .where(eq(users.id, token.userId));
      await transaction
        .update(staffAccessTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(staffAccessTokens.userId, token.userId),
            isNull(staffAccessTokens.usedAt),
          ),
        );
      await transaction
        .delete(sessions)
        .where(eq(sessions.userId, token.userId));
      await transaction.insert(auditEvents).values({
        actorId: token.userId,
        action:
          token.purpose === "invite"
            ? "staff.onboarded"
            : "staff.password_changed",
        resourceId: token.userId,
      });

      return true;
    });
  }

  return {
    list,
    invite,
    update,
    issueAccessLink,
    hasValidAccessToken,
    consumeAccessToken,
  };
}
