// ============================================================================
// 1. TYPES & ENUMS
// ============================================================================

import { Request, Response, NextFunction } from "express";
import jwt, { Secret, SignOptions } from "jsonwebtoken";
import bcrypt from "bcrypt";
import { prisma } from "../prisma";

export enum UserRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  OWNER = "OWNER",
  MANAGER = "MANAGER",
  STAFF = "STAFF",
  CUSTOMER = "CUSTOMER",
}

export enum StaffRole {
  OWNER = "OWNER",
  MANAGER = "MANAGER",
  HOST = "HOST",
  SERVER = "SERVER",
}

export enum Permission {
  CREATE_RESTAURANT = "CREATE_RESTAURANT",
  UPDATE_RESTAURANT = "UPDATE_RESTAURANT",
  DELETE_RESTAURANT = "DELETE_RESTAURANT",
  VIEW_RESTAURANT = "VIEW_RESTAURANT",
  CREATE_TABLE = "CREATE_TABLE",
  UPDATE_TABLE = "UPDATE_TABLE",
  DELETE_TABLE = "DELETE_TABLE",
  VIEW_TABLE = "VIEW_TABLE",
  CREATE_RESERVATION = "CREATE_RESERVATION",
  VIEW_OWN_RESERVATION = "VIEW_OWN_RESERVATION",
  VIEW_ALL_RESERVATIONS = "VIEW_ALL_RESERVATIONS",
  UPDATE_RESERVATION = "UPDATE_RESERVATION",
  CANCEL_RESERVATION = "CANCEL_RESERVATION",
  CONFIRM_RESERVATION = "CONFIRM_RESERVATION",
  MANAGE_STAFF = "MANAGE_STAFF",
  VIEW_STAFF = "VIEW_STAFF",
  MANAGE_USERS = "MANAGE_USERS",
  VIEW_USERS = "VIEW_USERS",
  MANAGE_WAITLIST = "MANAGE_WAITLIST",
  VIEW_WAITLIST = "VIEW_WAITLIST",
}

export interface RestaurantAccess {
  restaurantId: number | string; // prisma Restaurant.id is Int, but we accept string in JWT for flexibility
  staffRole: StaffRole;
  permissions: Permission[];
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  restaurantAccess?: RestaurantAccess[];
  iat: number;
  exp: number;
}

export interface AuthRequest extends Request {
  user?: JWTPayload;
  restaurantId?: number | string;
}

// ============================================================================
// 2. PERMISSION MATRIX
// ============================================================================

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permission),
  [UserRole.OWNER]: [
    Permission.CREATE_RESTAURANT,
    Permission.UPDATE_RESTAURANT,
    Permission.DELETE_RESTAURANT,
    Permission.VIEW_RESTAURANT,
    Permission.CREATE_TABLE,
    Permission.UPDATE_TABLE,
    Permission.DELETE_TABLE,
    Permission.VIEW_TABLE,
    Permission.CREATE_RESERVATION,
    Permission.VIEW_OWN_RESERVATION,
    Permission.VIEW_ALL_RESERVATIONS,
    Permission.UPDATE_RESERVATION,
    Permission.CANCEL_RESERVATION,
    Permission.CONFIRM_RESERVATION,
    Permission.MANAGE_STAFF,
    Permission.VIEW_STAFF,
    Permission.MANAGE_WAITLIST,
    Permission.VIEW_WAITLIST,
  ],
  [UserRole.MANAGER]: [
    Permission.VIEW_RESTAURANT,
    Permission.UPDATE_RESTAURANT,
    Permission.CREATE_TABLE,
    Permission.UPDATE_TABLE,
    Permission.DELETE_TABLE,
    Permission.VIEW_TABLE,
    Permission.CREATE_RESERVATION,
    Permission.VIEW_OWN_RESERVATION,
    Permission.VIEW_ALL_RESERVATIONS,
    Permission.UPDATE_RESERVATION,
    Permission.CANCEL_RESERVATION,
    Permission.CONFIRM_RESERVATION,
    Permission.VIEW_STAFF,
    Permission.MANAGE_WAITLIST,
    Permission.VIEW_WAITLIST,
  ],
  [UserRole.STAFF]: [
    Permission.VIEW_RESTAURANT,
    Permission.VIEW_TABLE,
    Permission.CREATE_RESERVATION,
    Permission.VIEW_OWN_RESERVATION,
    Permission.VIEW_ALL_RESERVATIONS,
    Permission.UPDATE_RESERVATION,
    Permission.CONFIRM_RESERVATION,
    Permission.VIEW_WAITLIST,
  ],
  [UserRole.CUSTOMER]: [
    Permission.VIEW_RESTAURANT,
    Permission.VIEW_TABLE,
    Permission.CREATE_RESERVATION,
    Permission.VIEW_OWN_RESERVATION,
    Permission.CANCEL_RESERVATION,
  ],
};

