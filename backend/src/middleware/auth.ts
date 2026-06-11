import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthUser {
  id: string;
  tenantId: string | null;
  username: string;
  fullName: string;
  groupName: string | null;
  roleType: "administrador" | "empleado" | null;
  isSuperAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, config.jwtSecret) as AuthUser;
}

/** Requiere JWT válido (header Authorization o ?token= para SSE). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : (req.query.token as string | undefined);

  if (!token) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Sesión inválida o expirada" });
  }
}

/** Módulos exclusivos del administrador (manual §1.2). */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.roleType === "administrador" || req.user?.isSuperAdmin) {
    next();
    return;
  }
  res.status(403).json({ error: "Acceso exclusivo del administrador" });
}

/** Multicomercio: solo Super Administrador. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.isSuperAdmin) {
    next();
    return;
  }
  res.status(403).json({ error: "Acceso exclusivo del Super Administrador" });
}
