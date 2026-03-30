import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const ADMIN_JWT_SECRET = config.jwtSecret + '-admin';

export interface AdminTokenPayload {
  admin: true;
  iat: number;
  exp: number;
}

export function signAdminToken(): string {
  return jwt.sign({ admin: true }, ADMIN_JWT_SECRET, { expiresIn: '1h' });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  const payload = jwt.verify(token, ADMIN_JWT_SECRET) as AdminTokenPayload;
  if (!payload.admin) throw new Error('Not an admin token');
  return payload;
}
