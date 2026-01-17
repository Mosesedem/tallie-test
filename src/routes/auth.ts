import { Router } from "express";
import { AuthController } from "../utils/auth";
import { authenticate } from "../middleware/auth";

const authRouter = Router();

// Public routes
authRouter.post("/register", AuthController.register);
authRouter.post("/login", AuthController.login);
authRouter.post("/refresh", AuthController.refreshToken);
authRouter.post("/forgot-password", AuthController.forgotPassword);
authRouter.post("/reset-password", AuthController.resetPassword);

// Protected routes
authRouter.post("/logout", AuthController.logout);
authRouter.post("/logout-all", authenticate, AuthController.logoutAll);
authRouter.post(
  "/change-password",
  authenticate,
  AuthController.changePassword,
);
authRouter.get("/me", authenticate, AuthController.getProfile);

export default authRouter;
