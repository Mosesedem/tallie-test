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
  email: z.string().email().optional(),
  partySize: z.number().int().positive(),
  dateTime: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  tableId: z.number().int().positive().optional(),
  userId: z.string().uuid().optional(),
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

// ============================================================================
// WAITLIST SCHEMAS
// ============================================================================

export const addToWaitlistSchema = z.object({
  restaurantId: z.number().int().positive(),
  userId: z.string().uuid().optional(),
  customerName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(5),
  partySize: z.number().int().positive(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferredTime: z.string().regex(/^\d{2}:\d{2}$/),
  flexibilityMins: z.number().int().min(0).max(240).optional(), // 0-4 hours
  durationMinutes: z.number().int().positive(),
});

export const updateWaitlistSchema = z.object({
  customerName: z.string().min(1).optional(),
  phone: z.string().min(5).optional(),
  email: z.string().email().optional().nullable(),
  partySize: z.number().int().positive().optional(),
  preferredTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  flexibilityMins: z.number().int().min(0).max(240).optional(),
  durationMinutes: z.number().int().positive().optional(),
});

export const waitlistQuerySchema = z.object({
  restaurantId: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ============================================================================
// PEAK HOURS SCHEMAS
// ============================================================================

export const createPeakHoursSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0=Sunday, 6=Saturday
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  maxDurationMinutes: z.number().int().positive().max(480), // Max 8 hours
});

export const updatePeakHoursSchema = z.object({
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  maxDurationMinutes: z.number().int().positive().max(480).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================================
// SEATING OPTIMIZATION SCHEMAS
// ============================================================================

export const tableSuggestionQuerySchema = z.object({
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
