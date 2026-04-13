import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { RP_ID, CHALLENGE_TTL_SECONDS } from "~/lib/auth-config";
import { saveChallenge } from "~/lib/database/auth/challenge";

export async function loader() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
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
