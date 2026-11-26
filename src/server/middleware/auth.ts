import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../../lib/firebase-admin.ts';
import type { UserProfile } from '../../types/remoteDesk.ts';
import { getUserByUid } from '../db.ts';

export interface VerifiedTokenUser {
  uid: string;
  email: string;
  displayName: string;
}

export interface AuthRequest extends Request {
  authUser?: VerifiedTokenUser;
  userProfile?: UserProfile;
}

export async function verifyBearerToken(
  token: string
): Promise<VerifiedTokenUser> {
  const decoded = await adminAuth.verifyIdToken(token);
  const email = decoded.email;
  if (!email || decoded.email_verified !== true) {
    throw new Error('Token missing verified email address.');
  }
  const displayName =
    decoded.name || email.split('@')[0].replace(/[._]/g, ' ');
  return {
    uid: decoded.uid,
    email: email.trim().toLowerCase(),
    displayName,
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token missing.' });
  }

  try {
    req.authUser = await verifyBearerToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
};

export const requireProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const profile = getUserByUid(req.authUser.uid);
  if (!profile) {
    return res.status(403).json({ error: 'User profile is not synced yet.' });
  }
  if (!profile.isActive) {
    return res.status(403).json({ error: 'Account has been deactivated by an administrator.' });
  }
  req.userProfile = profile;
  next();
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.userProfile || req.userProfile.roleSlug !== 'admin') {
    return res.status(403).json({ error: 'Administrator privileges required.' });
  }
  next();
};

