import Redis from "ioredis";

// Redis client singleton
let redisClient: Redis | null = null;

/**
 * Get Redis client instance (singleton pattern)
 * Returns null if Redis is not configured
 */
export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("[REDIS] REDIS_URL not configured. Caching disabled.");
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    });

    redisClient.on("connect", () => {
      console.log("[REDIS] Connected successfully");
    });

    redisClient.on("error", (err) => {
      console.error("[REDIS] Connection error:", err.message);
    });

    return redisClient;
  } catch (error) {
    console.error("[REDIS] Failed to create client:", error);
    return null;
  }
}

/**
 * Cache key generators for consistent key naming
 */
export const CacheKeys = {
  // Availability cache for a specific restaurant, date, and parameters
  availability: (
    restaurantId: number,
    date: string,
    partySize: number,
    durationMinutes: number,
  ) => `avail:${restaurantId}:${date}:${partySize}:${durationMinutes}`,

  // Available slots for a restaurant on a specific date
  availableSlots: (
    restaurantId: number,
    date: string,
    partySize: number,
    durationMinutes: number,
  ) => `slots:${restaurantId}:${date}:${partySize}:${durationMinutes}`,

  // Peak hours configuration for a restaurant
  peakHours: (restaurantId: number) => `peak:${restaurantId}`,

  // Restaurant details
  restaurant: (restaurantId: number) => `rest:${restaurantId}`,

  // Pattern for invalidating all restaurant-related caches
  restaurantPattern: (restaurantId: number) => `*:${restaurantId}:*`,
};

// Default cache TTL in seconds
const DEFAULT_TTL = 300; // 5 minutes
const PEAK_HOURS_TTL = 3600; // 1 hour (peak hours change infrequently)

/**
 * Redis Cache Service for availability checks
 */
export class CacheService {
  /**
   * Get cached data
   */
  static async get<T>(key: string): Promise<T | null> {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (error) {
      console.warn("[CACHE] Get error:", (error as Error).message);
      return null;
    }
  }

  /**
   * Set cached data with optional TTL
   */
  static async set(
    key: string,
    value: unknown,
    ttl = DEFAULT_TTL,
  ): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
      await redis.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.warn("[CACHE] Set error:", (error as Error).message);
    }
  }

  /**
   * Delete a specific cache key
   */
  static async delete(key: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
      await redis.del(key);
    } catch (error) {
      console.warn("[CACHE] Delete error:", (error as Error).message);
    }
  }

  /**
   * Invalidate all caches matching a pattern
   * Used when reservations are created/updated/cancelled
   */
  static async invalidatePattern(pattern: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.warn("[CACHE] Invalidate error:", (error as Error).message);
    }
  }

  /**
   * Invalidate all availability caches for a restaurant on a specific date
   */
  static async invalidateRestaurantDate(
    restaurantId: number,
    date: string,
  ): Promise<void> {
    await CacheService.invalidatePattern(`avail:${restaurantId}:${date}:*`);
    await CacheService.invalidatePattern(`slots:${restaurantId}:${date}:*`);
  }

  /**
   * Cache availability check results
   */
  static async cacheAvailability(
    restaurantId: number,
    date: string,
    partySize: number,
    durationMinutes: number,
    data: unknown,
  ): Promise<void> {
    const key = CacheKeys.availability(
      restaurantId,
      date,
      partySize,
      durationMinutes,
    );
    await CacheService.set(key, data, DEFAULT_TTL);
  }

  /**
   * Get cached availability
   */
  static async getCachedAvailability<T>(
    restaurantId: number,
    date: string,
    partySize: number,
    durationMinutes: number,
  ): Promise<T | null> {
    const key = CacheKeys.availability(
      restaurantId,
      date,
      partySize,
      durationMinutes,
    );
    return CacheService.get<T>(key);
  }

  /**
   * Cache available slots
   */
  static async cacheSlots(
    restaurantId: number,
    date: string,
    partySize: number,
    durationMinutes: number,
    data: unknown,
  ): Promise<void> {
    const key = CacheKeys.availableSlots(
      restaurantId,
      date,
      partySize,
      durationMinutes,
    );
    await CacheService.set(key, data, DEFAULT_TTL);
  }

  /**
   * Get cached slots
   */
  static async getCachedSlots<T>(
    restaurantId: number,
    date: string,
    partySize: number,
    durationMinutes: number,
  ): Promise<T | null> {
    const key = CacheKeys.availableSlots(
      restaurantId,
      date,
      partySize,
      durationMinutes,
    );
    return CacheService.get<T>(key);
  }

  /**
   * Cache peak hours configuration
   */
  static async cachePeakHours(
    restaurantId: number,
    data: unknown,
  ): Promise<void> {
    const key = CacheKeys.peakHours(restaurantId);
    await CacheService.set(key, data, PEAK_HOURS_TTL);
  }

  /**
   * Get cached peak hours
   */
  static async getCachedPeakHours<T>(restaurantId: number): Promise<T | null> {
    const key = CacheKeys.peakHours(restaurantId);
    return CacheService.get<T>(key);
  }

  /**
   * Invalidate peak hours cache for a restaurant
   */
  static async invalidatePeakHours(restaurantId: number): Promise<void> {
    const key = CacheKeys.peakHours(restaurantId);
    await CacheService.delete(key);
  }
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
