import { describe, it, expect } from 'vitest';
import { AuthToken } from './domain/token.js';
import { VerifyTokenUseCase } from './application/verify-token.js';
import { MockJwtService } from './infrastructure/jwt-service.js';

describe('Auth Feature (API Service)', () => {
  it('should extract bearer token and verify claims', async () => {
    const verifier = new MockJwtService();
    const useCase = new VerifyTokenUseCase(verifier);

    const claims = await useCase.execute('Bearer valid-token-xyz');
    expect(claims.sub).toBe('usr_123');
    expect(claims.email).toBe('alex@example.com');
    expect(claims.role).toBe('admin');
  });

  it('should reject malformed token inputs in domain', () => {
    expect(() => new AuthToken('')).toThrow('AuthToken cannot be empty');
  });

  it('should reject invalid token in infrastructure', async () => {
    const verifier = new MockJwtService();
    const useCase = new VerifyTokenUseCase(verifier);

    await expect(useCase.execute('Bearer invalid-token')).rejects.toThrow('Unauthorized');
  });
});
