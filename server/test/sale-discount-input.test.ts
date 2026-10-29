import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { executeOperation, type OperationAccess } from "../src/operations.ts";
import { ApiError } from "../src/errors.ts";

test("DSC07 desconto malformado retorna entrada inválida sem consultar o banco", async () => {
  let connections = 0;
  const pool = { connect() { connections++; throw new Error("Banco não deve ser necessário para recusar tipo inválido."); } } as unknown as Pool;
  const access: OperationAccess = { tenantId: "10000000-0000-4000-8000-000000000001", actorId: "10000000-0000-4000-8000-000000000002", pool, permissions: ["sales.create", "sales.discount"] };
  for (const discountCents of [{ valueOf: "x", toString: "x" }, {}, [], "100", null, true, -1, 0.5]) {
    await assert.rejects(executeOperation(access, { requestId: "10000000-0000-4000-8000-000000000003", type: "sale.confirm", data: { customerId: "10000000-0000-4000-8000-000000000004", items: [{ productId: "10000000-0000-4000-8000-000000000005", quantity: 1, version: 1, discountCents }] } }), (error: unknown) => error instanceof ApiError && error.statusCode === 400);
  }
  assert.equal(connections, 0);
});
