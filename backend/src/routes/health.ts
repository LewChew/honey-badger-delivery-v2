import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { getRedisClient } from '@/config/redis';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types';

const router = Router();

interface HealthResponse extends ApiResponse {
  data?: {
    status: string;
    timestamp: string;
    uptime: number;
    version: string;
    environment: string;
    services: {
      database: {
        status: string;
        connected: boolean;
        responseTime?: number;
      };
      redis: {
        status: string;
        connected: boolean;
        responseTime?: number;
      };
      memory: {
        used: string;
        total: string;
        percentage: number;
      };
      cpu: {
        usage: number;
      };
    };
  };
}

// Basic health check
router.get('/', async (req: Request, res: Response<HealthResponse>) => {
  try {
    const startTime = Date.now();
    
    // Check MongoDB connection
    let dbStatus = 'down';
    let dbConnected = false;
    let dbResponseTime = 0;
    
    try {
      const dbStart = Date.now();
      await mongoose.connection.db.admin().ping();
      dbResponseTime = Date.now() - dbStart;
      dbStatus = 'up';
      dbConnected = true;
    } catch (error) {
      logger.error('Database health check failed:', error);
    }

    // Check Redis connection
    let redisStatus = 'down';
    let redisConnected = false;
    let redisResponseTime = 0;
    
    try {
      const redisStart = Date.now();
      const redisClient = getRedisClient();
      await redisClient.ping();
      redisResponseTime = Date.now() - redisStart;
      redisStatus = 'up';
      redisConnected = true;
    } catch (error) {
      logger.error('Redis health check failed:', error);
    }

    // Memory usage
    const memoryUsage = process.memoryUsage();
    const totalMemory = memoryUsage.heapTotal;
    const usedMemory = memoryUsage.heapUsed;
    const memoryPercentage = Math.round((usedMemory / totalMemory) * 100);

    // CPU usage (basic calculation)
    const cpuUsage = process.cpuUsage();
    const cpuPercentage = Math.round(
      ((cpuUsage.user + cpuUsage.system) / 1000000) * 100
    );

    const overallStatus = dbConnected && redisConnected ? 'healthy' : 'unhealthy';
    const statusCode = overallStatus === 'healthy' ? 200 : 503;

    const healthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: {
          status: dbStatus,
          connected: dbConnected,
          responseTime: dbResponseTime,
        },
        redis: {
          status: redisStatus,
          connected: redisConnected,
          responseTime: redisResponseTime,
        },
        memory: {
          used: `${Math.round(usedMemory / 1024 / 1024)} MB`,
          total: `${Math.round(totalMemory / 1024 / 1024)} MB`,
          percentage: memoryPercentage,
        },
        cpu: {
          usage: cpuPercentage,
        },
      },
    };

    res.status(statusCode).json({
      success: overallStatus === 'healthy',
      data: healthData,
    });

  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      data: {
        status: 'error',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        services: {
          database: { status: 'unknown', connected: false },
          redis: { status: 'unknown', connected: false },
          memory: { used: '0 MB', total: '0 MB', percentage: 0 },
          cpu: { usage: 0 },
        },
      },
    });
  }
});

// Liveness probe
router.get('/live', (req: Request, res: Response<ApiResponse>) => {
  res.status(200).json({
    success: true,
    message: 'Server is alive',
  });
});

// Readiness probe
router.get('/ready', async (req: Request, res: Response<ApiResponse>) => {
  try {
    // Check if all required services are ready
    await mongoose.connection.db.admin().ping();
    const redisClient = getRedisClient();
    await redisClient.ping();
    
    res.status(200).json({
      success: true,
      message: 'Server is ready',
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: 'Server not ready',
    });
  }
});

export default router;