export const STAFF_PERMISSIONS: Record<StaffRole, Permission[]> = {
  [StaffRole.OWNER]: ROLE_PERMISSIONS[UserRole.OWNER],
  [StaffRole.MANAGER]: [
    Permission.UPDATE_RESTAURANT,
    Permission.CREATE_TABLE,
    Permission.UPDATE_TABLE,
    Permission.DELETE_TABLE,
    Permission.VIEW_ALL_RESERVATIONS,
    Permission.CONFIRM_RESERVATION,
    Permission.MANAGE_WAITLIST,
  ],
  [StaffRole.HOST]: [
    Permission.VIEW_ALL_RESERVATIONS,
    Permission.UPDATE_RESERVATION,
    Permission.CONFIRM_RESERVATION,
    Permission.MANAGE_WAITLIST,
    Permission.VIEW_WAITLIST,
  ],
  [StaffRole.SERVER]: [
    Permission.VIEW_ALL_RESERVATIONS,
    Permission.VIEW_WAITLIST,
  ],
};

// ============================================================================
// 3. JWT UTILITIES
// ============================================================================

export class JWTService {
  private static ACCESS_TOKEN_SECRET = process.env.JWT_SECRET!;
  private static REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET!;
  private static ACCESS_TOKEN_EXPIRY =
    process.env.JWT_ACCESS_EXPIRATION || "15m";
  private static REFRESH_TOKEN_EXPIRY =
    process.env.JWT_REFRESH_EXPIRATION || "7d";

  static async generateAccessToken(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        restaurants: { include: { restaurant: true } },
      },
    });

    if (!user) throw new Error("User not found");

    const restaurantAccess: RestaurantAccess[] = user.restaurants.map((rs) => ({
      restaurantId: rs.restaurantId,
      staffRole: rs.role as StaffRole,
      permissions: STAFF_PERMISSIONS[rs.role as StaffRole],
    }));

    const payload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      restaurantAccess,
      iat: Math.floor(Date.now() / 1000),
      exp:
        Math.floor(Date.now() / 1000) +
        JWTService.parseExpiry(JWTService.ACCESS_TOKEN_EXPIRY),
    };

    return jwt.sign(payload, JWTService.ACCESS_TOKEN_SECRET);
  }

  static async generateRefreshToken(userId: string): Promise<string> {
    const token = jwt.sign(
      { userId, type: "refresh" },
      JWTService.REFRESH_TOKEN_SECRET as Secret,
      { expiresIn: JWTService.REFRESH_TOKEN_EXPIRY } as SignOptions,
    );

    await prisma.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt: new Date(
          Date.now() +
            JWTService.parseExpiry(JWTService.REFRESH_TOKEN_EXPIRY) * 1000,
        ),
      },
    });

    return token;
  }

  static verifyAccessToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, JWTService.ACCESS_TOKEN_SECRET) as JWTPayload;
    } catch {
      throw new Error("Invalid or expired token");
    }
  }

  static async verifyRefreshToken(token: string): Promise<string> {
    try {
      const payload = jwt.verify(token, JWTService.REFRESH_TOKEN_SECRET) as any;
      const stored = await prisma.refreshToken.findUnique({ where: { token } });
      if (!stored || stored.expiresAt < new Date())
        throw new Error("Invalid refresh token");
      return payload.userId as string;
    } catch {
      throw new Error("Invalid or expired refresh token");
    }
  }

  static async revokeRefreshToken(token: string): Promise<void> {
    await prisma.refreshToken.delete({ where: { token } }).catch(() => {});
  }

  static async revokeAllUserTokens(userId: string): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }

  private static parseExpiry(expiry: string): number {
    const unit = expiry.slice(-1);
    const value = parseInt(expiry.slice(0, -1));
    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 60 * 60;
      case "d":
        return value * 24 * 60 * 60;
      default:
        return 900;
    }
  }
}

