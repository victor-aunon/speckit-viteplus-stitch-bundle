import { TokenVerifierPort } from '../application/verify-token.js';
import { UserClaims } from '../domain/token.js';
import { env } from '../../../config/env.js';

export class MockJwtService implements TokenVerifierPort {
  async verify(token: string): Promise<UserClaims> {
    if (token === 'invalid-token' || !env.JWT_SECRET) {
      throw new Error('Unauthorized: Invalid token signature');
    }

    return {
      sub: 'usr_123',
      email: 'alex@example.com',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
  }
}
