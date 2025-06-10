import { Router, Request, Response } from 'express';
import { HoneyBadger } from '@/models/HoneyBadger';
import { User } from '@/models/User';
import { authenticate, userRateLimit } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { aiChatService } from '@/services/aiChatService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types';

const router = Router();

interface AuthRequest extends Request {
  user?: any;
}

// Create new honey badger
router.post('/',
  authenticate,
  userRateLimit(10, 60), // 10 badgers per hour
  validate(schemas.createBadger),
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ badger: any }>>): Promise<void> => {
    const { name, recipientEmail, task, reward, personality, expiresAt } = req.body;
    const sender = req.user;
    
    // Find recipient by email
    const recipient = await User.findOne({ email: recipientEmail });
    if (!recipient) {
      res.status(404).json({
        success: false,
        error: 'Recipient not found',
      });
      return;
    }
    
    // Can't send to yourself
    if (recipient._id.toString() === sender._id.toString()) {
      res.status(400).json({
        success: false,
        error: 'Cannot send badger to yourself',
      });
      return;
    }
    
    // Create honey badger with sender's personality preferences as default
    const badgerPersonality = {
      ...sender.preferences.badgerPersonality,
      ...personality,
    };
    
    const badger = new HoneyBadger({
      name,
      senderId: sender._id,
      recipientId: recipient._id,
      personality: badgerPersonality,
      task,
      reward,
      expiresAt,
      status: 'sent',
    });
    
    await badger.save();
    
    // Add welcome message from the badger
    const welcomeMessage = await aiChatService.generateWelcomeMessage(
      badger,
      sender.fullName,
      recipient.fullName
    );
    
    await badger.addChatMessage({
      senderId: 'badger',
      content: welcomeMessage,
      type: 'text',
      metadata: {
        emotion: 'excited',
        motivation: 'introduction',
      },
    });
    
    // Send notification to recipient
    await notificationService.sendBadgerNotification(
      recipient,
      'New Honey Badger Arrived!',
      `${sender.fullName} sent you a motivational honey badger named ${name}`,
      { badgerId: badger._id.toString() }
    );
    
    logger.info(`Badger created: ${badger._id} from ${sender.email} to ${recipient.email}`);
    
    res.status(201).json({
      success: true,
      message: 'Honey badger sent successfully',
      data: {
        badger: badger.toJSON(),
      },
    });
  })
);

// Get sent badgers
router.get('/sent',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ badgers: any[]; total: number; page: number }>>): Promise<void> => {
    const { page = 1, limit = 10, status } = req.query;
    const user = req.user;
    
    const query: any = { senderId: user._id };
    if (status) {
      query.status = status;
    }
    
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    
    const [badgers, total] = await Promise.all([
      HoneyBadger.find(query)
        .populate('recipientId', 'username fullName avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit as string))
        .lean(),
      HoneyBadger.countDocuments(query),
    ]);
    
    res.json({
      success: true,
      data: {
        badgers,
        total,
        page: parseInt(page as string),
      },
    });
  })
);

// Get received badgers
router.get('/received',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ badgers: any[]; total: number; page: number }>>): Promise<void> => {
    const { page = 1, limit = 10, status } = req.query;
    const user = req.user;
    
    const query: any = { recipientId: user._id };
    if (status) {
      query.status = status;
    }
    
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    
    const [badgers, total] = await Promise.all([
      HoneyBadger.find(query)
        .populate('senderId', 'username fullName avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit as string))
        .lean(),
      HoneyBadger.countDocuments(query),
    ]);
    
    res.json({
      success: true,
      data: {
        badgers,
        total,
        page: parseInt(page as string),
      },
    });
  })
);

// Get specific badger
router.get('/:id',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ badger: any }>>): Promise<void> => {
    const { id } = req.params;
    const user = req.user;
    
    const badger = await HoneyBadger.findOne({
      _id: id,
      $or: [
        { senderId: user._id },
        { recipientId: user._id },
      ],
    })
    .populate('senderId', 'username fullName avatar')
    .populate('recipientId', 'username fullName avatar');
    
    if (!badger) {
      res.status(404).json({
        success: false,
        error: 'Badger not found',
      });
      return;
    }
    
    // Mark as received if recipient is viewing for first time
    if (badger.recipientId._id.toString() === user._id.toString() && 
        badger.status === 'sent') {
      badger.status = 'received';
      await badger.save();
    }
    
    res.json({
      success: true,
      data: {
        badger: badger.toJSON(),
      },
    });
  })
);

// Update badger status
router.patch('/:id/status',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ badger: any }>>): Promise<void> => {
    const { id } = req.params;
    const { status } = req.body;
    const user = req.user;
    
    const badger = await HoneyBadger.findOne({
      _id: id,
      $or: [
        { senderId: user._id },
        { recipientId: user._id },
      ],
    });
    
    if (!badger) {
      res.status(404).json({
        success: false,
        error: 'Badger not found',
      });
      return;
    }
    
    // Only allow certain status transitions
    const allowedTransitions: Record<string, string[]> = {
      'sent': ['received', 'cancelled'],
      'received': ['in-progress', 'cancelled'],
      'in-progress': ['awaiting-verification', 'cancelled'],
      'awaiting-verification': ['completed', 'in-progress'],
    };
    
    if (!allowedTransitions[badger.status]?.includes(status)) {
      res.status(400).json({
        success: false,
        error: `Invalid status transition from ${badger.status} to ${status}`,
      });
      return;
    }
    
    badger.status = status;
    
    if (status === 'completed') {
      badger.completedAt = new Date();
      badger.task.progress.completed = true;
      badger.task.progress.percentage = 100;
    }
    
    await badger.save();
    
    logger.info(`Badger status updated: ${badger._id} to ${status}`);
    
    res.json({
      success: true,
      message: 'Badger status updated successfully',
      data: {
        badger: badger.toJSON(),
      },
    });
  })
);

// Cancel badger (only for sender)
router.delete('/:id',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
    const { id } = req.params;
    const user = req.user;
    
    const badger = await HoneyBadger.findOne({
      _id: id,
      senderId: user._id,
    });
    
    if (!badger) {
      res.status(404).json({
        success: false,
        error: 'Badger not found or not authorized',
      });
      return;
    }
    
    // Can only cancel if not completed
    if (badger.status === 'completed') {
      res.status(400).json({
        success: false,
        error: 'Cannot cancel completed badger',
      });
      return;
    }
    
    badger.status = 'cancelled';
    await badger.save();
    
    logger.info(`Badger cancelled: ${badger._id}`);
    
    res.json({
      success: true,
      message: 'Badger cancelled successfully',
    });
  })
);

export default router;