// ============================================================================
// 4. PASSWORD UTILITIES
// ============================================================================

export class PasswordService {
  private static SALT_ROUNDS = 12;

  static async hash(password: string): Promise<string> {
    return bcrypt.hash(password, PasswordService.SALT_ROUNDS);
  }

  static async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  static validate(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (password.length < 8)
      errors.push("Password must be at least 8 characters");
    if (!/[A-Z]/.test(password))
      errors.push("Password must contain at least one uppercase letter");
    if (!/[a-z]/.test(password))
      errors.push("Password must contain at least one lowercase letter");
    if (!/[0-9]/.test(password))
      errors.push("Password must contain at least one number");
    if (!/[^A-Za-z0-9]/.test(password))
      errors.push("Password must contain at least one special character");
    return { valid: errors.length === 0, errors };
  }
}

// ============================================================================
// 5. PERMISSION HELPER FUNCTIONS
// ============================================================================

export class PermissionService {
  static hasPermission(user: JWTPayload, permission: Permission): boolean {
    return ROLE_PERMISSIONS[user.role].includes(permission);
  }

  static hasRestaurantPermission(
    user: JWTPayload,
    restaurantId: number | string,
    permission: Permission,
  ): boolean {
    if (user.role === UserRole.SUPER_ADMIN) return true;
    if (PermissionService.hasPermission(user, permission)) return true;
    const access = user.restaurantAccess?.find(
      (a) => a.restaurantId === restaurantId,
    );
    return access ? access.permissions.includes(permission) : false;
  }

  static getRestaurantRole(
    user: JWTPayload,
    restaurantId: number | string,
  ): StaffRole | null {
    const access = user.restaurantAccess?.find(
      (a) => a.restaurantId === restaurantId,
    );
    return access?.staffRole || null;
  }

  static getUserRestaurants(user: JWTPayload): (number | string)[] {
    return user.restaurantAccess?.map((a) => a.restaurantId) || [];
  }
}

// ============================================================================
// AUTH SERVICE & CONTROLLER
// ============================================================================

export interface RegisterDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  static async register(data: RegisterDTO): Promise<AuthResponse> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) throw new Error("Invalid email format");

    const pv = PasswordService.validate(data.password);
    if (!pv.valid)
      throw new Error(`Password validation failed: ${pv.errors.join(", ")}`);

    const existing = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });
    if (existing) throw new Error("Email already registered");

    const hashed = await PasswordService.hash(data.password);

    const user = await prisma.user.create({
      data: {
        id: undefined,
        email: data.email.toLowerCase(),
        password: hashed,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        role: "CUSTOMER",
        isActive: true,
      },
    });

    const accessToken = await JWTService.generateAccessToken(user.id);
    const refreshToken = await JWTService.generateRefreshToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      accessToken,
      refreshToken,
    };
  }

  static async login(data: LoginDTO): Promise<AuthResponse> {
    const user = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });
    if (!user) throw new Error("Invalid credentials");
    if (!user.isActive) throw new Error("Account is disabled");

    const ok = await PasswordService.compare(data.password, user.password);
    if (!ok) throw new Error("Invalid credentials");

    const accessToken = await JWTService.generateAccessToken(user.id);
    const refreshToken = await JWTService.generateRefreshToken(user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: { updatedAt: new Date() },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      accessToken,
      refreshToken,
    };
  }

  static async refreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string }> {
    const userId = await JWTService.verifyRefreshToken(refreshToken);
    const accessToken = await JWTService.generateAccessToken(userId);
    return { accessToken };
  }

  static async logout(refreshToken: string): Promise<void> {
    await JWTService.revokeRefreshToken(refreshToken);
  }

  static async logoutAll(userId: string): Promise<void> {
    await JWTService.revokeAllUserTokens(userId);
  }

  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    const ok = await PasswordService.compare(currentPassword, user.password);
    if (!ok) throw new Error("Current password is incorrect");

    const pv = PasswordService.validate(newPassword);
    if (!pv.valid)
      throw new Error(`Password validation failed: ${pv.errors.join(", ")}`);

    const hashed = await PasswordService.hash(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });
    await JWTService.revokeAllUserTokens(userId);
  }

  static async requestPasswordReset(
    email: string,
  ): Promise<{ resetToken: string }> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user)
      throw new Error("If this email exists, a reset link has been sent");
    const resetToken = await JWTService.generateAccessToken(user.id);
    const resetLink = `http://example.com/reset?token=${resetToken}`;
    try {
      const { EmailService } = await import("./email");
      await EmailService.sendPasswordResetEmail(user.email, resetLink);
    } catch (err) {
      // Soft-fail if email service isn't configured
      console.warn(
        "[EMAIL] Failed to send password reset email:",
        (err as Error).message,
      );
    }
    return { resetToken };
  }

  static async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<void> {
    const payload = JWTService.verifyAccessToken(token);
    const pv = PasswordService.validate(newPassword);
    if (!pv.valid)
      throw new Error(`Password validation failed: ${pv.errors.join(", ")}`);
    const hashed = await PasswordService.hash(newPassword);
    await prisma.user.update({
      where: { id: payload.userId },
      data: { password: hashed },
    });
    await JWTService.revokeAllUserTokens(payload.userId);
  }

  static async promoteToOwner(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { role: "OWNER" },
    });
    await JWTService.revokeAllUserTokens(userId);
  }
}

