import type { Request, Response, NextFunction } from "express";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";

/**
 * Paths that skip API key authentication.
 * /health is public; /webhooks/telegram has its own secret verification.
 */
const SKIP_AUTH_PREFIXES = ["/health", "/webhooks/telegram"];

function shouldSkipAuth(path: string): boolean {
  return SKIP_AUTH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * API key authentication middleware.
 * Expects: Authorization: Bearer <APP_SECRET>
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (shouldSkipAuth(req.path)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    logger.warn("Auth: missing Authorization header", {
      path: req.path,
      ip: req.ip,
    });
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    logger.warn("Auth: malformed Authorization header", {
      path: req.path,
      ip: req.ip,
    });
    res.status(401).json({ error: "Invalid Authorization format. Expected: Bearer <token>" });
    return;
  }

  const token = parts[1]!;
  if (!config.app.secret || token !== config.app.secret) {
    logger.warn("Auth: invalid API key", {
      path: req.path,
      ip: req.ip,
    });
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  next();
}
