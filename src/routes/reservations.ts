import { Router } from "express";
import { prisma } from "../prisma";
import { HttpError } from "../middleware/error";
import { addMinutes, parseISO, startOfDay, format } from "date-fns";
import { overlaps, withinOperatingHours } from "../utils/time";
import {
  createReservationSchema,
  updateReservationSchema,
} from "../validation/schemas";
import type {
  TableModel,
  ReservationModel,
} from "../../generated/prisma/models";
import { CacheService } from "../utils/redis";
import { PeakHoursService } from "../utils/peakHours";
import { SeatingService, TableSuggestion } from "../utils/seating";
import { EmailService } from "../utils/email";

const router = Router();

/**
 * Create a new reservation
 * POST /api/v1/reservations
 */
router.post("/", async (req, res, next) => {
  try {
    const parsed = createReservationSchema.parse(req.body);

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: parsed.restaurantId },
    });
    if (!restaurant) throw new HttpError(404, "Restaurant not found");

    const start = parseISO(parsed.dateTime);

    // Validate operating hours
    if (
      !withinOperatingHours(
        start,
        parsed.durationMinutes,
        restaurant.openingTimeMinutes,
        restaurant.closingTimeMinutes,
      )
    ) {
      throw new HttpError(400, "Reservation time outside operating hours");
    }

    // Validate peak hour duration restrictions
    const peakHourCheck = await PeakHoursService.validatePeakHourDuration(
      parsed.restaurantId,
      start,
      parsed.durationMinutes,
    );
    if (!peakHourCheck.valid) {
      throw new HttpError(400, peakHourCheck.message!, {
        isPeakHour: true,
        maxDuration: peakHourCheck.maxDuration,
      });
    }

    // Use seating optimization to find best table
    let tableId = parsed.tableId;
    let selectedTable: TableSuggestion | undefined;
    let alternativeTables: TableSuggestion[] = [];

    if (!tableId) {
      const seatingResult = await SeatingService.findOptimalTable(
        parsed.restaurantId,
        parsed.partySize,
        start,
        parsed.durationMinutes,
      );

      if (seatingResult.noTablesAvailable) {
        // No tables available - suggest waitlist
        throw new HttpError(
          409,
          "No available table for the requested time slot",
          {
            suggestions: seatingResult.suggestions,
            addToWaitlist: true,
            waitlistUrl: `/api/v1/waitlist`,
          },
        );
      }

      tableId = seatingResult.bestTable!.tableId;
      selectedTable = seatingResult.bestTable;
      alternativeTables = seatingResult.alternatives;
    } else {
      // Validate manually specified table
      const table = await prisma.table.findUnique({
        where: { id: parsed.tableId },
      });
      if (!table || table.restaurantId !== parsed.restaurantId) {
        throw new HttpError(400, "Invalid table for this restaurant");
      }
      if (table.capacity < parsed.partySize) {
        // Suggest alternative tables
        const seatingResult = await SeatingService.findOptimalTable(
          parsed.restaurantId,
          parsed.partySize,
          start,
          parsed.durationMinutes,
        );

        throw new HttpError(400, "Table capacity too small for party size", {
          requestedCapacity: table.capacity,
          partySize: parsed.partySize,
          alternatives: seatingResult.noTablesAvailable
            ? []
            : [seatingResult.bestTable, ...seatingResult.alternatives],
        });
      }

      // Check for overlapping reservations
      const dayStart = startOfDay(start);
      const dayEnd = addMinutes(dayStart, 24 * 60);

      const tableReservations = await prisma.reservation.findMany({
        where: {
          tableId: parsed.tableId,
          startTime: { gte: dayStart, lt: dayEnd },
          status: { notIn: ["cancelled"] },
        },
      });

      const hasOverlap = tableReservations.some((r: ReservationModel) =>
        overlaps(start, parsed.durationMinutes, r.startTime, r.durationMinutes),
      );

      if (hasOverlap) {
        // Find alternative times
        const alternatives = await SeatingService.suggestAlternativeTimes(
          parsed.restaurantId,
          parsed.partySize,
          start,
          parsed.durationMinutes,
        );

        throw new HttpError(
          409,
          "Table is already reserved for overlapping time",
          {
            alternativeTimes: alternatives.map((a) => ({
              startTime: a.startTime.toISOString(),
              table: a.table,
            })),
          },
        );
      }
    }

    // Create reservation
    const created = await prisma.reservation.create({
      data: {
        restaurantId: parsed.restaurantId,
        tableId: tableId!,
        userId: parsed.userId,
        customerName: parsed.customerName,
        phone: parsed.phone,
        partySize: parsed.partySize,
        startTime: start,
        durationMinutes: parsed.durationMinutes,
        status: "pending",
      },
    });

    // Invalidate availability cache for this date
    const dateStr = format(start, "yyyy-MM-dd");
    await CacheService.invalidateRestaurantDate(parsed.restaurantId, dateStr);

    // Send confirmation email
    const emailTo =
      parsed.email ||
      (created.userId ? await getUserEmail(created.userId) : null);
    if (emailTo) {
      try {
        const tableNumber = await getTableNumber(tableId!);
        await EmailService.sendReservationConfirmationEmail(emailTo, {
          restaurantName: restaurant.name,
          customerName: created.customerName,
          startISO: created.startTime.toISOString(),
          partySize: created.partySize,
          tableNumber,
          durationMinutes: created.durationMinutes,
        });
      } catch (err) {
        console.warn(
          "[EMAIL] Failed to send reservation confirmation:",
          (err as Error).message,
        );
      }
    }

    res.status(201).json({
      success: true,
      data: {
        reservation: created,
        table: selectedTable,
        alternatives:
          alternativeTables.length > 0 ? alternativeTables : undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get table suggestions for a reservation
 * GET /api/v1/reservations/suggestions?restaurantId=1&dateTime=...&partySize=4&durationMinutes=90
 */
router.get("/suggestions", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.query.restaurantId as string, 10);
    const partySize = parseInt(req.query.partySize as string, 10);
    const durationMinutes = parseInt(req.query.durationMinutes as string, 10);
    const dateTime = req.query.dateTime as string;

    if (
      Number.isNaN(restaurantId) ||
      Number.isNaN(partySize) ||
      Number.isNaN(durationMinutes) ||
      !dateTime
    ) {
      throw new HttpError(
        400,
        "restaurantId, partySize, durationMinutes, and dateTime are required",
      );
    }

    const start = parseISO(dateTime);

    const result = await SeatingService.getAvailableTablesWithScoring(
      restaurantId,
      partySize,
      start,
      durationMinutes,
    );

    // Get alternative times if no tables available
    let alternativeTimes: Array<{
      startTime: string;
      table: TableSuggestion;
    }> = [];
    if (result.availableTables.length === 0) {
      const alternatives = await SeatingService.suggestAlternativeTimes(
        restaurantId,
        partySize,
        start,
        durationMinutes,
      );
      alternativeTimes = alternatives.map((a) => ({
        startTime: a.startTime.toISOString(),
        table: a.table,
      }));
    }

    res.json({
      success: true,
      data: {
        availableTables: result.availableTables,
        recommendations: result.partySizeRecommendations,
        alternativeTimes,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get a reservation by ID
 * GET /api/v1/reservations/:id
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid reservation id");

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        restaurant: true,
        table: true,
      },
    });

    if (!reservation) throw new HttpError(404, "Reservation not found");

    res.json({ success: true, data: reservation });
  } catch (err) {
    next(err);
  }
});

