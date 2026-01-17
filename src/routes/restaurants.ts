import { Router } from "express";
import { prisma } from "../prisma";
import { HttpError } from "../middleware/error";
import { addMinutes, parseISO, startOfDay, format } from "date-fns";
import {
  hhmmToMinutes,
  overlaps,
  withinOperatingHours,
  compareTimeStrings,
  isTimeInRange,
  getLocalTimeString,
  getLocalDayOfWeek,
} from "../utils/time";
import {
  addTableSchema,
  availableSlotsQuerySchema,
  availabilityQuerySchema,
  createRestaurantSchema,
  dailyReservationsQuerySchema,
  createPeakHoursSchema,
  updatePeakHoursSchema,
} from "../validation/schemas";
import type {
  TableModel,
  ReservationModel,
} from "../../generated/prisma/models";
import { CacheService } from "../utils/redis";
import { PeakHoursService } from "../utils/peakHours";
import { SeatingService } from "../utils/seating";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const parsed = createRestaurantSchema.parse(req.body);

    // Validate opening time is before closing time
    if (compareTimeStrings(parsed.openingTime, parsed.closingTime) >= 0) {
      throw new HttpError(400, "Opening time must be before closing time");
    }

    const restaurant = await prisma.restaurant.create({
      data: {
        name: parsed.name,
        timezone: parsed.timezone,
        openingTime: parsed.openingTime,
        closingTime: parsed.closingTime,
        totalTables: parsed.totalTables,
      },
    });
    res.status(201).json(restaurant);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/tables", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.params.id, 10);
    if (Number.isNaN(restaurantId))
      throw new HttpError(400, "Invalid restaurant id");
    const parsed = addTableSchema.parse(req.body);
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) throw new HttpError(404, "Restaurant not found");

    const table = await prisma.table.create({
      data: {
        restaurantId,
        number: parsed.number,
        capacity: parsed.capacity,
      },
    });
    res.status(201).json(table);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.params.id, 10);
    if (Number.isNaN(restaurantId))
      throw new HttpError(400, "Invalid restaurant id");
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: { tables: true },
    });
    if (!restaurant) throw new HttpError(404, "Restaurant not found");
    res.json(restaurant);
  } catch (err) {
    next(err);
  }
});

// Check availability for a specific time slot
router.get("/:id/availability", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.params.id, 10);
    if (Number.isNaN(restaurantId))
      throw new HttpError(400, "Invalid restaurant id");
    const parsed = availabilityQuerySchema.parse(req.query);
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) throw new HttpError(404, "Restaurant not found");

    const start = parseISO(parsed.dateTime);
    if (
      !withinOperatingHours(
        start,
        parsed.durationMinutes,
        restaurant.openingTime,
        restaurant.closingTime,
        restaurant.timezone,
      )
    ) {
      throw new HttpError(400, "Requested time outside operating hours");
    }

    const dateStr = format(start, "yyyy-MM-dd");

    // Try cache first
    const cached = await CacheService.getCachedAvailability<{
      availableTables: TableModel[];
    }>(restaurantId, dateStr, parsed.partySize, parsed.durationMinutes);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    // Use SeatingService for optimized table selection
    const result = await SeatingService.getAvailableTablesWithScoring(
      restaurantId,
      parsed.partySize,
      start,
      parsed.durationMinutes,
    );

    // Check peak hour status
    const peakHourInfo = await PeakHoursService.checkPeakHour(
      restaurantId,
      start,
      parsed.durationMinutes,
    );

    const response = {
      availableTables: result.availableTables,
      recommendations: result.partySizeRecommendations,
      peakHour: peakHourInfo.isPeakHour
        ? {
            active: true,
            maxDuration: peakHourInfo.maxAllowedDuration,
            exceedsLimit: peakHourInfo.exceedsMaxDuration,
          }
        : undefined,
    };

    // Cache the result
    await CacheService.cacheAvailability(
      restaurantId,
      dateStr,
      parsed.partySize,
      parsed.durationMinutes,
      response,
    );

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// Get all reservations for a specific date
router.get("/:id/reservations", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.params.id, 10);
    if (Number.isNaN(restaurantId))
      throw new HttpError(400, "Invalid restaurant id");
    const parsed = dailyReservationsQuerySchema.parse(req.query);
    const date = parseISO(parsed.date);
    const startDay = startOfDay(date);

    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId,
        startTime: { gte: startDay, lt: addMinutes(startDay, 24 * 60) },
      },
      orderBy: { startTime: "asc" },
    });
    res.json(reservations);
  } catch (err) {
    next(err);
  }
});

