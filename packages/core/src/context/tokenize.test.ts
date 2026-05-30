import { describe, expect, it } from 'vitest';
import { tokenizeCode, tokenizeCodeToString } from './tokenize.js';

describe('tokenizeCode', () => {
  it('splits camelCase into separate lowercase tokens', () => {
    expect(tokenizeCode('getUserById')).toEqual(['get', 'user', 'by', 'id']);
  });

  it('splits snake_case', () => {
    expect(tokenizeCode('fetch_user_orders')).toEqual(['fetch', 'user', 'orders']);
  });

  it('splits PascalCase and handles acronyms', () => {
    expect(tokenizeCode('HTTPServerConfig')).toEqual(['http', 'server', 'config']);
  });

  it('drops parts shorter than 2 chars', () => {
    // `a` and the trailing `x`-less single chars are dropped; `id` survives.
    expect(tokenizeCode('a_id_b')).toEqual(['id']);
  });

  it('drops low-entropy junk (len/distinct >= 4)', () => {
    expect(tokenizeCode('aaaaaaaa')).toEqual([]);
    // a normal word with enough distinct chars survives
    expect(tokenizeCode('handler')).toEqual(['handler']);
  });

  it('tokenizes a realistic identifier-heavy line', () => {
    const tokens = tokenizeCode('class AuthController extends BaseController');
    expect(tokens).toContain('auth');
    expect(tokens).toContain('controller');
    expect(tokens).toContain('base');
    expect(tokens).toContain('class');
    expect(tokens).toContain('extends');
  });

  it('joins to a space-separated string (SweepAI shape)', () => {
    expect(tokenizeCodeToString('getUserById')).toBe('get user by id');
  });
});
