import { describe, expect, it } from 'vitest';
import {
  decodeJwt,
  detectIdentity,
  hasIdentity,
  identityFromValue,
  identityLabel,
  joinCookieChunks,
  parseStoredValue,
  sameIdentity,
  wildcardToRegExp,
} from '../../src/core/identity';
import { PRESETS } from '../../src/core/presets';
import type { CookieRecord } from '../../src/core/types';

const b64url = (text: string) => Buffer.from(text).toString('base64url');
const jwt = (payload: object) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;

function cookie(name: string, value: string, domain = 'example.com'): CookieRecord {
  return {
    name,
    value,
    domain,
    path: '/',
    secure: true,
    httpOnly: false,
    hostOnly: true,
    session: false,
    sameSite: 'lax',
  };
}

describe('wildcards and parsing', () => {
  it('turns * into a wildcard and escapes the rest', () => {
    expect(wildcardToRegExp('sb-*-auth-token').test('sb-abc123-auth-token')).toBe(true);
    expect(wildcardToRegExp('sb-*-auth-token').test('sb-abc-auth-token-user')).toBe(false);
    expect(wildcardToRegExp('a.b').test('axb')).toBe(false);
  });

  it('decodes JWT payloads, also with a Bearer prefix', () => {
    expect(decodeJwt(jwt({ sub: 'u1', email: 'a@b.co' }))).toEqual({ sub: 'u1', email: 'a@b.co' });
    expect(decodeJwt(`Bearer ${jwt({ sub: 'u1' })}`)).toEqual({ sub: 'u1' });
    expect(decodeJwt('not.a.jwt!')).toBeNull();
  });

  it('parses JSON, double-encoded JSON, URL-encoded JSON and Supabase base64 values', () => {
    expect(parseStoredValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseStoredValue(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
    expect(parseStoredValue(encodeURIComponent('{"a":1}'))).toEqual({ a: 1 });
    expect(parseStoredValue(`base64-${b64url('{"a":1}')}`)).toEqual({ a: 1 });
    expect(parseStoredValue('plain text')).toBeNull();
  });
});

describe('identityFromValue', () => {
  it('reads a Supabase session', () => {
    const session = {
      access_token: jwt({ sub: 'u1', email: 'a@b.co' }),
      user: { id: 'u1', email: 'a@b.co', user_metadata: { full_name: 'An Bình', avatar_url: 'https://x.co/a.png' } },
    };
    expect(identityFromValue(session)).toEqual({
      id: 'u1',
      email: 'a@b.co',
      name: 'An Bình',
      avatar: 'https://x.co/a.png',
    });
  });

  it('falls back to the access token when the user is stored separately', () => {
    const session = { access_token: jwt({ sub: 'u2', email: 'b@c.co' }), refresh_token: 'r' };
    expect(identityFromValue(session)).toMatchObject({ id: 'u2', email: 'b@c.co' });
  });

  it('reads the array form of older Supabase cookies', () => {
    expect(identityFromValue([jwt({ sub: 'u3', email: 'c@d.co' }), 'refresh'])).toMatchObject({ email: 'c@d.co' });
  });

  it('finds namespaced email claims and drops non-https avatars', () => {
    const identity = identityFromValue({ sub: 'x', 'https://example.com/email': 'n@s.co', picture: 'http://x/p.png' });
    expect(identity).toEqual({ id: 'x', email: 'n@s.co', name: undefined, avatar: undefined });
  });

  it('ignores values without any identity', () => {
    expect(identityFromValue({ theme: 'dark' })).toBeNull();
    expect(identityFromValue('text')).toBeNull();
  });
});

describe('detectIdentity', () => {
  const supabase = PRESETS.find((preset) => preset.id === 'supabase')!;

  it('recognises the Supabase dashboard user from its separate user entry', () => {
    const identity = detectIdentity(supabase.detector, {
      cookies: [],
      localStorage: {
        'supabase.dashboard.auth.token': JSON.stringify({ access_token: jwt({ sub: 'u1' }), refresh_token: 'r' }),
        'supabase.dashboard.auth.token-user': JSON.stringify({
          user: { id: 'u1', email: 'minh@company.example', user_metadata: { user_name: 'minh' } },
        }),
      },
    });
    expect(identity).toMatchObject({ id: 'u1', email: 'minh@company.example', name: 'minh', confidence: 'strong' });
  });

  it('reports nobody for a signed-out Supabase dashboard', () => {
    expect(detectIdentity(supabase.detector, { cookies: [], localStorage: { theme: 'dark' } })).toBeNull();
  });

  it("reads GitHub's user name cookie", () => {
    const github = PRESETS.find((preset) => preset.id === 'github')!;
    const identity = detectIdentity(github.detector, { cookies: [cookie('dotcom_user', 'octo-dev', 'github.com')] });
    expect(identity).toMatchObject({ id: 'octo-dev', name: 'octo-dev', confidence: 'strong' });
  });

  it('auto: finds supabase-js sessions in local storage', () => {
    const identity = detectIdentity(
      { kind: 'auto' },
      {
        cookies: [],
        localStorage: {
          'sb-abcdefgh-auth-token': JSON.stringify({
            access_token: jwt({ sub: 'u9' }),
            user: { id: 'u9', email: 'me@app.io' },
          }),
        },
      },
    );
    expect(identity).toMatchObject({ email: 'me@app.io', confidence: 'strong' });
    expect(identity?.source).toContain('sb-abcdefgh-auth-token');
  });

  it('auto: joins chunked @supabase/ssr cookies', () => {
    const session = `base64-${b64url(JSON.stringify({ access_token: 'x', user: { id: 'u5', email: 'ssr@app.io' } }))}`;
    const cookies = [
      cookie('sb-ref-auth-token.1', session.slice(20)),
      cookie('sb-ref-auth-token.0', session.slice(0, 20)),
    ];
    expect(detectIdentity({ kind: 'auto' }, { cookies })).toMatchObject({ email: 'ssr@app.io', confidence: 'strong' });
  });

  it('auto: finds Firebase users and JWT cookies', () => {
    expect(
      detectIdentity(
        { kind: 'auto' },
        {
          cookies: [],
          localStorage: { 'firebase:authUser:key:[DEFAULT]': JSON.stringify({ uid: 'f1', email: 'f@b.io' }) },
        },
      ),
    ).toMatchObject({ id: 'f1', email: 'f@b.io' });
    expect(
      detectIdentity({ kind: 'auto' }, { cookies: [cookie('id_token', jwt({ sub: 'j1', email: 'j@w.t' }))] }),
    ).toMatchObject({ email: 'j@w.t', confidence: 'strong' });
  });

  it('auto: only guesses weakly from user-ish records, and never from unrelated keys', () => {
    expect(
      detectIdentity(
        { kind: 'auto' },
        { cookies: [], localStorage: { currentUser: JSON.stringify({ email: 'w@x.io' }) } },
      ),
    ).toMatchObject({ email: 'w@x.io', confidence: 'weak' });
    expect(
      detectIdentity(
        { kind: 'auto' },
        { cookies: [], localStorage: { contacts: JSON.stringify({ email: 'w@x.io' }) } },
      ),
    ).toBeNull();
  });

  it('honours a custom cookie detector with JSON values', () => {
    const identity = detectIdentity(
      { kind: 'cookie', names: ['acct'], format: 'json' },
      { cookies: [cookie('acct', encodeURIComponent(JSON.stringify({ id: 7, email: 'j@son.io' })))] },
    );
    expect(identity).toMatchObject({ id: '7', email: 'j@son.io' });
  });

  it('returns nothing for "none"', () => {
    expect(detectIdentity({ kind: 'none' }, { cookies: [cookie('dotcom_user', 'x')] })).toBeNull();
  });
});

describe('matching identities', () => {
  it('prefers the user id, then the email (case-insensitive), then the name', () => {
    expect(sameIdentity({ identityId: 'u1', email: 'a@b.co' }, { id: 'u1', email: 'other@b.co' })).toBe(true);
    expect(sameIdentity({ identityId: 'u1' }, { id: 'u2' })).toBe(false);
    expect(sameIdentity({ email: 'A@B.co' }, { email: 'a@b.co' })).toBe(true);
    expect(sameIdentity({ name: 'minh' }, { name: 'Minh' })).toBe(true);
    expect(sameIdentity({ email: 'a@b.co', name: 'minh' }, { name: 'minh' })).toBe(false);
    expect(sameIdentity({ email: 'a@b.co' }, null)).toBe(false);
  });

  it('labels and checks identities', () => {
    expect(identityLabel({ email: 'a@b.co', name: 'A' })).toBe('a@b.co');
    expect(identityLabel({ name: 'A' })).toBe('A');
    expect(identityLabel(null)).toBe('');
    expect(hasIdentity({})).toBe(false);
    expect(hasIdentity({ email: 'a@b.co' })).toBe(true);
  });

  it('joins only cookies of the requested names', () => {
    const joined = joinCookieChunks(
      [cookie('x.0', 'ab'), cookie('x.1', 'cd'), cookie('y', 'zz')],
      (name) => name === 'x',
    );
    expect(Object.fromEntries(joined)).toEqual({ x: 'abcd' });
  });
});
