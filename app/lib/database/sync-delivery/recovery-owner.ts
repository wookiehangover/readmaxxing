/** Fence a tab's captured account against the account authenticated by its current cookie. */
export function recoveryOwnerError(request: Request, userId: string): Response | null {
  const expectedOwner = request.headers.get("X-Recovery-Owner");
  if (!expectedOwner && request.method === "POST")
    return Response.json({ error: "Recovery account required" }, { status: 400 });
  if (expectedOwner !== null && expectedOwner !== userId)
    return Response.json(
      { error: "Recovery account changed", code: "account_changed" },
      { status: 409 },
    );
  return null;
}
