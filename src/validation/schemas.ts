import { z } from "zod";

export const createRestaurantSchema = z.object({
  name: z.string().min(1),
  openingTime: z.string().regex(/^\d{2}:\d{2}$/),
  closingTime: z.string().regex(/^\d{2}:\d{2}$/),
  totalTables: z.number().int().positive().optional(),
});

export const addTableSchema = z.object({
  number: z.number().int().positive(),
  capacity: z.number().int().positive(),
});

export const availabilityQuerySchema = z.object({
  dateTime: z.string().min(1),
  durationMinutes: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  partySize: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
});

export const availableSlotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  partySize: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  stepMinutes: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive())
    .optional(),
});

export const createReservationSchema = z.object({
  restaurantId: z.number().int().positive(),
  customerName: z.string().min(1),
  phone: z.string().min(5),
  partySize: z.number().int().positive(),
  dateTime: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  tableId: z.number().int().positive().optional(),
});

export const updateReservationSchema = z.object({
  customerName: z.string().min(1).optional(),
  phone: z.string().min(5).optional(),
  partySize: z.number().int().positive().optional(),
  dateTime: z.string().min(1).optional(),
  durationMinutes: z.number().int().positive().optional(),
  tableId: z.number().int().positive().optional(),
  status: z.enum(["pending", "confirmed", "completed", "cancelled"]).optional(),
});

export const dailyReservationsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
