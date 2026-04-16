import { generateRegistrationOptions } from "@simplewebauthn/server";
import { RP_NAME, getRpId, CHALLENGE_TTL_SECONDS } from "~/lib/auth-config";
import { upsertUser } from "~/lib/database/user/user";
import { getPasskeysByUserId } from "~/lib/database/auth/passkey";
import { saveChallenge } from "~/lib/database/auth/challenge";

export async function loader() {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }

  // Create a new user for this registration ceremony
  const user = await upsertUser(crypto.randomUUID());
  if (!user) {
    return Response.json({ error: "Failed to create user" }, { status: 500 });
  }

  // Fetch any existing passkeys so we can exclude them
  const existingPasskeys = await getPasskeysByUserId(user.id);
  const excludeCredentials = existingPasskeys.map((pk) => ({
    id: pk.id,
    transports: pk.transports ? (pk.transports.split(",") as AuthenticatorTransport[]) : undefined,
  }));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpId(),
    userName: user.displayName ?? user.id,
    userDisplayName: user.displayName ?? "",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  // Persist challenge for verification step
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
  const challengeRow = await saveChallenge({
    userId: user.id,
    challenge: options.challenge,
    type: "registration",
    expiresAt,
  });

  return Response.json({ options, userId: user.id, challengeId: challengeRow?.id ?? null });
}
