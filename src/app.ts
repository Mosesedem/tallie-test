import express from "express";
import dotenv from "dotenv";
import { errorHandler } from "./middleware/error";
import restaurantsRouter from "./routes/restaurants";
import reservationsRouter from "./routes/reservations";
import authRouter from "./routes/auth";

dotenv.config();

const app = express();
app.use(express.json());

app.use("/api/v1/auth", authRouter);
app.use("/restaurants", restaurantsRouter);
app.use("/reservations", reservationsRouter);

app.use(errorHandler);

export default app;
