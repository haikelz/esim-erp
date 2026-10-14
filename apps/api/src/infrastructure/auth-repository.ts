import { staffSchema } from "@esim-erp/contracts";
import { and, eq, gt, sql } from "drizzle-orm";
import type { AuthRepository } from "../modules/auth/usecase";
import { hashToken } from "./crypto";
import type { Database } from "./database";
import { loginBuckets, sessions, users } from "./schema";

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
      .where(and(eq(users.email, email), eq(users.isActive, true)))
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
  ) {
    await database.insert(sessions).values({ tokenHash, userId, expiresAt });
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
        ),
      )
      .limit(1);

    return staff ? staffSchema.parse(staff) : undefined;
  }

  async function revokeSession(tokenHash: string) {
    await database.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  return {
    allowLogin,
    createSession,
    findCredentials,
    findSession,
    revokeSession,
  };
}
