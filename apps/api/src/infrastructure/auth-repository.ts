import { staffSchema } from "@esim-erp/contracts";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { AuthRepository } from "../modules/auth/usecase";
import { DomainError } from "../modules/errors";
import { hashToken } from "./crypto";
import type { Database } from "./database";
import { auditEvents, loginBuckets, sessions, users } from "./schema";

export function createAuthRepository(database: Database): AuthRepository {
  async function findCredentials(email: string) {
    const [user] = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(
        and(
          eq(users.email, email),
          eq(users.isActive, true),
          isNotNull(users.onboardedAt),
        ),
      )
      .limit(1);

    return user;
  }

  async function allowLogin(email: string) {
    const key = await hashToken(`login:${email}`);
    const [bucket] = await database
      .insert(loginBuckets)
      .values({ key, attempts: 1, windowStartedAt: new Date() })
      .onConflictDoUpdate({
        target: loginBuckets.key,
        set: {
          attempts: sql`CASE WHEN ${loginBuckets.windowStartedAt} < now() - interval '1 minute' THEN 1 ELSE ${loginBuckets.attempts} + 1 END`,
          windowStartedAt: sql`CASE WHEN ${loginBuckets.windowStartedAt} < now() - interval '1 minute' THEN now() ELSE ${loginBuckets.windowStartedAt} END`,
        },
      })
      .returning({ attempts: loginBuckets.attempts });

    return Boolean(bucket && bucket.attempts <= 10);
  }

  async function createSession(
    tokenHash: string,
    userId: string,
    expiresAt: Date,
    passwordHash: string,
  ) {
    await database.transaction(async (transaction) => {
      const [active] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, userId),
            eq(users.passwordHash, passwordHash),
            eq(users.isActive, true),
            isNotNull(users.onboardedAt),
          ),
        )
        .for("share")
        .limit(1);
      if (!active)
        throw new DomainError(
          "invalid_credentials",
          401,
          "Email atau kata sandi salah.",
        );

      await transaction
        .insert(sessions)
        .values({ tokenHash, userId, expiresAt });
      await transaction.insert(auditEvents).values({
        actorId: userId,
        action: "staff.logged_in",
        resourceId: userId,
      });
    });
  }

  async function findSession(tokenHash: string) {
    const [staff] = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
          eq(users.isActive, true),
          isNotNull(users.onboardedAt),
        ),
      )
      .limit(1);

    return staff ? staffSchema.parse(staff) : undefined;
  }

  async function revokeSession(tokenHash: string) {
    await database.transaction(async (transaction) => {
      const [session] = await transaction
        .delete(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .returning({ userId: sessions.userId });
      if (session)
        await transaction.insert(auditEvents).values({
          actorId: session.userId,
          action: "staff.logged_out",
          resourceId: session.userId,
        });
    });
  }

  return {
    allowLogin,
    createSession,
    findCredentials,
    findSession,
    revokeSession,
  };
}
