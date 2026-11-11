import { describe, expect, it } from 'vitest';
import { parseSessionExport } from '../../src/core/session-import';

const APP = { domains: ['acme.test'], origin: 'https://app.acme.test' };
const NOW = 1_800_000_000;
const parse = (text: string) => parseSessionExport(text, APP, NOW);

describe('importing an exported sign-in', () => {
  it('reads cookie extensions (Cookie-Editor, EditThisCookie)', () => {
    const result = parse(
      JSON.stringify([
        {
          domain: '.acme.test',
          hostOnly: false,
          name: 'sid',
          value: 'abc',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
          session: false,
          expirationDate: NOW + 100,
        },
        { domain: 'app.acme.test', hostOnly: true, name: 'theme', value: 'dark', path: '/', session: true },
        { domain: '.other.test', name: 'x', value: '1', path: '/' },
        { domain: 'acme.test', name: 'old', value: '1', path: '/', expirationDate: NOW - 1 },
        { nonsense: true },
      ]),
    );
    expect(result?.format).toBe('json');
    expect(result?.skipped).toBe(3);
    expect(result?.cookies).toEqual([
      {
        name: 'sid',
        value: 'abc',
        domain: '.acme.test',
        path: '/',
        secure: true,
        httpOnly: true,
        hostOnly: false,
        session: false,
        sameSite: 'lax',
        expirationDate: NOW + 100,
      },
      {
        name: 'theme',
        value: 'dark',
        domain: 'app.acme.test',
        path: '/',
        secure: false,
        httpOnly: false,
        hostOnly: true,
        session: true,
        sameSite: 'unspecified',
      },
    ]);
  });

  it("reads Playwright's storageState with the origin's localStorage", () => {
    const result = parse(
      JSON.stringify({
        cookies: [{ name: 'sid', value: 'abc', domain: 'app.acme.test', path: '/', expires: -1, sameSite: 'None' }],
        origins: [
          { origin: 'https://app.acme.test', localStorage: [{ name: 'sb-auth-token', value: '{"a":1}' }] },
          { origin: 'https://elsewhere.test', localStorage: [{ name: 'x', value: '1' }] },
        ],
      }),
    );
    expect(result?.format).toBe('storage-state');
    expect(result?.cookies).toHaveLength(1);
    expect(result?.cookies[0]).toMatchObject({ session: true, sameSite: 'no_restriction', hostOnly: true });
    expect({ ...result?.localStorage }).toEqual({ 'sb-auth-token': '{"a":1}' });
  });

  it('reads Netscape cookies.txt, with HttpOnly lines', () => {
    const result = parse(
      [
        '# Netscape HTTP Cookie File',
        `.acme.test\tTRUE\t/\tTRUE\t${NOW + 50}\tsid\tabc`,
        `#HttpOnly_app.acme.test\tFALSE\t/admin\tFALSE\t0\tadm\tx\ty`,
        'broken line',
        `.other.test\tTRUE\t/\tFALSE\t0\tz\t1`,
      ].join('\n'),
    );
    expect(result?.format).toBe('netscape');
    expect(result?.skipped).toBe(2);
    expect(result?.cookies).toEqual([
      expect.objectContaining({ name: 'sid', domain: '.acme.test', secure: true, hostOnly: false }),
      expect.objectContaining({ name: 'adm', value: 'x\ty', domain: 'app.acme.test', httpOnly: true, path: '/admin' }),
    ]);
  });

  it('reads a bare Cookie header as cookies of the main address', () => {
    const result = parse('Cookie: sid=abc; theme=dark');
    expect(result?.format).toBe('header');
    expect(result?.cookies.map((cookie) => [cookie.name, cookie.domain, cookie.hostOnly])).toEqual([
      ['sid', 'app.acme.test', true],
      ['theme', 'app.acme.test', true],
    ]);
  });

  it('refuses what it does not know', () => {
    expect(parse('')).toBeNull();
    expect(parse('hello world')).toBeNull();
    expect(parse('{"not":"cookies"}')).toBeNull();
    expect(parse('[not json')).toBeNull();
  });

  it('keeps one cookie per name, domain and path (the last wins)', () => {
    const result = parse(
      JSON.stringify([
        { domain: 'acme.test', name: 'a', value: '1', path: '/' },
        { domain: 'acme.test', name: 'a', value: '2', path: '/' },
      ]),
    );
    expect(result?.cookies.map((cookie) => cookie.value)).toEqual(['2']);
  });
});
