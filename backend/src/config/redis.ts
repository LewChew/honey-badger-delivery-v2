import { createClient, RedisClientType } from 'redis';
import { logger } from '@/utils/logger';

let redisClient: RedisClientType;

export const connectRedis = async (): Promise<void> => {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        lazyConnect: true,
      },
    });

    redisClient.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Redis');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Reconnecting to Redis');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    await redisClient.connect();
    
    logger.info('Redis connected successfully');

  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
    throw error;
  }
};

export const getRedisClient = (): RedisClientType => {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }
  return redisClient;
};

// Redis utility functions
export const redisUtils = {
  // Cache with expiration
  setCache: async (key: string, value: any, expireInSeconds: number = 3600): Promise<void> => {
    try {
      await redisClient.setEx(key, expireInSeconds, JSON.stringify(value));
    } catch (error) {
      logger.error('Redis setCache error:', error);
    }
  },

  // Get cached data
  getCache: async <T>(key: string): Promise<T | null> => {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Redis getCache error:', error);
      return null;
    }
  },

  // Delete cache
  deleteCache: async (key: string): Promise<void> => {
    try {
      await redisClient.del(key);
    } catch (error) {
      logger.error('Redis deleteCache error:', error);
    }
  },

  // Session management
  setSession: async (sessionId: string, data: any, expireInSeconds: number = 86400): Promise<void> => {
    const key = `session:${sessionId}`;
    await redisUtils.setCache(key, data, expireInSeconds);
  },

  getSession: async <T>(sessionId: string): Promise<T | null> => {
    const key = `session:${sessionId}`;
    return await redisUtils.getCache<T>(key);
  },

  deleteSession: async (sessionId: string): Promise<void> => {
    const key = `session:${sessionId}`;
    await redisUtils.deleteCache(key);
  },

  // Rate limiting
  incrementCounter: async (key: string, windowInSeconds: number): Promise<number> => {
    try {
      const multi = redisClient.multi();
      multi.incr(key);
      multi.expire(key, windowInSeconds);
      const results = await multi.exec();
      return results?.[0] as number || 0;
    } catch (error) {
      logger.error('Redis incrementCounter error:', error);
      return 0;
    }
  },
};