import { AuthToken, UserClaims } from '../domain/token.js';

export interface TokenVerifierPort {
  verify(token: string): Promise<UserClaims>;
}

export class VerifyTokenUseCase {
  constructor(private readonly verifier: TokenVerifierPort) {}

  async execute(authHeader: string): Promise<UserClaims> {
    const token = new AuthToken(authHeader);
    return this.verifier.verify(token.getBearerPayload());
  }
}
