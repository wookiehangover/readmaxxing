import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getRpId, CHALLENGE_TTL_SECONDS } from "~/lib/auth-config";
import { saveChallenge } from "~/lib/database/auth/challenge";

export async function loader() {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    // Empty allowCredentials enables discoverable credentials (passkeys)
    allowCredentials: [],
    userVerification: "preferred",
  });

  // Persist challenge for verification step
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
  const challengeRow = await saveChallenge({
    challenge: options.challenge,
    type: "authentication",
    expiresAt,
  });

  return Response.json({
    options,
    challengeId: challengeRow?.id ?? null,
  });
}
