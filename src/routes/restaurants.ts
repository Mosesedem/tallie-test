import { Router } from "express";
import { prisma } from "../prisma";
import { HttpError } from "../middleware/error";
import { addMinutes, parseISO, startOfDay } from "date-fns";
import { hhmmToMinutes, overlaps, withinOperatingHours } from "../utils/time";
import {
  addTableSchema,
  availableSlotsQuerySchema,
  availabilityQuerySchema,
  createRestaurantSchema,
  dailyReservationsQuerySchema,
} from "../validation/schemas";
import type {
  TableModel,
  ReservationModel,
} from "../../generated/prisma/models";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const parsed = createRestaurantSchema.parse(req.body);
    const openingMinutes = hhmmToMinutes(parsed.openingTime);
    const closingMinutes = hhmmToMinutes(parsed.closingTime);
    if (openingMinutes >= closingMinutes) {
      throw new HttpError(400, "Opening time must be before closing time");
    }
    const restaurant = await prisma.restaurant.create({
      data: {
        name: parsed.name,
        openingTimeMinutes: openingMinutes,
        closingTimeMinutes: closingMinutes,
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
        restaurant.openingTimeMinutes,
        restaurant.closingTimeMinutes,
      )
    ) {
      throw new HttpError(400, "Requested time outside operating hours");
    }

    const allTables = await prisma.table.findMany({ where: { restaurantId } });
    const candidateTables = allTables.filter(
      (t: TableModel) => t.capacity >= parsed.partySize,
    );

    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId,
        startTime: {
          gte: addMinutes(startOfDay(start), 0),
          lt: addMinutes(startOfDay(start), 24 * 60),
        },
      },
    });

    const available = candidateTables.filter((table: TableModel) => {
      const tableReservations = reservations.filter(
        (r: ReservationModel) => r.tableId === table.id,
      );
      return !tableReservations.some((r: ReservationModel) =>
        overlaps(start, parsed.durationMinutes, r.startTime, r.durationMinutes),
      );
    });

    res.json({ availableTables: available });
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

    const tables = await prisma.table.findMany({
      where: { restaurantId, capacity: { gte: parsed.partySize } },
    });
    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId,
        startTime: { gte: dayStart, lt: addMinutes(dayStart, 24 * 60) },
      },
    });

    const slots: { start: string }[] = [];
    for (
      let m = restaurant.openingTimeMinutes;
      m + parsed.durationMinutes <= restaurant.closingTimeMinutes;
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
        slots.push({ start: slotStart.toISOString() });
      }
    }

    res.json({ slots });
  } catch (err) {
    next(err);
  }
});

export default router;
