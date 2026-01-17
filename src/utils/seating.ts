import { prisma } from "../prisma";
import type {
  TableModel,
  ReservationModel,
} from "../../generated/prisma/models";
import { overlaps } from "./time";
import { addMinutes, startOfDay } from "date-fns";

export interface TableSuggestion {
  tableId: number;
  tableNumber: number;
  capacity: number;
  score: number; // Lower score = better fit
  reason: string;
}

export interface SeatingResult {
  bestTable?: TableSuggestion;
  alternatives: TableSuggestion[];
  noTablesAvailable: boolean;
  suggestions: string[];
}

/**
 * Seating Optimization Service
 * Provides intelligent table selection and suggestions
 */
export class SeatingService {
  /**
   * Find the optimal table for a party
   * Scoring system:
   * - Exact capacity match: score 0
   * - Slightly larger (1-2 extra seats): score 1-2
   * - Much larger (3+ extra seats): score 3+
   * - Combines available tables for very large parties
   */
  static async findOptimalTable(
    restaurantId: number,
    partySize: number,
    startTime: Date,
    durationMinutes: number,
  ): Promise<SeatingResult> {
    // Get all tables sorted by capacity
    const allTables = await prisma.table.findMany({
      where: { restaurantId },
      orderBy: { capacity: "asc" },
    });

    if (allTables.length === 0) {
      return {
        noTablesAvailable: true,
        alternatives: [],
        suggestions: ["No tables configured for this restaurant"],
      };
    }

    // Get reservations for the day
    const dayStart = startOfDay(startTime);
    const dayEnd = addMinutes(dayStart, 24 * 60);

    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId,
        startTime: { gte: dayStart, lt: dayEnd },
        status: { notIn: ["cancelled"] },
      },
    });

    // Find tables that can accommodate the party
    const candidateTables = allTables.filter(
      (t: TableModel) => t.capacity >= partySize,
    );

    // Find available tables (no overlapping reservations)
    const availableTables = candidateTables.filter((table: TableModel) => {
      const tableReservations = reservations.filter(
        (r: ReservationModel) => r.tableId === table.id,
      );
      return !tableReservations.some((r: ReservationModel) =>
        overlaps(startTime, durationMinutes, r.startTime, r.durationMinutes),
      );
    });

    // Score and rank available tables
    const scoredTables: TableSuggestion[] = availableTables.map(
      (table: TableModel) => {
        const extraSeats = table.capacity - partySize;
        return {
          tableId: table.id,
          tableNumber: table.number,
          capacity: table.capacity,
          score: extraSeats,
          reason: SeatingService.getReasonForScore(extraSeats),
        };
      },
    );

    // Sort by score (best fit first)
    scoredTables.sort((a, b) => a.score - b.score);

    const suggestions: string[] = [];

    // No available tables
    if (scoredTables.length === 0) {
      // Check if any table could fit the party at all
      if (candidateTables.length === 0) {
        const largestTable = allTables[allTables.length - 1];
        suggestions.push(
          `Largest table seats ${largestTable.capacity} guests. Consider splitting the party.`,
        );

        // Suggest alternative party sizes
        const fittingTables = allTables.filter(
          (t: TableModel) => t.capacity >= Math.floor(partySize / 2),
        );
        if (fittingTables.length > 0) {
          suggestions.push(
            `Tables available for parties of ${fittingTables[0].capacity} or less`,
          );
        }
      } else {
        suggestions.push(
          "All suitable tables are booked for this time. Consider:",
        );
        suggestions.push("- Trying a different time slot");
        suggestions.push("- Adding yourself to the waitlist");
      }

      return {
        noTablesAvailable: true,
        alternatives: [],
        suggestions,
      };
    }

    // Found available tables
    const bestTable = scoredTables[0];
    const alternatives = scoredTables.slice(1, 4); // Up to 3 alternatives

    if (bestTable.score === 0) {
      suggestions.push("Perfect match! Table fits your party exactly.");
    } else if (bestTable.score <= 2) {
      suggestions.push(
        `Good fit - table has ${bestTable.score} extra seat(s).`,
      );
    } else {
      suggestions.push(
        `Best available: table has ${bestTable.score} extra seats.`,
      );
      if (alternatives.length > 0) {
        suggestions.push("Consider the alternative options listed.");
      }
    }

    return {
      bestTable,
      alternatives,
      noTablesAvailable: false,
      suggestions,
    };
  }

  /**
   * Get all available tables with scoring for a time slot
   */
  static async getAvailableTablesWithScoring(
    restaurantId: number,
    partySize: number,
    startTime: Date,
    durationMinutes: number,
  ): Promise<{
    availableTables: TableSuggestion[];
    partySizeRecommendations: string[];
  }> {
    const result = await SeatingService.findOptimalTable(
      restaurantId,
      partySize,
      startTime,
      durationMinutes,
    );

    const recommendations: string[] = [];

    if (result.noTablesAvailable) {
      recommendations.push(...result.suggestions);
    } else {
      if (result.bestTable!.score > 2) {
        recommendations.push(
          `Your party of ${partySize} will be seated at a table for ${result.bestTable!.capacity}`,
        );
      }
    }

    const availableTables = result.bestTable
      ? [result.bestTable, ...result.alternatives]
      : [];

    return {
      availableTables,
      partySizeRecommendations: recommendations,
    };
  }

  /**
   * Suggest alternative times when preferred time is not available
   */
  static async suggestAlternativeTimes(
    restaurantId: number,
    partySize: number,
    preferredStart: Date,
    durationMinutes: number,
    searchWindowMinutes: number = 120, // Look 2 hours before and after
    stepMinutes: number = 30,
  ): Promise<
    Array<{
      startTime: Date;
      table: TableSuggestion;
    }>
  > {
    const alternatives: Array<{ startTime: Date; table: TableSuggestion }> = [];

    // Search before and after preferred time
    for (
      let offset = -searchWindowMinutes;
      offset <= searchWindowMinutes;
      offset += stepMinutes
    ) {
      if (offset === 0) continue; // Skip the original time

      const alternativeTime = addMinutes(preferredStart, offset);
      const result = await SeatingService.findOptimalTable(
        restaurantId,
        partySize,
        alternativeTime,
        durationMinutes,
      );

      if (!result.noTablesAvailable && result.bestTable) {
        alternatives.push({
          startTime: alternativeTime,
          table: result.bestTable,
        });
      }

      // Limit to 5 alternatives
      if (alternatives.length >= 5) break;
    }

    return alternatives;
  }

  /**
   * Get reason text based on score
   */
  private static getReasonForScore(extraSeats: number): string {
    if (extraSeats === 0) return "Exact match";
    if (extraSeats === 1) return "1 extra seat";
    if (extraSeats === 2) return "2 extra seats";
    if (extraSeats <= 4) return `${extraSeats} extra seats - good fit`;
    return `${extraSeats} extra seats - larger table`;
  }
}
