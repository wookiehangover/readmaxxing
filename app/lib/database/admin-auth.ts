import { timingSafeEqual } from "node:crypto";

function adminAuthResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export function requireAdminToken(request: Request): void {
  const expectedToken = process.env.ADMIN_API_TOKEN;
  if (!expectedToken) {
    throw adminAuthResponse("not_configured", 503);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token || !safeTokenEqual(token, expectedToken)) {
    throw adminAuthResponse("admin_auth_required", 401);
  }
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  const compareBuffer = Buffer.alloc(expectedBuffer.length);
  actualBuffer.copy(compareBuffer, 0, 0, expectedBuffer.length);

  const tokensEqual = timingSafeEqual(compareBuffer, expectedBuffer);
  return tokensEqual && actualBuffer.length === expectedBuffer.length;
}
