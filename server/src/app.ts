import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import { Pool } from "pg";
import type { ApiConfig } from "./config.js";
import { createAuth } from "./auth.js";
import { allowedKeys, createCustomerRecord, getCustomer, inputRecord, listCustomers, requireUuid, updateCustomerRecord } from "./customers.js";
import { ApiError, forbidden, invalidInput, notFound, unauthenticated, unavailable } from "./errors.js";
import { permissionsForRole, requirePermission, type Permission } from "./permissions.js";
import { createAccountsService, type AccountContext } from "./accounts.js";
import { executeOperation, listOperations, operationHistory, purchasePlan, commandPermissions, resourcePermission } from "./operations.js";

export type BuildOptions = { config: ApiConfig; controlPool: Pool; logger?: FastifyServerOptions["logger"] };

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const { config, controlPool } = options;
  const app = Fastify({ logger: options.logger ?? { level: "info" },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false, requestIdHeader: false, genReqId: () => randomUUID(), bodyLimit: 65536 });
  const databaseUrls = new Map(Object.entries(config.tenantDatabaseUrls));
  if (databaseUrls.size > 16) throw new Error("Limite de configuração dos bancos excedido.");
  const pools = new Map<string, Pool>();
  const metadata = new WeakMap<FastifyRequest, { actorId?: string; tenantId?: string; code?: string }>();
  const attempts = new Map<string, { start: number; count: number }>();
  const accounts = createAccountsService(controlPool, config);
  type Auth = ReturnType<typeof createAuth>;
  let authReady: Promise<Auth> | null = null;

  const logDatabaseFailure = () => {
    try { app.log.warn({ event: "database.connection_unavailable" }, "database.connection_unavailable"); } catch { /* Logging cannot replace a request result. */ }
  };
  controlPool.on("error", logDatabaseFailure);

  // Do not eagerly leave a rejected library context promise when the database is unavailable.
  // Library schema validation remains enabled and is awaited before using authentication.
  async function getAuth(): Promise<Auth> {
    if (!authReady) {
      try {
        const instance = createAuth(controlPool, config, false);
        authReady = instance.$context.then(async (context) => {
          await context.checkSchema?.();
          return instance;
        }).catch(() => { authReady = null; throw unavailable(); });
      } catch { throw unavailable(); }
    }
    return authReady;
  }

  function libraryHeaders(request: FastifyRequest): Headers {
    const headers = new Headers();
    for (const key of ["cookie", "origin"] as const) {
      const value = request.headers[key];
      if (typeof value === "string") headers.set(key, value);
    }
    return headers;
  }

  async function readSession(request: FastifyRequest) {
    const auth = await getAuth();
    try { return await auth.api.getSession({ headers: libraryHeaders(request), query: { disableCookieCache: true, disableRefresh: true } }); }
    catch { throw unavailable(); }
  }

  async function authenticatedUser(request: FastifyRequest) {
    const session = await readSession(request);
    if (!session) throw unauthenticated();
    const user = { id: session.user.id, name: session.user.name, email: session.user.email };
    metadata.set(request, { ...metadata.get(request), actorId: user.id });
    return user;
  }

  function tenantPool(key: string): Pool {
    const url = databaseUrls.get(key);
    if (!url) throw unavailable();
    let pool = pools.get(key);
    if (!pool) {
      pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 800, idleTimeoutMillis: 10000, statement_timeout: 5000 });
      pool.on("error", logDatabaseFailure);
      pools.set(key, pool);
    }
    return pool;
  }

  async function authorize(request: FastifyRequest, rawTenantId: unknown, permission: Permission) {
    const user = await authenticatedUser(request);
    const tenantId = requireUuid(rawTenantId);
    let membership: { id: string; database_key: string; role: string; permission_overrides: unknown } | undefined;
    try {
      const result = await controlPool.query<{ id: string; database_key: string; role: string; permission_overrides: unknown }>(
        "SELECT t.id,t.database_key,m.role,m.permission_overrides FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.tenant_id=$2 AND m.active=true AND t.active=true", [user.id, tenantId]);
      membership = result.rows[0];
    } catch { throw unavailable(); }
    if (!membership) throw forbidden();
    requirePermission(membership.role, permission, membership.permission_overrides);
    metadata.set(request, { ...metadata.get(request), tenantId: membership.id });
    return { tenantId: membership.id, actorId: user.id, role: membership.role, overrides: membership.permission_overrides, permissions: permissionsForRole(membership.role, membership.permission_overrides), pool: tenantPool(membership.database_key) };
  }

  function checkLoginRate(request: FastifyRequest) {
    const now = Date.now();
    for (const [ip, value] of attempts) if (now - value.start >= 60000) attempts.delete(ip);
    let value = attempts.get(request.ip);
    if (!value) {
      if (attempts.size >= 10000) throw new ApiError(429, "RATE_LIMITED", "Aguarde antes de tentar entrar novamente.");
      value = { start: now, count: 0 }; attempts.set(request.ip, value);
    }
    if (value.count >= 5) throw new ApiError(429, "RATE_LIMITED", "Aguarde antes de tentar entrar novamente.");
    value.count++;
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("cache-control", "no-store").header("x-request-id", request.id);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== config.frontendOrigin) throw forbidden();
  });
  await app.register(cors, { origin: (origin, callback) => callback(null, origin === config.frontendOrigin),
    credentials: true, methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"], allowedHeaders: ["content-type"], exposedHeaders: ["x-request-id"] });
  app.setErrorHandler((error, request, reply) => {
    let safe: ApiError;
    const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
    if (error instanceof ApiError) safe = error;
    else if (typeof status === "number" && status >= 400 && status < 500)
      safe = new ApiError(status, "INVALID_INPUT", "Confira o formato do pedido.");
    else safe = new ApiError(500, "INTERNAL_ERROR", "Não foi possível concluir a operação.");
    metadata.set(request, { ...metadata.get(request), code: safe.code });
    reply.code(safe.statusCode).send({ error: { code: safe.code, message: safe.message, requestId: request.id } });
  });
  app.setNotFoundHandler(async () => { throw notFound(); });
  app.addHook("onResponse", async (request, reply) => {
    const context = metadata.get(request);
    try {
      request.log.info({ event: "http.completed", requestId: request.id, method: request.method,
        route: request.routeOptions.url ?? "not_found", status: reply.statusCode,
        ...(context?.actorId ? { actorId: context.actorId } : {}), ...(context?.tenantId ? { tenantId: context.tenantId } : {}),
        ...(context?.code ? { code: context.code } : {}) }, "http.completed");
    } catch { /* Observability cannot change an already confirmed operational result. */ }
  });
  app.addHook("onClose", async () => {
    controlPool.off("error", logDatabaseFailure);
    await Promise.all([...pools.values()].map((pool) => pool.end()));
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await accounts.assertReady();
    await getAuth();
    return { status: "ready" };
  });

  app.post("/api/auth/sign-in/email", async (request, reply) => {
    checkLoginRate(request);
    const body = inputRecord(request.body);
    allowedKeys(body, ["email", "password"]);
    if (typeof body.email !== "string" || body.email.trim().length > 254 || !body.email.trim() ||
        typeof body.password !== "string" || !body.password || body.password.length > 1024) throw invalidInput();
    const auth = await getAuth();
    const headers = libraryHeaders(request); headers.set("content-type", "application/json");
    let result: Response;
    try { result = await auth.handler(new Request(new URL("/api/auth/sign-in/email", config.baseUrl), {
      method: "POST", headers, body: JSON.stringify({ email: body.email.trim(), password: body.password }) })); }
    catch { throw unavailable(); }
    if (result.status >= 500) throw unavailable();
    if (result.status === 401) throw unauthenticated();
    if (result.status !== 200) throw invalidInput();
    // Better Auth's successful body includes a token. Only this public DTO is exposed.
    const output = await result.json() as { user?: { id?: unknown; name?: unknown; email?: unknown } };
    if (!output.user || typeof output.user.id !== "string" || typeof output.user.name !== "string" || typeof output.user.email !== "string") throw unavailable();
    const cookies = result.headers.getSetCookie();
    if (!cookies.length) throw unavailable();
    reply.header("set-cookie", cookies);
    return { user: { id: output.user.id, name: output.user.name, email: output.user.email } };
  });

  app.post("/api/auth/sign-out", async (request, reply) => {
    if (request.body !== undefined) allowedKeys(inputRecord(request.body), []);
    const auth = await getAuth();
    const headers = libraryHeaders(request); headers.set("content-type", "application/json");
    let result: Response;
    try { result = await auth.handler(new Request(new URL("/api/auth/sign-out", config.baseUrl), { method: "POST", headers, body: "{}" })); }
    catch { throw unavailable(); }
    if (result.status >= 500) throw unavailable();
    if (result.status !== 200) throw unauthenticated();
    // The library can swallow a database delete failure. Do not report revocation without verifying it.
    if (await readSession(request)) throw unavailable();
    const cookies = result.headers.getSetCookie();
    if (cookies.length) reply.header("set-cookie", cookies);
    return { success: true };
  });

  app.get("/api/v1/me", async (request) => {
    allowedKeys(inputRecord(request.query), []);
    const user = await authenticatedUser(request);
    try {
      const memberships = await controlPool.query<{ id: string; name: string; role: string; permission_overrides: unknown }>(
        "SELECT t.id,t.name,m.role,m.permission_overrides FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.active=true AND t.active=true ORDER BY t.id", [user.id]);
      return { user, tenants: memberships.rows.map((row) => ({ id: row.id, name: row.name, role: row.role, permissions: permissionsForRole(row.role, row.permission_overrides) })) };
    } catch { throw unavailable(); }
  });

  type TenantParams = { tenantId: string };
  const operationsBase = "/api/v1/tenants/:tenantId/operations";
  app.post<{ Params: TenantParams }>(`${operationsBase}/commands`, { bodyLimit: 2 * 1024 * 1024 }, async (request) => {
    const input = inputRecord(request.body), permission = typeof input.type === "string" ? commandPermissions[input.type] : undefined;
    if (!permission) throw invalidInput();
    const access = await authorize(request, request.params.tenantId, permission);
    allowedKeys(inputRecord(request.query), []);
    return { tenantId: access.tenantId, ...await executeOperation(access, input) };
  });
  app.post<{ Params: TenantParams }>(`${operationsBase}/purchase-plan`, { bodyLimit: 2 * 1024 * 1024 }, async (request) => {
    const access = await authorize(request, request.params.tenantId, "purchases.import");
    allowedKeys(inputRecord(request.query), []);
    return { tenantId: access.tenantId, ...await purchasePlan(access, request.body) };
  });
  app.get<{ Params: TenantParams }>(`${operationsBase}/history`, async (request) => {
    const access = await authorize(request, request.params.tenantId, "audit.read");
    const result = await operationHistory(access, request.query);
    let names: { id: string; name: string }[];
    try { names = (await controlPool.query<{ id: string; name: string }>('SELECT id,name FROM "user" WHERE id=ANY($1::text[])', [[...new Set(result.items.map((event) => event.actorId))]])).rows; }
    catch { throw unavailable(); }
    const byId = new Map(names.map((user) => [user.id, user.name]));
    return { tenantId: access.tenantId, ...result, items: result.items.map((event) => ({ ...event, actorName: byId.get(event.actorId) ?? "Conta não disponível" })) };
  });
  app.get<{ Params: TenantParams & { resource: string } }>(`${operationsBase}/:resource`, async (request) => {
    const access = await authorize(request, request.params.tenantId, resourcePermission(request.params.resource));
    return { tenantId: access.tenantId, ...await listOperations(access, request.params.resource, request.query) };
  });
  type CustomerParams = TenantParams & { id: string };
  type MemberParams = TenantParams & { userId: string };
  async function teamContext(request: FastifyRequest, rawTenantId: unknown): Promise<AccountContext> {
    const user = await authenticatedUser(request);
    const context = { tenantId: requireUuid(rawTenantId), actorId: user.id };
    await accounts.assertManager(context);
    metadata.set(request, { ...metadata.get(request), tenantId: context.tenantId });
    return context;
  }
  const teamBase = "/api/v1/tenants/:tenantId";
  app.get<{ Params: TenantParams }>(`${teamBase}/access-options`, async (request) => {
    const context = await teamContext(request, request.params.tenantId);
    allowedKeys(inputRecord(request.query), []);
    return { tenantId: context.tenantId, ...accounts.options() };
  });
  app.get<{ Params: TenantParams }>(`${teamBase}/members`, async (request) => {
    const context = await teamContext(request, request.params.tenantId);
    return { tenantId: context.tenantId, ...await accounts.list(context, request.query) };
  });
  app.get<{ Params: MemberParams }>(`${teamBase}/members/:userId`, async (request) => {
    const context = await teamContext(request, request.params.tenantId);
    allowedKeys(inputRecord(request.query), []);
    return { tenantId: context.tenantId, member: await accounts.get(context, request.params.userId) };
  });
  app.post<{ Params: TenantParams }>(`${teamBase}/members`, async (request, reply) => {
    const context = await teamContext(request, request.params.tenantId);
    allowedKeys(inputRecord(request.query), []);
    const member = await accounts.create(context, request.body);
    reply.code(201);
    return { tenantId: context.tenantId, member };
  });
  app.patch<{ Params: MemberParams }>(`${teamBase}/members/:userId`, async (request) => {
    const context = await teamContext(request, request.params.tenantId);
    allowedKeys(inputRecord(request.query), []);
    return { tenantId: context.tenantId, member: await accounts.update(context, request.params.userId, request.body) };
  });
  app.get<{ Params: TenantParams }>(`${teamBase}/access-audit`, async (request) => {
    const context = await teamContext(request, request.params.tenantId);
    return { tenantId: context.tenantId, ...await accounts.accessAudit(context, request.query) };
  });
  const base = "/api/v1/tenants/:tenantId/customers";
  app.get<{ Params: TenantParams }>(base, async (request) => {
    const access = await authorize(request, request.params.tenantId, "customers.read");
    return { tenantId: access.tenantId, ...await listCustomers(access.pool, request.query) };
  });
  app.get<{ Params: CustomerParams }>(`${base}/:id`, async (request) => {
    const access = await authorize(request, request.params.tenantId, "customers.read");
    allowedKeys(inputRecord(request.query), []);
    return { tenantId: access.tenantId, customer: await getCustomer(access.pool, requireUuid(request.params.id)) };
  });
  app.post<{ Params: TenantParams }>(base, async (request, reply) => {
    const access = await authorize(request, request.params.tenantId, "customers.create");
    allowedKeys(inputRecord(request.query), []);
    const customer = await createCustomerRecord(access.pool, request.body, access);
    reply.code(201);
    return { tenantId: access.tenantId, customer };
  });
  app.patch<{ Params: CustomerParams }>(`${base}/:id`, async (request) => {
    const access = await authorize(request, request.params.tenantId, "customers.update");
    allowedKeys(inputRecord(request.query), []);
    if (Object.hasOwn(inputRecord(request.body), "active")) requirePermission(access.role, "customers.archive", access.overrides);
    return { tenantId: access.tenantId, customer: await updateCustomerRecord(access.pool, requireUuid(request.params.id), request.body, access) };
  });
  await app.ready();
  return app;
}
