import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { config } from '../config.js';
import type { FastifyReply } from 'fastify';

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  jti: string; // Session token
  roleId?: string;
  roleIds?: string[];
  pwc?: string; // password_changed_at snapshot for invalidation
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

export function setAuthCookie(reply: FastifyReply, token: string) {
  reply.setCookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

export function setCsrfCookie(reply: FastifyReply): string {
  const token = randomBytes(32).toString('hex');
  reply.setCookie('csrf', token, {
    httpOnly: false, // client JS must be able to read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  return token;
}

export function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie('token', { path: '/' });
  reply.clearCookie('csrf', { path: '/' });
}
