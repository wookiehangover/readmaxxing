import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getRpId, getRpOrigin } from "~/lib/auth-config";
import { deleteChallenge, getChallenge } from "~/lib/database/auth/challenge";
import { requireAuth } from "~/lib/database/auth-middleware";
import { savePasskey } from "~/lib/database/auth/passkey";

interface PasskeyRegisterVerifyBody {
  challengeId: string;
  response: RegistrationResponseJSON;
  userId?: string;
}

export async function action({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const session = await requireAuth(request);
  const {
    challengeId,
    response,
    userId: clientUserId,
  } = (await request.json()) as PasskeyRegisterVerifyBody;

  if (clientUserId !== undefined && clientUserId !== session.userId) {
    return Response.json({ error: "User does not match session" }, { status: 403 });
  }

  if (!challengeId || !response) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const challengeRow = await getChallenge(challengeId);
  if (
    !challengeRow ||
    challengeRow.type !== "registration" ||
    challengeRow.userId !== session.userId
  ) {
    return Response.json({ error: "Challenge not found or expired" }, { status: 400 });
  }

  await deleteChallenge(challengeId);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: getRpOrigin(),
      expectedRPID: getRpId(),
    });
  } catch (error) {
    return Response.json({ error: "Verification failed", detail: String(error) }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return Response.json({ error: "Registration not verified" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  await savePasskey({
    id: credential.id,
    userId: session.userId,
    publicKey: Buffer.from(credential.publicKey),
    webauthnUserId: session.userId,
    counter: credential.counter,
    deviceType: verification.registrationInfo.credentialDeviceType ?? null,
    backedUp: verification.registrationInfo.credentialBackedUp ?? false,
    transports: credential.transports?.join(",") ?? null,
  });

  return Response.json({ verified: true });
}
