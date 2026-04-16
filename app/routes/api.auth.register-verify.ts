import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getRpId, getRpOrigin, SESSION_MAX_AGE_SECONDS } from "~/lib/auth-config";
import { getChallenge, deleteChallenge } from "~/lib/database/auth/challenge";
import { savePasskey } from "~/lib/database/auth/passkey";
import { createSession } from "~/lib/database/auth/session";
import { setSessionCookie } from "~/lib/database/auth-middleware";

interface RegisterVerifyBody {
  challengeId: string;
  userId: string;
  response: RegistrationResponseJSON;
}

export async function action({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as RegisterVerifyBody;
  const { challengeId, userId, response } = body;

  if (!challengeId || !userId || !response) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Look up the challenge
  const challengeRow = await getChallenge(challengeId);
  if (!challengeRow) {
    return Response.json({ error: "Challenge not found or expired" }, { status: 400 });
  }

  // Clean up the challenge (single-use)
  await deleteChallenge(challengeId);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: getRpOrigin(),
      expectedRPID: getRpId(),
    });
  } catch (err) {
    return Response.json({ error: "Verification failed", detail: String(err) }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return Response.json({ error: "Registration not verified" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;

  // Persist the passkey
  await savePasskey({
    id: credential.id,
    userId,
    publicKey: Buffer.from(credential.publicKey),
    webauthnUserId: userId,
    counter: credential.counter,
    deviceType: verification.registrationInfo.credentialDeviceType ?? null,
    backedUp: verification.registrationInfo.credentialBackedUp ?? false,
    transports: credential.transports?.join(",") ?? null,
  });

  // Create a server session
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const session = await createSession(userId, expiresAt);
  if (!session) {
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }

  const headers = new Headers();
  setSessionCookie(headers, session.id);

  return Response.json({ verified: true, userId }, { headers });
}
