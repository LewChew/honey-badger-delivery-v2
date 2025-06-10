import { Router, Request, Response } from 'express';
import multer from 'multer';
import { User } from '@/models/User';
import { HoneyBadger } from '@/models/HoneyBadger';
import { authenticate, userRateLimit } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { uploadToS3, deleteFromS3 } from '@/services/fileService';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types';

const router = Router();

interface AuthRequest extends Request {
  user?: any;
}

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Get user profile
router.get('/profile',
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

// Update user profile
router.put('/profile',
  authenticate,
  validate(schemas.updateProfile),
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ user: any }>>): Promise<void> => {
    const { fullName, phoneNumber, avatar } = req.body;
    const user = req.user;
    
    if (fullName !== undefined) user.fullName = fullName;
    if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;
    if (avatar !== undefined) user.avatar = avatar;
    
    await user.save();
    
    logger.info(`User profile updated: ${user.email}`);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: user.toJSON(),
      },
    });
  })
);

// Upload avatar
router.post('/avatar',
  authenticate,
  userRateLimit(10, 60), // 10 uploads per hour
  upload.single('avatar'),
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ avatarUrl: string }>>): Promise<void> => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No file provided',
      });
      return;
    }
    
    const user = req.user;
    
    try {
      // Delete old avatar if exists
      if (user.avatar && user.avatar !== 'default-avatar.png') {
        await deleteFromS3(user.avatar);
      }
      
      // Upload new avatar
      const fileName = `avatars/${user._id}-${Date.now()}.${req.file.originalname.split('.').pop()}`;
      const avatarUrl = await uploadToS3(req.file.buffer, fileName, req.file.mimetype);
      
      user.avatar = avatarUrl;
      await user.save();
      
      logger.info(`Avatar uploaded for user: ${user.email}`);
      
      res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          avatarUrl,
        },
      });
      
    } catch (error) {
      logger.error('Avatar upload failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload avatar',
      });
    }
  })
);

// Update user preferences
router.put('/preferences',
  authenticate,
  validate(schemas.updatePreferences),
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ preferences: any }>>): Promise<void> => {
    const user = req.user;
    
    // Deep merge preferences
    if (req.body.notifications) {
      Object.assign(user.preferences.notifications, req.body.notifications);
    }
    if (req.body.privacy) {
      Object.assign(user.preferences.privacy, req.body.privacy);
    }
    if (req.body.badgerPersonality) {
      Object.assign(user.preferences.badgerPersonality, req.body.badgerPersonality);
    }
    
    await user.save();
    
    logger.info(`Preferences updated for user: ${user.email}`);
    
    res.json({
      success: true,
      message: 'Preferences updated successfully',
      data: {
        preferences: user.preferences,
      },
    });
  })
);

// Add device token for push notifications
router.post('/device-token',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
    const { deviceToken } = req.body;
    
    if (!deviceToken) {
      res.status(400).json({
        success: false,
        error: 'Device token required',
      });
      return;
    }
    
    const user = req.user;
    
    // Add device token if not already present
    if (!user.deviceTokens.includes(deviceToken)) {
      user.deviceTokens.push(deviceToken);
      await user.save();
    }
    
    res.json({
      success: true,
      message: 'Device token registered successfully',
    });
  })
);

// Remove device token
router.delete('/device-token',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
    const { deviceToken } = req.body;
    
    if (!deviceToken) {
      res.status(400).json({
        success: false,
        error: 'Device token required',
      });
      return;
    }
    
    const user = req.user;
    
    user.deviceTokens = user.deviceTokens.filter(
      (token: string) => token !== deviceToken
    );
    await user.save();
    
    res.json({
      success: true,
      message: 'Device token removed successfully',
    });
  })
);

// Get user statistics
router.get('/stats',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ stats: any }>>): Promise<void> => {
    const user = req.user;
    
    // Get badger statistics
    const [sentBadgers, receivedBadgers, completedBadgers] = await Promise.all([
      HoneyBadger.countDocuments({ senderId: user._id }),
      HoneyBadger.countDocuments({ recipientId: user._id }),
      HoneyBadger.countDocuments({ 
        recipientId: user._id, 
        status: 'completed' 
      }),
    ]);
    
    // Calculate completion rate
    const completionRate = receivedBadgers > 0 
      ? Math.round((completedBadgers / receivedBadgers) * 100) 
      : 0;
    
    const stats = {
      badgers: {
        sent: sentBadgers,
        received: receivedBadgers,
        completed: completedBadgers,
        completionRate,
      },
      profile: {
        joinDate: user.createdAt,
        lastActive: user.lastActive,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
      },
    };
    
    res.json({
      success: true,
      data: { stats },
    });
  })
);

// Search users (for finding recipients)
router.get('/search',
  authenticate,
  userRateLimit(20, 60), // 20 searches per hour
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ users: any[] }>>): Promise<void> => {
    const { q, limit = 10 } = req.query;
    
    if (!q || typeof q !== 'string' || q.length < 2) {
      res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters',
      });
      return;
    }
    
    // Search by username or email
    const users = await User.find({
      $and: [
        {
          $or: [
            { username: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } },
            { fullName: { $regex: q, $options: 'i' } },
          ],
        },
        { _id: { $ne: req.user._id } }, // Exclude current user
      ],
    })
    .select('username email fullName avatar')
    .limit(parseInt(limit as string))
    .lean();
    
    res.json({
      success: true,
      data: { users },
    });
  })
);

// Delete user account
router.delete('/account',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
    const user = req.user;
    
    try {
      // Delete user's avatar from S3
      if (user.avatar && user.avatar !== 'default-avatar.png') {
        await deleteFromS3(user.avatar);
      }
      
      // TODO: Handle cleanup of badgers, payments, etc.
      // For now, just delete the user
      await User.findByIdAndDelete(user._id);
      
      logger.info(`User account deleted: ${user.email}`);
      
      res.json({
        success: true,
        message: 'Account deleted successfully',
      });
      
    } catch (error) {
      logger.error('Account deletion failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete account',
      });
    }
  })
);

export default router;