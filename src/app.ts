import express from "express";
import dotenv from "dotenv";
import { errorHandler } from "./middleware/error";
import restaurantsRouter from "./routes/restaurants";
import reservationsRouter from "./routes/reservations";
import authRouter from "./routes/auth";
import waitlistRouter from "./routes/waitlist";

dotenv.config();

const app = express();
app.use(express.json());

// Health check endpoint for Docker
app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/restaurants", restaurantsRouter);
app.use("/api/v1/reservations", reservationsRouter);
app.use("/api/v1/waitlist", waitlistRouter);

app.use(errorHandler);

export default app;
