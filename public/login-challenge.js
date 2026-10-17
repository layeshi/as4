import { mountAltcha } from './login-altcha.js';
import { mountLoginChallenge } from './turnstile.js';

export const loginChallengeProvider = (account) => account.loginCaptcha?.provider || (account.turnstileSiteKey ? 'turnstile' : 'none');

/** Login-only provider selection. Contact verification has its own Turnstile action. */
export function mountAccountLoginChallenge(container, account) {
  if (loginChallengeProvider(account) === 'altcha') {
    const challenge = mountAltcha(container);
    return { token: challenge.getResponse, reset: challenge.reset, dispose: challenge.remove };
  }
  return mountLoginChallenge(container, account.turnstileSiteKey);
}
