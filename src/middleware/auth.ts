import { Response, NextFunction } from "express";
import { prisma } from "../prisma";
import {
  AuthRequest,
  JWTService,
  UserRole,
  Permission,
  ROLE_PERMISSIONS,
  StaffRole,
} from "../utils/auth";

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "No token provided" },
        });
      return;
    }
    const token = authHeader.substring(7);
    const payload = JWTService.verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    res
      .status(401)
      .json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
      });
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const payload = JWTService.verifyAccessToken(token);
      req.user = payload;
    }
    next();
  } catch {
    next();
  }
};

export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res
        .status(401)
        .json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res
        .status(403)
        .json({
          success: false,
          error: { code: "FORBIDDEN", message: "Insufficient permissions" },
        });
      return;
    }
    next();
  };
};

export const requirePermission = (permission: Permission) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res
        .status(401)
        .json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
      return;
    }
    const rolePermissions = ROLE_PERMISSIONS[req.user.role];
    if (rolePermissions.includes(permission)) {
      next();
      return;
    }
    res
      .status(403)
      .json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions",
          required: permission,
        },
      });
  };
};

export const requireRestaurantAccess = (
  requiredPermissions: Permission[] = [],
  minStaffRole?: StaffRole,
) => {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!req.user) {
      res
        .status(401)
        .json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
      return;
    }
    const restaurantIdParam: any =
      req.params.restaurantId ?? req.params.id ?? req.body.restaurantId;
    const normalized = Array.isArray(restaurantIdParam)
      ? restaurantIdParam[0]
      : restaurantIdParam;
    const restaurantId: number | string | undefined =
      normalized !== undefined
        ? typeof normalized === "string"
          ? parseInt(normalized, 10) || normalized
          : normalized
        : undefined;
    if (!restaurantId) {
      res
        .status(400)
        .json({
          success: false,
          error: { code: "BAD_REQUEST", message: "Restaurant ID required" },
        });
      return;
    }

    if (req.user.role === UserRole.SUPER_ADMIN) {
      req.restaurantId = restaurantId;
      next();
      return;
    }

    const access = req.user.restaurantAccess?.find(
      (a) => a.restaurantId === restaurantId,
    );
    if (!access) {
      res
        .status(403)
        .json({
          success: false,
          error: { code: "FORBIDDEN", message: "No access to this restaurant" },
        });
      return;
    }

    if (minStaffRole) {
      const roleHierarchy = [
        StaffRole.SERVER,
        StaffRole.HOST,
        StaffRole.MANAGER,
        StaffRole.OWNER,
      ];
      const userRoleLevel = roleHierarchy.indexOf(access.staffRole);
      const requiredRoleLevel = roleHierarchy.indexOf(minStaffRole);
      if (userRoleLevel < requiredRoleLevel) {
        res
          .status(403)
          .json({
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "Insufficient restaurant role",
              required: minStaffRole,
              current: access.staffRole,
            },
          });
        return;
      }
    }

    if (requiredPermissions.length > 0) {
      const hasAll = requiredPermissions.every((perm) =>
        access.permissions.includes(perm),
      );
      if (!hasAll) {
        res
          .status(403)
          .json({
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "Missing required permissions",
              required: requiredPermissions,
              current: access.permissions,
            },
          });
        return;
      }
    }

    req.restaurantId = restaurantId;
    next();
  };
};

export const requireOwnership = (resourceType: "reservation" | "user") => {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!req.user) {
      res
        .status(401)
        .json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
      return;
    }
    const resourceIdRaw: any = req.params.id;

    if (req.user.role === UserRole.SUPER_ADMIN) {
      next();
      return;
    }

    try {
      if (resourceType === "reservation") {
        const normalizedId = Array.isArray(resourceIdRaw)
          ? resourceIdRaw[0]
          : resourceIdRaw;
        const id: number | undefined =
          typeof normalizedId === "string"
            ? parseInt(normalizedId, 10)
            : normalizedId;
        const reservation = await prisma.reservation.findUnique({
          where: { id },
        });
        if (!reservation) {
          res
            .status(404)
            .json({
              success: false,
              error: { code: "NOT_FOUND", message: "Reservation not found" },
            });
          return;
        }
        const isOwner = reservation.userId === req.user.userId;
        const hasAccess = req.user.restaurantAccess?.some(
          (a) => a.restaurantId === reservation.restaurantId,
        );
        if (!isOwner && !hasAccess) {
          res
            .status(403)
            .json({
              success: false,
              error: { code: "FORBIDDEN", message: "Access denied" },
            });
          return;
        }
      }

      if (resourceType === "user") {
        const idStr: string | undefined = Array.isArray(resourceIdRaw)
          ? resourceIdRaw[0]
          : resourceIdRaw;
        if (req.user.userId !== idStr) {
          res
            .status(403)
            .json({
              success: false,
              error: { code: "FORBIDDEN", message: "Access denied" },
            });
          return;
        }
      }

      next();
    } catch {
      res
        .status(500)
        .json({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Authorization check failed",
          },
        });
    }
  };
};
