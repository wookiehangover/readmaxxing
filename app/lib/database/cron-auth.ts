import { timingSafeEqual } from "node:crypto";
export function isCronAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const authorization = request.headers.get("Authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const actual = Buffer.from(provided),
    wanted = Buffer.from(expected),
    compare = Buffer.alloc(wanted.length);
  actual.copy(compare, 0, 0, wanted.length);
  return timingSafeEqual(compare, wanted) && actual.length === wanted.length;
}
