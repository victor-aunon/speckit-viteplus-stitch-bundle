export interface UserClaims {
  sub: string;
  email: string;
  role: 'admin' | 'user';
  exp: number;
}

export class AuthToken {
  constructor(readonly rawToken: string) {
    if (!rawToken || rawToken.trim().length === 0) {
      throw new Error('AuthToken cannot be empty');
    }
  }

  isBearer(): boolean {
    return this.rawToken.startsWith('Bearer ');
  }

  getBearerPayload(): string {
    return this.isBearer() ? this.rawToken.slice(7) : this.rawToken;
  }
}
