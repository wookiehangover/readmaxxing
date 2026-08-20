import type {
  AuthPasskey,
  AuthPasskeyRegistrationResponse,
  AuthRegistrationResponse,
  AuthSignInResponse,
  AuthUser,
  MagicLinkResponse,
} from "~/lib/auth-service";
import type { TaggedError } from "~/lib/errors";

export interface AuthSessionState {
  user: AuthUser | null;
  loading: boolean;
  error: TaggedError | null;
}

export type AuthLogoutCompletedCallback = () => void;
export type AuthOperationFailedCallback = (cause: unknown) => void;
export type AuthRegistrationCompletedCallback = (result: AuthRegistrationResponse) => void;
export type AuthSignInCompletedCallback = (result: AuthSignInResponse) => void;
export type MagicLinkCompletedCallback = (result: MagicLinkResponse) => void;
export type PasskeysCompletedCallback = (passkeys: AuthPasskey[]) => void;
export type PasskeyRegistrationCompletedCallback = (
  result: AuthPasskeyRegistrationResponse,
) => void;
