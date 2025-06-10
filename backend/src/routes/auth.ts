import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '@/models/User';
import { validate, schemas } from '@/middleware/validation';
import { authenticate, userRateLimit } from '@/middleware/auth';
import { asyncHandler } from '@/middleware/errorHandler';
import { redisUtils } from '@/config/redis';
import { logger } from '@/utils/logger';
import { ApiResponse, AuthToken } from '@/types';

const router = Router();

interface AuthRequest extends Request {
  user?: any;
}

// Generate JWT tokens
const generateTokens = (userId: string): AuthToken => {
  const jwtSecret = process.env.JWT_SECRET!;
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET!;
  
  const accessToken = jwt.sign(
    { userId },
    jwtSecret,
    { expiresIn: process.env.JWT_EXPIRE || '24h' }
  );
  
  const refreshToken = jwt.sign(
    { userId },
    jwtRefreshSecret,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );
  
  return {
    accessToken,
    refreshToken,
    expiresIn: 24 * 60 * 60, // 24 hours in seconds
  };
};

// Register new user
router.post('/register', 
  userRateLimit(5, 15), // 5 requests per 15 minutes
  validate(schemas.register),
  asyncHandler(async (req: Request, res: Response<ApiResponse<{ user: any; tokens: AuthToken }>>): Promise<void> => {
    const { email, username, password, fullName } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });
    
    if (existingUser) {
      const field = existingUser.email === email ? 'email' : 'username';
      res.status(400).json({
        success: false,
        error: 'User already exists',
        errors: { [field]: `${field} already taken` }
      });
      return;
    }
    
    // Create new user
    const user = new User({
      email,
      username,
      password,
      fullName,
    });
    
    await user.save();
    
    // Generate tokens
    const tokens = generateTokens(user._id.toString());
    
    // Store refresh token in Redis
    await redisUtils.setCache(
      `refresh_token:${user._id}`,
      tokens.refreshToken,
      7 * 24 * 60 * 60 // 7 days
    );
    
    logger.info(`New user registered: ${user.email}`);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: user.toJSON(),
        tokens,
      },
    });
  })
);

// Login user
router.post('/login',
  userRateLimit(10, 15), // 10 requests per 15 minutes
  validate(schemas.login),
  asyncHandler(async (req: Request, res: Response<ApiResponse<{ user: any; tokens: AuthToken }>>): Promise<void> => {
    const { email, password, deviceToken } = req.body;
    
    // Find user and include password field
    const user = await User.findOne({ email }).select('+password');
    
    if (!user || !(await user.comparePassword(password))) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password',
      });
      return;
    }
    
    // Update device token if provided
    if (deviceToken && !user.deviceTokens.includes(deviceToken)) {
      user.deviceTokens.push(deviceToken);
      await user.save();
    }
    
    // Generate tokens
    const tokens = generateTokens(user._id.toString());
    
    // Store refresh token in Redis
    await redisUtils.setCache(
      `refresh_token:${user._id}`,
      tokens.refreshToken,
      7 * 24 * 60 * 60 // 7 days
    );
    
    // Update last active
    user.updateLastActive();
    
    logger.info(`User logged in: ${user.email}`);
    
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toJSON(),
        tokens,
      },
    });
  })
);

// Refresh tokens
router.post('/refresh',
  asyncHandler(async (req: Request, res: Response<ApiResponse<{ tokens: AuthToken }>>): Promise<void> => {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      res.status(401).json({
        success: false,
        error: 'Refresh token required',
      });
      return;
    }
    
    try {
      // Verify refresh token
      const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET!;
      const decoded = jwt.verify(refreshToken, jwtRefreshSecret) as { userId: string };
      
      // Check if refresh token exists in Redis
      const storedToken = await redisUtils.getCache(`refresh_token:${decoded.userId}`);
      
      if (!storedToken || storedToken !== refreshToken) {
        res.status(401).json({
          success: false,
          error: 'Invalid refresh token',
        });
        return;
      }
      
      // Generate new tokens
      const tokens = generateTokens(decoded.userId);
      
      // Update refresh token in Redis
      await redisUtils.setCache(
        `refresh_token:${decoded.userId}`,
        tokens.refreshToken,
        7 * 24 * 60 * 60 // 7 days
      );
      
      res.json({
        success: true,
        message: 'Tokens refreshed successfully',
        data: { tokens },
      });
      
    } catch (error) {
      res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
      });
    }
  })
);

// Logout user
router.post('/logout',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
    const { deviceToken } = req.body;
    const user = req.user;
    
    // Remove device token if provided
    if (deviceToken) {
      user.deviceTokens = user.deviceTokens.filter(
        (token: string) => token !== deviceToken
      );
      await user.save();
    }
    
    // Get token from header and blacklist it
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      // Blacklist the access token
      await redisUtils.setCache(
        `blacklist:${token}`,
        'blacklisted',
        24 * 60 * 60 // 24 hours
      );
    }
    
    // Remove refresh token from Redis
    await redisUtils.deleteCache(`refresh_token:${user._id}`);
    
    logger.info(`User logged out: ${user.email}`);
    
    res.json({
      success: true,
      message: 'Logout successful',
    });
  })
);

// Get current user
router.get('/me',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ user: any }>>): Promise<void> => {
    res.json({
      success: true,
      data: {
        user: req.user.toJSON(),
      },
    });
  })
);

// Verify email (placeholder - implement with email service)
router.post('/verify-email',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
    const { verificationCode } = req.body;
    
    // TODO: Implement email verification logic
    // For now, just mark as verified
    req.user.emailVerified = true;
    await req.user.save();
    
    res.json({
      success: true,
      message: 'Email verified successfully',
    });
  })
);

// Request password reset (placeholder)
router.post('/forgot-password',
  userRateLimit(3, 60), // 3 requests per hour
  asyncHandler(async (req: Request, res: Response<ApiResponse>): Promise<void> => {
    const { email } = req.body;
    
    // TODO: Implement password reset logic
    // Send reset email
    
    res.json({
      success: true,
      message: 'Password reset email sent',
    });
  })
);

export default router;