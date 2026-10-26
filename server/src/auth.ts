import { betterAuth, type BetterAuthOptions } from "better-auth";
import type { Pool } from "pg";
import type { ApiConfig } from "./config.js";

export function createAuth(pool: Pool, config: ApiConfig, provisioning = false, provisioningKey?: string) {
  if (provisioningKey && (!provisioning || !/^[0-9a-f-]{36}$/i.test(provisioningKey))) throw new Error("Contexto de provisionamento inválido.");
  const secure = config.nodeEnv === "production" || config.baseUrl.startsWith("https:");
  return betterAuth({ ...authSchemaOptions(pool), baseURL: config.baseUrl, basePath: "/api/auth", secret: config.authSecret,
    trustedOrigins: [config.frontendOrigin],
    emailAndPassword: { enabled: true, disableSignUp: !provisioning, autoSignIn: false, minPasswordLength: 12 },
    session: { cookieCache: { enabled: false } },
    advanced: { useSecureCookies: secure, defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure } },
    ...(provisioningKey ? { databaseHooks: { user: { create: { before: async () => ({ data: { provisioningKey } }) } } } } : {}),
    // The HTTP adapter enforces limits using the connection IP, never a client-supplied proxy header.
    rateLimit: { enabled: false }, logger: { disabled: true },
  });
}

/** Only schema-affecting options; migrations do not start an auth instance or invent credentials. */
export function authSchemaOptions(pool: Pool): BetterAuthOptions {
  return { database: pool, emailAndPassword: { enabled: true },
    user: { additionalFields: { provisioningKey: { type: "string", required: false, input: false, returned: false } } },
    logger: { disabled: true } };
}
