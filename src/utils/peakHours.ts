import { prisma } from "../prisma";
import { CacheService } from "./redis";

export interface PeakHourConfig {
  id: number;
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
  maxDurationMinutes: number;
  isActive: boolean;
}

/**
 * Peak Hours Service
 * Handles peak hour configuration and validation for reservations
 */
export class PeakHoursService {
  /**
   * Get peak hours configuration for a restaurant
   * Uses Redis caching for performance
   */
  static async getPeakHours(restaurantId: number): Promise<PeakHourConfig[]> {
    // Try cache first
    const cached =
      await CacheService.getCachedPeakHours<PeakHourConfig[]>(restaurantId);
    if (cached) return cached;

    // Fetch from database
    const peakHours = await prisma.peakHours.findMany({
      where: { restaurantId, isActive: true },
      orderBy: [{ dayOfWeek: "asc" }, { startMinutes: "asc" }],
    });

    // Cache the result
    await CacheService.cachePeakHours(restaurantId, peakHours);

    return peakHours;
  }

  /**
   * Check if a reservation time falls within peak hours
   * Returns the applicable peak hour config if found
   */
  static async checkPeakHour(
    restaurantId: number,
    reservationStart: Date,
    durationMinutes: number,
  ): Promise<{
    isPeakHour: boolean;
    peakHourConfig?: PeakHourConfig;
    exceedsMaxDuration: boolean;
    maxAllowedDuration?: number;
  }> {
    const peakHours = await PeakHoursService.getPeakHours(restaurantId);

    if (peakHours.length === 0) {
      return { isPeakHour: false, exceedsMaxDuration: false };
    }

    const dayOfWeek = reservationStart.getDay(); // 0=Sunday, 6=Saturday
    const timeMinutes =
      reservationStart.getHours() * 60 + reservationStart.getMinutes();

    // Find matching peak hour config
    const matchingPeakHour = peakHours.find(
      (ph) =>
        ph.dayOfWeek === dayOfWeek &&
        timeMinutes >= ph.startMinutes &&
        timeMinutes < ph.endMinutes,
    );

    if (!matchingPeakHour) {
      return { isPeakHour: false, exceedsMaxDuration: false };
    }

    return {
      isPeakHour: true,
      peakHourConfig: matchingPeakHour,
      exceedsMaxDuration: durationMinutes > matchingPeakHour.maxDurationMinutes,
      maxAllowedDuration: matchingPeakHour.maxDurationMinutes,
    };
  }

  /**
   * Validate reservation duration against peak hour restrictions
   * Throws an error if duration exceeds peak hour limit
   */
  static async validatePeakHourDuration(
    restaurantId: number,
    reservationStart: Date,
    durationMinutes: number,
  ): Promise<{ valid: boolean; message?: string; maxDuration?: number }> {
    const result = await PeakHoursService.checkPeakHour(
      restaurantId,
      reservationStart,
      durationMinutes,
    );

    if (result.isPeakHour && result.exceedsMaxDuration) {
      return {
        valid: false,
        message: `Peak hour restriction: Maximum reservation duration is ${result.maxAllowedDuration} minutes during this time`,
        maxDuration: result.maxAllowedDuration,
      };
    }

    return { valid: true };
  }

  /**
   * Create or update peak hours configuration for a restaurant
   */
  static async upsertPeakHours(
    restaurantId: number,
    config: {
      dayOfWeek: number;
      startMinutes: number;
      endMinutes: number;
      maxDurationMinutes: number;
    },
  ): Promise<PeakHourConfig> {
    const result = await prisma.peakHours.upsert({
      where: {
        restaurantId_dayOfWeek_startMinutes: {
          restaurantId,
          dayOfWeek: config.dayOfWeek,
          startMinutes: config.startMinutes,
        },
      },
      update: {
        endMinutes: config.endMinutes,
        maxDurationMinutes: config.maxDurationMinutes,
        isActive: true,
      },
      create: {
        restaurantId,
        dayOfWeek: config.dayOfWeek,
        startMinutes: config.startMinutes,
        endMinutes: config.endMinutes,
        maxDurationMinutes: config.maxDurationMinutes,
      },
    });

    // Invalidate cache
    await CacheService.invalidatePeakHours(restaurantId);

    return result;
  }

  /**
   * Delete peak hours configuration
   */
  static async deletePeakHours(
    restaurantId: number,
    peakHourId: number,
  ): Promise<void> {
    await prisma.peakHours.delete({
      where: { id: peakHourId, restaurantId },
    });

    // Invalidate cache
    await CacheService.invalidatePeakHours(restaurantId);
  }

  /**
   * Get formatted peak hours info for API response
   */
  static formatPeakHoursForResponse(peakHours: PeakHourConfig[]): Array<{
    id: number;
    dayOfWeek: number;
    dayName: string;
    startTime: string;
    endTime: string;
    maxDurationMinutes: number;
  }> {
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    return peakHours.map((ph) => ({
      id: ph.id,
      dayOfWeek: ph.dayOfWeek,
      dayName: dayNames[ph.dayOfWeek],
      startTime: minutesToHHMM(ph.startMinutes),
      endTime: minutesToHHMM(ph.endMinutes),
      maxDurationMinutes: ph.maxDurationMinutes,
    }));
  }
}

// Helper function to convert minutes to HH:MM format
function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
