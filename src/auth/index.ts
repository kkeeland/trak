/**
 * Auth module — OAuth authentication for trak.
 */

export {
  handleOAuthCallback,
  resolveProvider,
  validateState,
  generateState,
  type OAuthUser,
  type CallbackResult,
} from './callback.js';
