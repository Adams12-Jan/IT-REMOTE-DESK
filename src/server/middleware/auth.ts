import type { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/queries.ts';

export type UserRole = 'admin' | 'technician' | 'employee';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  department: string;
  roleSlug: UserRole;
  isActive: boolean;
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
}

export async function verifyBearerToken(token: string): Promise<AuthenticatedUser> {
  const decoded = await adminAuth.verifyIdToken(token);
  const email = decoded.email;
  if (!email) {
    throw new Error('Token missing verified email address.');
  }
  const displayName =
    decoded.name || email.split('@')[0].replace(/[._]/g, ' ');
  const user = await getOrCreateUser(decoded.uid, email, displayName);
  if (!user.isActive) {
    throw new Error('Account has been deactivated by an administrator.');
  }
  return {
    id: user.id,
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    department: user.department,
    roleSlug: user.roleSlug as UserRole,
    isActive: user.isActive,
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
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes('deactivated')
        ? error.message
        : 'Invalid or expired authentication token.';
    return res.status(401).json({ error: message });
  }
};

export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.authUser.roleSlug)) {
      return res.status(403).json({
        error: 'You do not have permission to perform this action.',
      });
    }
    next();
  };
};
