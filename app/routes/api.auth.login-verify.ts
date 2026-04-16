import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getRpId, getRpOrigin, SESSION_MAX_AGE_SECONDS } from "~/lib/auth-config";
import { getChallenge, deleteChallenge } from "~/lib/database/auth/challenge";
import { getPasskeyById, updatePasskeyCounter } from "~/lib/database/auth/passkey";
import { createSession } from "~/lib/database/auth/session";
import { getUser } from "~/lib/database/user/user";
import { setSessionCookie } from "~/lib/database/auth-middleware";

interface LoginVerifyBody {
  challengeId: string;
  response: AuthenticationResponseJSON;
}

export async function action({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as LoginVerifyBody;
  const { challengeId, response } = body;

  if (!challengeId || !response) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Look up the challenge
  const challengeRow = await getChallenge(challengeId);
  if (!challengeRow) {
    return Response.json({ error: "Challenge not found or expired" }, { status: 400 });
  }

  // Clean up the challenge (single-use)
  await deleteChallenge(challengeId);

  // Look up the passkey by credential ID from the response
  const passkey = await getPasskeyById(response.id);
  if (!passkey) {
    return Response.json({ error: "Passkey not found" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: getRpOrigin(),
      expectedRPID: getRpId(),
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports
          ? (passkey.transports.split(",") as AuthenticatorTransport[])
          : undefined,
      },
    });
  } catch (err) {
    return Response.json({ error: "Verification failed", detail: String(err) }, { status: 400 });
  }

  if (!verification.verified) {
    return Response.json({ error: "Authentication not verified" }, { status: 400 });
  }

  // Update the passkey counter to prevent replay attacks
  await updatePasskeyCounter(passkey.id, verification.authenticationInfo.newCounter);

  // Create a server session
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const session = await createSession(passkey.userId, expiresAt);
  if (!session) {
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }

  // Resolve the user for the response
  const user = await getUser(passkey.userId);

  const headers = new Headers();
  setSessionCookie(headers, session.id);

  return Response.json(
    {
      verified: true,
      user: user ? { id: user.id, displayName: user.displayName } : null,
    },
    { headers },
  );
}