/**
 * Update reservation details or status
 * PATCH /api/v1/reservations/:id
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid reservation id");
    const updates = updateReservationSchema.parse(req.body);

    const existing = await prisma.reservation.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Reservation not found");
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: existing.restaurantId },
    });
    if (!restaurant) throw new HttpError(404, "Restaurant not found");

    // Compute new derived fields
    const newStart = updates.dateTime
      ? parseISO(updates.dateTime)
      : existing.startTime;
    const newDuration = updates.durationMinutes ?? existing.durationMinutes;
    const newPartySize = updates.partySize ?? existing.partySize;
    let newTableId = updates.tableId ?? existing.tableId;

    // Status transitions validation
    if (updates.status) {
      const from = existing.status;
      const to = updates.status;
      const allowed: Record<string, string[]> = {
        pending: ["confirmed", "cancelled"],
        confirmed: ["completed", "cancelled"],
        completed: [],
        cancelled: [],
      };
      if (!allowed[from].includes(to)) {
        throw new HttpError(
          400,
          `Invalid status transition from ${from} to ${to}`,
        );
      }
    }

    // Operating hours check
    if (
      !withinOperatingHours(
        newStart,
        newDuration,
        restaurant.openingTimeMinutes,
        restaurant.closingTimeMinutes,
      )
    ) {
      throw new HttpError(400, "Reservation time outside operating hours");
    }

    // Peak hour check for modified reservations
    const peakHourCheck = await PeakHoursService.validatePeakHourDuration(
      existing.restaurantId,
      newStart,
      newDuration,
    );
    if (!peakHourCheck.valid) {
      throw new HttpError(400, peakHourCheck.message!, {
        isPeakHour: true,
        maxDuration: peakHourCheck.maxDuration,
      });
    }

    // Capacity and overlap checks
    const table = await prisma.table.findUnique({ where: { id: newTableId } });
    if (!table || table.restaurantId !== existing.restaurantId) {
      throw new HttpError(400, "Invalid table for this restaurant");
    }
    if (table.capacity < newPartySize) {
      // Suggest alternatives
      const seatingResult = await SeatingService.findOptimalTable(
        existing.restaurantId,
        newPartySize,
        newStart,
        newDuration,
      );

      throw new HttpError(400, "Table capacity too small for party size", {
        alternatives: seatingResult.noTablesAvailable
          ? []
          : [seatingResult.bestTable, ...seatingResult.alternatives],
      });
    }

    // Check overlaps against other reservations on same table (exclude itself)
    const dayStart = startOfDay(newStart);
    const others = await prisma.reservation.findMany({
      where: {
        restaurantId: existing.restaurantId,
        tableId: newTableId,
        id: { not: existing.id },
        startTime: { gte: dayStart, lt: addMinutes(dayStart, 24 * 60) },
        status: { notIn: ["cancelled"] },
      },
    });
    const conflict = others.some((r: ReservationModel) =>
      overlaps(newStart, newDuration, r.startTime, r.durationMinutes),
    );
    if (conflict) {
      const alternatives = await SeatingService.suggestAlternativeTimes(
        existing.restaurantId,
        newPartySize,
        newStart,
        newDuration,
      );

      throw new HttpError(
        409,
        "Table is already reserved for overlapping time",
        {
          alternativeTimes: alternatives.map((a) => ({
            startTime: a.startTime.toISOString(),
            table: a.table,
          })),
        },
      );
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: {
        customerName: updates.customerName ?? existing.customerName,
        phone: updates.phone ?? existing.phone,
        partySize: newPartySize,
        startTime: newStart,
        durationMinutes: newDuration,
        tableId: newTableId,
        status: updates.status ?? existing.status,
      },
    });

    // Invalidate cache for both old and new dates
    const oldDateStr = format(existing.startTime, "yyyy-MM-dd");
    const newDateStr = format(newStart, "yyyy-MM-dd");
    await CacheService.invalidateRestaurantDate(
      existing.restaurantId,
      oldDateStr,
    );
    if (oldDateStr !== newDateStr) {
      await CacheService.invalidateRestaurantDate(
        existing.restaurantId,
        newDateStr,
      );
    }

    // Send modification email if user has email
    if (existing.userId) {
      const email = await getUserEmail(existing.userId);
      if (email) {
        try {
          await EmailService.sendReservationModificationEmail(email, {
            restaurantName: restaurant.name,
            customerName: updated.customerName,
            originalStartISO: existing.startTime.toISOString(),
            newStartISO: updated.startTime.toISOString(),
            partySize: updated.partySize,
            durationMinutes: updated.durationMinutes,
          });
        } catch (err) {
          console.warn(
            "[EMAIL] Failed to send modification email:",
            (err as Error).message,
          );
        }
      }
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Cancel reservation (set status to cancelled)
 * POST /api/v1/reservations/:id/cancel
 */
