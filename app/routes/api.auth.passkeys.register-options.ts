import { generateRegistrationOptions } from "@simplewebauthn/server";
import { CHALLENGE_TTL_SECONDS, getRpId, RP_NAME } from "~/lib/auth-config";
import { saveChallenge } from "~/lib/database/auth/challenge";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getPasskeysByUserId } from "~/lib/database/auth/passkey";

export async function action({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { userId } = await requireAuth(request);
  const existingPasskeys = await getPasskeysByUserId(userId);
  const excludeCredentials = existingPasskeys.map((passkey) => ({
    id: passkey.id,
    transports: passkey.transports
      ? (passkey.transports.split(",") as AuthenticatorTransport[])
      : undefined,
  }));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpId(),
    userID: new TextEncoder().encode(userId),
    userName: userId,
    userDisplayName: "",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const challengeRow = await saveChallenge({
    userId,
    challenge: options.challenge,
    type: "registration",
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
  });

  if (!challengeRow) {
    return Response.json({ error: "Failed to create challenge" }, { status: 500 });
  }

  return Response.json({ options, challengeId: challengeRow.id });
}
