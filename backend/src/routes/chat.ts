import { Router, Request, Response } from 'express';
import { HoneyBadger } from '@/models/HoneyBadger';
import { authenticate, userRateLimit } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { aiChatService } from '@/services/aiChatService';
import { socketService } from '@/services/socketService';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types';

const router = Router();

interface AuthRequest extends Request {
  user?: any;
}

// Get chat history for a badger
router.get('/:badgerId',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ messages: any[]; badger: any }>>): Promise<void> => {
    const { badgerId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const user = req.user;
    
    // Find badger and verify user access
    const badger = await HoneyBadger.findOne({
      _id: badgerId,
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
    
    // Get paginated messages (most recent first)
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const messages = badger.chat
      .slice()
      .reverse() // Most recent first
      .slice(skip, skip + parseInt(limit as string))
      .reverse(); // Back to chronological order
    
    res.json({
      success: true,
      data: {
        messages,
        badger: {
          _id: badger._id,
          name: badger.name,
          status: badger.status,
          senderId: badger.senderId,
          recipientId: badger.recipientId,
          avatar: badger.avatar,
          personality: badger.personality,
        },
      },
    });
  })
);

// Send message to badger
router.post('/:badgerId/messages',
  authenticate,
  userRateLimit(60, 60), // 60 messages per hour
  validate(schemas.sendMessage),
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ message: any }>>): Promise<void> => {
    const { badgerId } = req.params;
    const { content, type = 'text' } = req.body;
    const user = req.user;
    
    // Find badger and verify user access
    const badger = await HoneyBadger.findOne({
      _id: badgerId,
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
    
    // Check if badger is active
    if (['completed', 'cancelled', 'expired'].includes(badger.status)) {
      res.status(400).json({
        success: false,
        error: 'Cannot send messages to inactive badger',
      });
      return;
    }
    
    // Add user message
    const userMessage = {
      senderId: user._id.toString(),
      content,
      type,
      timestamp: new Date(),
    };
    
    await badger.addChatMessage(userMessage);
    
    // Generate AI response
    const aiResponse = await aiChatService.generateChatResponse(
      badger,
      content,
      user.fullName
    );
    
    const aiMessage = {
      senderId: 'badger',
      content: aiResponse.content,
      type: 'text',
      timestamp: new Date(),
      metadata: aiResponse.metadata,
    };
    
    await badger.addChatMessage(aiMessage);
    
    // Emit to socket rooms
    socketService.emitToBadgerRoom(badgerId, 'message-received', userMessage);
    socketService.emitToBadgerRoom(badgerId, 'message-received', aiMessage);
    
    logger.info(`Chat message sent in badger ${badgerId} by user ${user._id}`);
    
    res.json({
      success: true,
      message: 'Message sent successfully',
      data: {
        message: userMessage,
      },
    });
  })
);

// Mark messages as read
router.post('/:badgerId/read',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
    const { badgerId } = req.params;
    const { messageId } = req.body;
    const user = req.user;
    
    // Find badger and verify user access
    const badger = await HoneyBadger.findOne({
      _id: badgerId,
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
    
    // TODO: Implement read status tracking if needed
    // For now, just acknowledge the request
    
    res.json({
      success: true,
      message: 'Messages marked as read',
    });
  })
);

// Get badger's motivational quote
router.get('/:badgerId/motivation',
  authenticate,
  userRateLimit(20, 60), // 20 requests per hour
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ quote: string; mood: string }>>): Promise<void> => {
    const { badgerId } = req.params;
    const user = req.user;
    
    // Find badger and verify user access
    const badger = await HoneyBadger.findOne({
      _id: badgerId,
      recipientId: user._id, // Only recipient can get motivation
    });
    
    if (!badger) {
      res.status(404).json({
        success: false,
        error: 'Badger not found',
      });
      return;
    }
    
    // Generate motivational quote based on progress and personality
    const motivation = await aiChatService.generateMotivationalQuote(
      badger,
      user.fullName
    );
    
    res.json({
      success: true,
      data: motivation,
    });
  })
);

// Get chat analytics (for sender)
router.get('/:badgerId/analytics',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ analytics: any }>>): Promise<void> => {
    const { badgerId } = req.params;
    const user = req.user;
    
    // Find badger and verify sender access
    const badger = await HoneyBadger.findOne({
      _id: badgerId,
      senderId: user._id,
    });
    
    if (!badger) {
      res.status(404).json({
        success: false,
        error: 'Badger not found or not authorized',
      });
      return;
    }
    
    // Calculate chat analytics
    const totalMessages = badger.chat.length;
    const userMessages = badger.chat.filter(msg => msg.senderId !== 'badger').length;
    const badgerMessages = badger.chat.filter(msg => msg.senderId === 'badger').length;
    const averageResponseTime = calculateAverageResponseTime(badger.chat);
    const engagementLevel = calculateEngagementLevel(badger.chat);
    
    const analytics = {
      totalMessages,
      userMessages,
      badgerMessages,
      averageResponseTime,
      engagementLevel,
      lastActivity: badger.chat[badger.chat.length - 1]?.timestamp || badger.createdAt,
      taskProgress: badger.task.progress.percentage,
      status: badger.status,
    };
    
    res.json({
      success: true,
      data: { analytics },
    });
  })
);

// Helper function to calculate average response time
function calculateAverageResponseTime(messages: any[]): number {
  if (messages.length < 2) return 0;
  
  let totalTime = 0;
  let responseCount = 0;
  
  for (let i = 1; i < messages.length; i++) {
    const current = messages[i];
    const previous = messages[i - 1];
    
    // If it's a badger response to a user message
    if (current.senderId === 'badger' && previous.senderId !== 'badger') {
      const responseTime = new Date(current.timestamp).getTime() - 
                          new Date(previous.timestamp).getTime();
      totalTime += responseTime;
      responseCount++;
    }
  }
  
  return responseCount > 0 ? Math.round(totalTime / responseCount / 1000) : 0; // in seconds
}

// Helper function to calculate engagement level
function calculateEngagementLevel(messages: any[]): string {
  if (messages.length === 0) return 'none';
  
  const userMessages = messages.filter(msg => msg.senderId !== 'badger').length;
  const totalDays = Math.max(1, Math.ceil(
    (new Date().getTime() - new Date(messages[0].timestamp).getTime()) / (1000 * 60 * 60 * 24)
  ));
  
  const messagesPerDay = userMessages / totalDays;
  
  if (messagesPerDay >= 3) return 'high';
  if (messagesPerDay >= 1) return 'medium';
  if (messagesPerDay > 0) return 'low';
  return 'none';
}

export default router;