export class AuthController {
  static async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, firstName, lastName, phone } = req.body;
      if (!email || !password || !firstName || !lastName) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Missing required fields",
            details: {
              required: ["email", "password", "firstName", "lastName"],
            },
          },
        });
        return;
      }
      const result = await AuthService.register({
        email,
        password,
        firstName,
        lastName,
        phone,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: { code: "REGISTRATION_FAILED", message: error.message },
      });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Email and password are required",
          },
        });
        return;
      }
      const result = await AuthService.login({ email, password });
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      res.status(401).json({
        success: false,
        error: { code: "LOGIN_FAILED", message: error.message },
      });
    }
  }

  static async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Refresh token is required",
          },
        });
        return;
      }
      const result = await AuthService.refreshToken(refreshToken);
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      res.status(401).json({
        success: false,
        error: { code: "TOKEN_REFRESH_FAILED", message: error.message },
      });
    }
  }

  static async logout(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Refresh token is required",
          },
        });
        return;
      }
      await AuthService.logout(refreshToken);
      res
        .status(200)
        .json({ success: true, message: "Logged out successfully" });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: { code: "LOGOUT_FAILED", message: error.message },
      });
    }
  }

  static async logoutAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
        return;
      }
      await AuthService.logoutAll(req.user.userId);
      res
        .status(200)
        .json({ success: true, message: "Logged out from all devices" });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: { code: "LOGOUT_FAILED", message: error.message },
      });
    }
  }

  static async changePassword(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
        return;
      }
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Current password and new password are required",
          },
        });
        return;
      }
      await AuthService.changePassword(
        req.user.userId,
        currentPassword,
        newPassword,
      );
      res.status(200).json({
        success: true,
        message: "Password changed successfully. Please login again.",
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: { code: "PASSWORD_CHANGE_FAILED", message: error.message },
      });
    }
  }

  static async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Email is required" },
        });
        return;
      }
      await AuthService.requestPasswordReset(email);
      res.status(200).json({
        success: true,
        message: "If this email exists, a reset link has been sent",
      });
    } catch {
      res.status(200).json({
        success: true,
        message: "If this email exists, a reset link has been sent",
      });
    }
  }

  static async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Token and new password are required",
          },
        });
        return;
      }
      await AuthService.resetPassword(token, newPassword);
      res.status(200).json({
        success: true,
        message:
          "Password reset successfully. Please login with your new password.",
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: { code: "PASSWORD_RESET_FAILED", message: error.message },
      });
    }
  }

  static async getProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          createdAt: true,
          restaurants: {
            include: {
              restaurant: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!user) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "User not found" },
        });
        return;
      }
      res.status(200).json({
        success: true,
        data: { user, restaurantAccess: req.user.restaurantAccess },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: error.message },
      });
    }
  }
}
