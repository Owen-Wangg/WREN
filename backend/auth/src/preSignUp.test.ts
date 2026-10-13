import type { PreSignUpTriggerEvent } from 'aws-lambda';

import { SIGNUP_EMAIL_DOMAIN_DENIED } from '@wren/types/signupEmailDomains';

import { evaluatePreSignUp } from './preSignUp';

function signupEvent(
  email: string,
  triggerSource: PreSignUpTriggerEvent['triggerSource'] = 'PreSignUp_SignUp',
): PreSignUpTriggerEvent {
  return {
    version: '1',
    region: 'ca-central-1',
    userPoolId: 'ca-central-1_example',
    userName: email,
    callerContext: { awsSdkVersion: '1', clientId: 'client' },
    triggerSource,
    request: {
      userAttributes: { email },
      validationData: {},
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
  };
}

describe('evaluatePreSignUp', () => {
  it('fails closed: denies every signup when the allowlist is empty or unset', () => {
    const event = signupEvent('ada@example.com');
    expect(() => evaluatePreSignUp(event, '')).toThrow(SIGNUP_EMAIL_DOMAIN_DENIED);
    expect(() => evaluatePreSignUp(event, undefined)).toThrow(SIGNUP_EMAIL_DOMAIN_DENIED);
  });

  it('rejects a wildcard entry instead of matching subdomains', () => {
    expect(() => evaluatePreSignUp(signupEvent('user@law.ubc.ca'), '*.ubc.ca')).toThrow(
      'ALLOWED_EMAIL_DOMAINS',
    );
  });

  it('allows an exact hostname match', () => {
    const event = signupEvent('user@ubc.ca');
    expect(evaluatePreSignUp(event, 'ubc.ca')).toBe(event);
  });

  it('rejects a subdomain that is not listed', () => {
    const event = signupEvent('user@law.ubc.ca');
    expect(() => evaluatePreSignUp(event, 'ubc.ca')).toThrow(SIGNUP_EMAIL_DOMAIN_DENIED);
  });

  it('falls back to userName when the email attribute is absent', () => {
    const event = signupEvent('user@ubc.ca');
    delete event.request.userAttributes.email;
    expect(evaluatePreSignUp(event, 'ubc.ca')).toBe(event);
  });

  it('enforces the allowlist for AdminCreateUser as well as self-signup', () => {
    const event = signupEvent('user@example.com', 'PreSignUp_AdminCreateUser');
    expect(() => evaluatePreSignUp(event, 'ubc.ca')).toThrow(SIGNUP_EMAIL_DOMAIN_DENIED);
  });
});