// Calculate and display available time slots for a given party size
router.get("/:id/available-slots", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.params.id, 10);
    if (Number.isNaN(restaurantId))
      throw new HttpError(400, "Invalid restaurant id");
    const parsed = availableSlotsQuerySchema.parse(req.query);
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) throw new HttpError(404, "Restaurant not found");

    const step = parsed.stepMinutes ?? 30;
    const date = parseISO(parsed.date);
    const dayStart = startOfDay(date);
    const dateStr = format(date, "yyyy-MM-dd");

    // Try cache first
    const cached = await CacheService.getCachedSlots<{
      slots: { start: string; isPeakHour: boolean }[];
    }>(restaurantId, dateStr, parsed.partySize, parsed.durationMinutes);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const tables = await prisma.table.findMany({
      where: { restaurantId, capacity: { gte: parsed.partySize } },
    });
    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId,
        startTime: { gte: dayStart, lt: addMinutes(dayStart, 24 * 60) },
        status: { notIn: ["cancelled"] },
      },
    });

    // Get peak hours for this restaurant
    const peakHours = await PeakHoursService.getPeakHours(restaurantId);
    const dayOfWeek = date.getDay();

    // Convert opening/closing times to minutes for slot iteration
    const openingMinutes = hhmmToMinutes(restaurant.openingTime);
    const closingMinutes = hhmmToMinutes(restaurant.closingTime);

    const slots: {
      start: string;
      isPeakHour: boolean;
      maxDuration?: number;
    }[] = [];
    for (
      let m = openingMinutes;
      m + parsed.durationMinutes <= closingMinutes;
      m += step
    ) {
      const slotStart = addMinutes(dayStart, m);
      const hasAvailableTable = tables.some((t: TableModel) => {
        const trs = reservations.filter(
          (r: ReservationModel) => r.tableId === t.id,
        );
        return !trs.some((r: ReservationModel) =>
          overlaps(
            slotStart,
            parsed.durationMinutes,
            r.startTime,
            r.durationMinutes,
          ),
        );
      });

      if (hasAvailableTable) {
        // Check if this slot is during peak hours
        const currentTimeStr = getLocalTimeString(
          slotStart,
          restaurant.timezone,
        );
        const peakHour = peakHours.find(
          (ph) =>
            ph.dayOfWeek === dayOfWeek &&
            isTimeInRange(currentTimeStr, ph.startTime, ph.endTime),
        );

        slots.push({
          start: slotStart.toISOString(),
          isPeakHour: !!peakHour,
          maxDuration: peakHour?.maxDurationMinutes,
        });
      }
    }

    const response = { slots };

    // Cache the result
    await CacheService.cacheSlots(
      restaurantId,
      dateStr,
      parsed.partySize,
      parsed.durationMinutes,
      response,
    );

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// PEAK HOURS MANAGEMENT
// ============================================================================

// Get peak hours for a restaurant
router.get("/:id/peak-hours", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.params.id, 10);
    if (Number.isNaN(restaurantId))
      throw new HttpError(400, "Invalid restaurant id");

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) throw new HttpError(404, "Restaurant not found");

    const peakHours = await PeakHoursService.getPeakHours(restaurantId);
    const formatted = PeakHoursService.formatPeakHoursForResponse(peakHours);

    res.json({ success: true, data: formatted });
  } catch (err) {
    next(err);
  }
});

// Create/update peak hours configuration
router.post("/:id/peak-hours", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.params.id, 10);
    if (Number.isNaN(restaurantId))
      throw new HttpError(400, "Invalid restaurant id");

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) throw new HttpError(404, "Restaurant not found");

    const parsed = createPeakHoursSchema.parse(req.body);

    // Validate start time is before end time
    if (compareTimeStrings(parsed.startTime, parsed.endTime) >= 0) {
      throw new HttpError(400, "Start time must be before end time");
    }

    // Validate peak hours are within operating hours
    if (
      compareTimeStrings(parsed.startTime, restaurant.openingTime) < 0 ||
      compareTimeStrings(parsed.endTime, restaurant.closingTime) > 0
    ) {
      throw new HttpError(400, "Peak hours must be within operating hours");
    }

    const peakHour = await PeakHoursService.upsertPeakHours(restaurantId, {
      dayOfWeek: parsed.dayOfWeek,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      maxDurationMinutes: parsed.maxDurationMinutes,
    });

    res.status(201).json({ success: true, data: peakHour });
  } catch (err) {
    next(err);
  }
});

// Update peak hours
router.patch("/:id/peak-hours/:peakHourId", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.params.id, 10);
    const peakHourId = parseInt(req.params.peakHourId, 10);
    if (Number.isNaN(restaurantId) || Number.isNaN(peakHourId))
      throw new HttpError(400, "Invalid id");

    const updates = updatePeakHoursSchema.parse(req.body);

    const existing = await prisma.peakHours.findFirst({
      where: { id: peakHourId, restaurantId },
    });
    if (!existing)
      throw new HttpError(404, "Peak hour configuration not found");

    const updateData: Record<string, unknown> = {};

    if (updates.startTime) {
      updateData.startTime = updates.startTime;
    }
    if (updates.endTime) {
      updateData.endTime = updates.endTime;
    }
    if (updates.maxDurationMinutes !== undefined) {
      updateData.maxDurationMinutes = updates.maxDurationMinutes;
    }
    if (updates.isActive !== undefined) {
      updateData.isActive = updates.isActive;
    }

    const updated = await prisma.peakHours.update({
      where: { id: peakHourId },
      data: updateData,
    });

    // Invalidate cache
    await CacheService.invalidatePeakHours(restaurantId);

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Delete peak hours
router.delete("/:id/peak-hours/:peakHourId", async (req, res, next) => {
  try {
    const restaurantId = parseInt(req.params.id, 10);
    const peakHourId = parseInt(req.params.peakHourId, 10);
    if (Number.isNaN(restaurantId) || Number.isNaN(peakHourId))
      throw new HttpError(400, "Invalid id");

    await PeakHoursService.deletePeakHours(restaurantId, peakHourId);

    res.json({ success: true, message: "Peak hour configuration deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
