import { Router } from "express";
import { prisma } from "../prisma";
import { HttpError } from "../middleware/error";
import { addMinutes, parseISO, startOfDay } from "date-fns";
import { overlaps, withinOperatingHours } from "../utils/time";
import {
  createReservationSchema,
  updateReservationSchema,
} from "../validation/schemas";
import type {
  TableModel,
  ReservationModel,
} from "../../generated/prisma/models";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const parsed = createReservationSchema.parse(req.body);

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: parsed.restaurantId },
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
      throw new HttpError(400, "Reservation time outside operating hours");
    }

    // Candidate tables: capacity >= party size
    const tables = await prisma.table.findMany({
      where: {
        restaurantId: parsed.restaurantId,
        capacity: { gte: parsed.partySize },
      },
      orderBy: { capacity: "asc" },
    });
    if (tables.length === 0)
      throw new HttpError(400, "No table can accommodate this party size");

    // Get reservations on that day for faster filtering
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = addMinutes(dayStart, 24 * 60);

    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId: parsed.restaurantId,
        startTime: { gte: dayStart, lt: dayEnd },
      },
    });

    const tableId =
      parsed.tableId ??
      tables.find((t: TableModel) => {
        const trs = reservations.filter(
          (r: ReservationModel) => r.tableId === t.id,
        );
        return !trs.some((r: ReservationModel) =>
          overlaps(
            start,
            parsed.durationMinutes,
            r.startTime,
            r.durationMinutes,
          ),
        );
      })?.id;

    if (!tableId)
      throw new HttpError(
        400,
        "No available table for the requested time slot",
      );

    // If specific table requested, validate overlap and capacity
    if (parsed.tableId) {
      const table = await prisma.table.findUnique({
        where: { id: parsed.tableId },
      });
      if (!table || table.restaurantId !== parsed.restaurantId)
        throw new HttpError(400, "Invalid table for this restaurant");
      if (table.capacity < parsed.partySize)
        throw new HttpError(400, "Table capacity too small for party size");
      const tableReservations = reservations.filter(
        (r: ReservationModel) => r.tableId === parsed.tableId,
      );
      const hasOverlap = tableReservations.some((r: ReservationModel) =>
        overlaps(start, parsed.durationMinutes, r.startTime, r.durationMinutes),
      );
      if (hasOverlap)
        throw new HttpError(
          409,
          "Table is already reserved for overlapping time",
        );
    }

    const created = await prisma.reservation.create({
      data: {
        restaurantId: parsed.restaurantId,
        tableId,
        customerName: parsed.customerName,
        phone: parsed.phone,
        partySize: parsed.partySize,
        startTime: start,
        durationMinutes: parsed.durationMinutes,
      },
    });

    // Mock confirmation send (log)
    console.log(
      `[CONFIRMATION] Reservation ${created.id} for ${created.customerName} at ${created.startTime.toISOString()}`,
    );

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// Update reservation details or status
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

    // Capacity and overlap checks
    const table = await prisma.table.findUnique({ where: { id: newTableId } });
    if (!table || table.restaurantId !== existing.restaurantId) {
      throw new HttpError(400, "Invalid table for this restaurant");
    }
    if (table.capacity < newPartySize) {
      throw new HttpError(400, "Table capacity too small for party size");
    }

    // Check overlaps against other reservations on same table (exclude itself)
    const dayStart = startOfDay(newStart);
    const others = await prisma.reservation.findMany({
      where: {
        restaurantId: existing.restaurantId,
        tableId: newTableId,
        id: { not: existing.id },
        startTime: { gte: dayStart, lt: addMinutes(dayStart, 24 * 60) },
      },
    });
    const conflict = others.some((r: ReservationModel) =>
      overlaps(newStart, newDuration, r.startTime, r.durationMinutes),
    );
    if (conflict)
      throw new HttpError(
        409,
        "Table is already reserved for overlapping time",
      );

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
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Cancel reservation (set status to cancelled)
router.post("/:id/cancel", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) throw new HttpError(400, "Invalid reservation id");
    const existing = await prisma.reservation.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Reservation not found");
    if (existing.status === "completed")
      throw new HttpError(400, "Cannot cancel a completed reservation");
    if (existing.status === "cancelled")
      throw new HttpError(400, "Reservation already cancelled");

    const updated = await prisma.reservation.update({
      where: { id },
      data: { status: "cancelled" },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
