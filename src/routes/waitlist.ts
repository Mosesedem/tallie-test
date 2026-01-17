import { Router } from "express";
import { prisma } from "../prisma";
import { HttpError } from "../middleware/error";
import { parseISO, startOfDay, addMinutes, addDays, format } from "date-fns";
import {
  isTimeInRange,
  compareTimeStrings,
  hhmmToMinutes,
  withinOperatingHours,
  localToUtc,
} from "../utils/time";
import {
  addToWaitlistSchema,
  updateWaitlistSchema,
  waitlistQuerySchema,
} from "../validation/schemas";
import { EmailService } from "../utils/email";
import { SeatingService } from "../utils/seating";
import { PeakHoursService } from "../utils/peakHours";

const router = Router();

/**
 * Add to waitlist when no tables are available
 * POST /api/v1/waitlist
 */
router.post("/", async (req, res, next) => {
  try {
    const parsed = addToWaitlistSchema.parse(req.body);

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: parsed.restaurantId },
    });
    if (!restaurant) throw new HttpError(404, "Restaurant not found");

    // Validate preferred time is within operating hours (using HH:MM string comparison)
    if (
      compareTimeStrings(parsed.preferredTime, restaurant.openingTime) < 0 ||
      compareTimeStrings(parsed.preferredTime, restaurant.closingTime) >= 0
    ) {
      throw new HttpError(400, "Preferred time outside operating hours");
    }

    // Calculate expiration (default 24 hours after preferred date)
    const preferredDate = parseISO(parsed.preferredDate);
    const expiresAt = addDays(preferredDate, 1);

    const entry = await prisma.waitlistEntry.create({
      data: {
        restaurantId: parsed.restaurantId,
        userId: parsed.userId,
        customerName: parsed.customerName,
        email: parsed.email,
        phone: parsed.phone,
        partySize: parsed.partySize,
        preferredDate,
        preferredTime: parsed.preferredTime, // Now stored as HH:MM string
        flexibilityMins: parsed.flexibilityMins ?? 60,
        durationMinutes: parsed.durationMinutes,
        expiresAt,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: entry.id,
        position: await getWaitlistPosition(entry.id, parsed.restaurantId),
        message:
          "Added to waitlist. You will be notified when a table becomes available.",
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get waitlist for a restaurant on a specific date
 * GET /api/v1/waitlist?restaurantId=1&date=2024-01-15
 */
router.get("/", async (req, res, next) => {
  try {
    const parsed = waitlistQuerySchema.parse(req.query);

    const dateStart = parseISO(parsed.date);
    const dateEnd = addDays(dateStart, 1);

    const entries = await prisma.waitlistEntry.findMany({
      where: {
        restaurantId: parsed.restaurantId,
        preferredDate: { gte: dateStart, lt: dateEnd },
        status: { in: ["waiting", "notified"] },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      success: true,
      data: entries.map((e, index) => ({
        ...e,
        position: index + 1,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get a specific waitlist entry
 * GET /api/v1/waitlist/:id
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid waitlist entry id");

    const entry = await prisma.waitlistEntry.findUnique({
      where: { id },
      include: { restaurant: true },
    });
    if (!entry) throw new HttpError(404, "Waitlist entry not found");

    const position = await getWaitlistPosition(id, entry.restaurantId);

    res.json({
      success: true,
      data: { ...entry, position },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Update waitlist entry
 * PATCH /api/v1/waitlist/:id
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid waitlist entry id");

    const updates = updateWaitlistSchema.parse(req.body);

    const existing = await prisma.waitlistEntry.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Waitlist entry not found");

    if (existing.status === "converted" || existing.status === "expired") {
      throw new HttpError(400, "Cannot update completed or expired entries");
    }

    const updateData: Record<string, unknown> = {};

    if (updates.customerName) updateData.customerName = updates.customerName;
    if (updates.phone) updateData.phone = updates.phone;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.partySize) updateData.partySize = updates.partySize;
    if (updates.flexibilityMins !== undefined)
      updateData.flexibilityMins = updates.flexibilityMins;
    if (updates.durationMinutes)
      updateData.durationMinutes = updates.durationMinutes;

    if (updates.preferredTime) {
      updateData.preferredTime = updates.preferredTime; // Now stored as HH:MM string
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Cancel waitlist entry
 * POST /api/v1/waitlist/:id/cancel
 */
router.post("/:id/cancel", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid waitlist entry id");

    const existing = await prisma.waitlistEntry.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Waitlist entry not found");

    if (existing.status === "converted" || existing.status === "cancelled") {
      throw new HttpError(
        400,
        `Cannot cancel an entry that is already ${existing.status}`,
      );
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id },
      data: { status: "cancelled" },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Convert waitlist entry to reservation
 * POST /api/v1/waitlist/:id/convert
 */
router.post("/:id/convert", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid waitlist entry id");

    const { tableId, startTime } = req.body as {
      tableId?: number;
      startTime?: string;
    };

    const entry = await prisma.waitlistEntry.findUnique({
      where: { id },
      include: { restaurant: true },
    });
    if (!entry) throw new HttpError(404, "Waitlist entry not found");

    if (entry.status !== "waiting" && entry.status !== "notified") {
      throw new HttpError(400, "Waitlist entry cannot be converted");
    }

    // Determine start time
    let reservationStart: Date;
    if (startTime) {
      reservationStart = parseISO(startTime);
    } else {
      // Use preferred date and time - convert local time to UTC
      const dateStr = format(entry.preferredDate, "yyyy-MM-dd");
      reservationStart = localToUtc(
        dateStr,
        entry.preferredTime,
        entry.restaurant.timezone,
      );
    }

    // Validate operating hours
    if (
      !withinOperatingHours(
        reservationStart,
        entry.durationMinutes,
        entry.restaurant.openingTime,
        entry.restaurant.closingTime,
        entry.restaurant.timezone,
      )
    ) {
      throw new HttpError(400, "Reservation time outside operating hours");
    }

    // Enforce peak hour duration restrictions
    const peakHourCheck = await PeakHoursService.validatePeakHourDuration(
      entry.restaurantId,
      reservationStart,
      entry.durationMinutes,
    );
    if (!peakHourCheck.valid) {
      throw new HttpError(400, peakHourCheck.message!, {
        isPeakHour: true,
        maxDuration: peakHourCheck.maxDuration,
      });
    }

    // Find best table if not specified
    let finalTableId = tableId;
    if (!finalTableId) {
      const seatingResult = await SeatingService.findOptimalTable(
        entry.restaurantId,
        entry.partySize,
        reservationStart,
        entry.durationMinutes,
      );

      if (seatingResult.noTablesAvailable || !seatingResult.bestTable) {
        throw new HttpError(400, "No tables available for conversion");
      }

      finalTableId = seatingResult.bestTable.tableId;
    }

    // Create reservation
    const reservation = await prisma.reservation.create({
      data: {
        restaurantId: entry.restaurantId,
        tableId: finalTableId,
        userId: entry.userId,
        customerName: entry.customerName,
        phone: entry.phone,
        partySize: entry.partySize,
        startTime: reservationStart,
        durationMinutes: entry.durationMinutes,
        status: "confirmed",
      },
    });

    // Update waitlist entry status
    await prisma.waitlistEntry.update({
      where: { id },
      data: { status: "converted" },
    });

    // Send confirmation email
    if (entry.email) {
      try {
        await EmailService.sendReservationConfirmationEmail(entry.email, {
          restaurantName: entry.restaurant.name,
          customerName: entry.customerName,
          startISO: reservationStart.toISOString(),
          partySize: entry.partySize,
          durationMinutes: entry.durationMinutes,
        });
      } catch (emailErr) {
        console.warn(
          "[EMAIL] Failed to send confirmation:",
          (emailErr as Error).message,
        );
      }
    }

    res.status(201).json({
      success: true,
      data: {
        reservation,
        message: "Waitlist entry converted to reservation",
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Check and notify waitlist entries when tables become available
 * This can be called by a cron job or after cancellation
 * POST /api/v1/waitlist/check-availability
 */
router.post("/check-availability", async (req, res, next) => {
  try {
    const { restaurantId, date } = req.body as {
      restaurantId: number;
      date: string;
    };

    if (!restaurantId || !date) {
      throw new HttpError(400, "restaurantId and date are required");
    }

    const dateStart = parseISO(date);
    const dateEnd = addDays(dateStart, 1);

    // Get waiting entries for this restaurant and date
    const waitingEntries = await prisma.waitlistEntry.findMany({
      where: {
        restaurantId,
        preferredDate: { gte: dateStart, lt: dateEnd },
        status: "waiting",
      },
      orderBy: { createdAt: "asc" },
      include: { restaurant: true },
    });

    const notified: number[] = [];

    for (const entry of waitingEntries) {
      // Calculate preferred start time with flexibility - convert local time to UTC
      const dateStr = format(entry.preferredDate, "yyyy-MM-dd");
      const baseStart = localToUtc(
        dateStr,
        entry.preferredTime,
        entry.restaurant.timezone,
      );

      // Check if any table is available within flexibility window
      const result = await SeatingService.findOptimalTable(
        entry.restaurantId,
        entry.partySize,
        baseStart,
        entry.durationMinutes,
      );

      if (!result.noTablesAvailable && result.bestTable) {
        // Table available! Notify customer
        await prisma.waitlistEntry.update({
          where: { id: entry.id },
          data: { status: "notified", notifiedAt: new Date() },
        });

        // Send notification email
        if (entry.email) {
          try {
            await EmailService.sendWaitlistNotificationEmail(entry.email, {
              restaurantName: entry.restaurant.name,
              customerName: entry.customerName,
              tableAvailable: true,
              tableNumber: result.bestTable.tableNumber,
              expiresIn: "30 minutes", // Time to claim
            });
          } catch (emailErr) {
            console.warn(
              "[EMAIL] Waitlist notification failed:",
              (emailErr as Error).message,
            );
          }
        }

        notified.push(entry.id);
      }
    }

    res.json({
      success: true,
      data: {
        checked: waitingEntries.length,
        notified: notified.length,
        notifiedIds: notified,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get waitlist position for an entry
 */
async function getWaitlistPosition(
  entryId: number,
  restaurantId: number,
): Promise<number> {
  const entry = await prisma.waitlistEntry.findUnique({
    where: { id: entryId },
  });
  if (!entry) return -1;

  const earlierEntries = await prisma.waitlistEntry.count({
    where: {
      restaurantId,
      preferredDate: entry.preferredDate,
      status: { in: ["waiting", "notified"] },
      createdAt: { lt: entry.createdAt },
    },
  });

  return earlierEntries + 1;
}

export default router;