router.post("/:id/cancel", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid reservation id");

    const existing = await prisma.reservation.findUnique({
      where: { id },
      include: { restaurant: true },
    });
    if (!existing) throw new HttpError(404, "Reservation not found");
    if (existing.status === "completed")
      throw new HttpError(400, "Cannot cancel a completed reservation");
    if (existing.status === "cancelled")
      throw new HttpError(400, "Reservation already cancelled");

    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "cancelled" },
    });

    // Invalidate cache to allow waitlist conversions
    const dateStr = format(existing.startTime, "yyyy-MM-dd");
    await CacheService.invalidateRestaurantDate(existing.restaurantId, dateStr);

    // Send cancellation email
    if (existing.userId) {
      const email = await getUserEmail(existing.userId);
      if (email) {
        try {
          await EmailService.sendReservationCancellationEmail(email, {
            restaurantName: existing.restaurant.name,
            customerName: existing.customerName,
            startISO: existing.startTime.toISOString(),
            partySize: existing.partySize,
          });
        } catch (err) {
          console.warn(
            "[EMAIL] Failed to send cancellation email:",
            (err as Error).message,
          );
        }
      }
    }

    // Check waitlist for this date and notify waiting customers
    // This is done asynchronously to not block the response
    checkWaitlistAfterCancellation(
      existing.restaurantId,
      existing.startTime,
    ).catch((err) => {
      console.warn("[WAITLIST] Check failed:", (err as Error).message);
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Confirm a pending reservation
 * POST /api/v1/reservations/:id/confirm
 */
router.post("/:id/confirm", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid reservation id");

    const existing = await prisma.reservation.findUnique({
      where: { id },
      include: { restaurant: true, table: true },
    });
    if (!existing) throw new HttpError(404, "Reservation not found");

    if (existing.status !== "pending") {
      throw new HttpError(
        400,
        `Cannot confirm a reservation that is ${existing.status}`,
      );
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "confirmed" },
    });

    // Send confirmation email
    if (existing.userId) {
      const email = await getUserEmail(existing.userId);
      if (email) {
        try {
          await EmailService.sendReservationConfirmationEmail(email, {
            restaurantName: existing.restaurant.name,
            customerName: existing.customerName,
            startISO: existing.startTime.toISOString(),
            partySize: existing.partySize,
            tableNumber: existing.table.number,
            durationMinutes: existing.durationMinutes,
          });
        } catch (err) {
          console.warn(
            "[EMAIL] Failed to send confirmation email:",
            (err as Error).message,
          );
        }
      }
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Complete a reservation (guest has left)
 * POST /api/v1/reservations/:id/complete
 */
router.post("/:id/complete", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid reservation id");

    const existing = await prisma.reservation.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Reservation not found");

    if (existing.status !== "confirmed") {
      throw new HttpError(
        400,
        `Cannot complete a reservation that is ${existing.status}`,
      );
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "completed" },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function getUserEmail(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.email ?? null;
}

async function getTableNumber(tableId: number): Promise<number | undefined> {
  const table = await prisma.table.findUnique({ where: { id: tableId } });
  return table?.number;
}

async function checkWaitlistAfterCancellation(
  restaurantId: number,
  startTime: Date,
): Promise<void> {
  const dateStart = startOfDay(startTime);
  const dateEnd = addMinutes(dateStart, 24 * 60);

  // Find waiting entries for this date
  const waitingEntries = await prisma.waitlistEntry.findMany({
    where: {
      restaurantId,
      preferredDate: { gte: dateStart, lt: dateEnd },
      status: "waiting",
    },
    orderBy: { createdAt: "asc" },
    take: 5, // Only check first 5 entries
    include: { restaurant: true },
  });

  for (const entry of waitingEntries) {
    const baseStart = addMinutes(
      startOfDay(entry.preferredDate),
      entry.preferredTime,
    );

    const result = await SeatingService.findOptimalTable(
      entry.restaurantId,
      entry.partySize,
      baseStart,
      entry.durationMinutes,
    );

    if (!result.noTablesAvailable && result.bestTable) {
      // Table available! Update status and notify
      await prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { status: "notified", notifiedAt: new Date() },
      });

      if (entry.email) {
        await EmailService.sendWaitlistNotificationEmail(entry.email, {
          restaurantName: entry.restaurant.name,
          customerName: entry.customerName,
          tableAvailable: true,
          tableNumber: result.bestTable.tableNumber,
          expiresIn: "30 minutes",
        });
      }

      break; // Only notify one person at a time
    }
  }
}

export default router;
