import { Router, Request, Response } from 'express';
import multer from 'multer';
import { HoneyBadger } from '@/models/HoneyBadger';
import { authenticate, userRateLimit } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { uploadToS3 } from '@/services/fileService';
import { aiChatService } from '@/services/aiChatService';
import { fitnessService } from '@/services/fitnessService';
import { notificationService } from '@/services/notificationService';
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
    fileSize: 50 * 1024 * 1024, // 50MB limit for videos
  },
  fileFilter: (req, file, cb) => {
    // Allow images and videos
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed'));
    }
  },
});

// Submit task progress/completion
router.post('/:badgerId/submit',
  authenticate,
  userRateLimit(20, 60), // 20 submissions per hour
  upload.array('files', 5), // Max 5 files
  validate(schemas.submitTask),
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ badger: any }>>): Promise<void> => {
    const { badgerId } = req.params;
    const { submissions } = req.body;
    const user = req.user;
    const files = req.files as Express.Multer.File[];
    
    // Find badger and verify user is recipient
    const badger = await HoneyBadger.findOne({
      _id: badgerId,
      recipientId: user._id,
    });
    
    if (!badger) {
      res.status(404).json({
        success: false,
        error: 'Badger not found or not authorized',
      });
      return;
    }
    
    // Check if badger is in correct status
    if (!['received', 'in-progress', 'awaiting-verification'].includes(badger.status)) {
      res.status(400).json({
        success: false,
        error: 'Cannot submit to badger in current status',
      });
      return;
    }
    
    try {
      // Process file uploads if any
      const uploadedFiles: string[] = [];
      if (files && files.length > 0) {
        for (const file of files) {
          const fileName = `submissions/${badgerId}/${Date.now()}-${file.originalname}`;
          const fileUrl = await uploadToS3(file.buffer, fileName, file.mimetype);
          uploadedFiles.push(fileUrl);
        }
      }
      
      // Process submissions
      const processedSubmissions = submissions.map((submission: any, index: number) => {
        const processed = {
          ...submission,
          timestamp: new Date(),
        };
        
        // Replace content with uploaded file URL if applicable
        if (submission.type === 'photo' || submission.type === 'video') {
          if (uploadedFiles[index]) {
            processed.content = uploadedFiles[index];
          }
        }
        
        return processed;
      });
      
      // Add submissions to task progress
      badger.task.progress.submissions.push(...processedSubmissions);
      
      // Calculate progress based on task requirements
      const progress = await calculateTaskProgress(badger, processedSubmissions);
      badger.task.progress.percentage = progress.percentage;
      badger.task.progress.completed = progress.completed;
      badger.task.progress.verificationStatus = progress.verificationStatus;
      badger.task.progress.lastUpdated = new Date();
      
      // Update badger status
      if (progress.completed) {
        badger.status = badger.task.verificationMethod === 'automatic' ? 'completed' : 'awaiting-verification';
        if (badger.status === 'completed') {
          badger.completedAt = new Date();
        }
      } else if (badger.status === 'received') {
        badger.status = 'in-progress';
      }
      
      await badger.save();
      
      // Generate AI response
      const aiResponse = await aiChatService.generateProgressResponse(
        badger,
        processedSubmissions,
        progress
      );
      
      await badger.addChatMessage({
        senderId: 'badger',
        content: aiResponse,
        type: 'text',
        metadata: {
          emotion: progress.completed ? 'celebratory' : 'encouraging',
          motivation: progress.completed ? 'completion' : 'progress',
          taskReference: badgerId,
        },
      });
      
      // Send notifications
      if (progress.completed) {
        // Notify sender about completion
        const sender = await badger.populate('senderId');
        await notificationService.sendTaskCompletionNotification(
          sender.senderId,
          badger,
          user.fullName
        );
      }
      
      logger.info(`Task submission for badger ${badgerId}: ${progress.percentage}% complete`);
      
      res.json({
        success: true,
        message: 'Task submission processed successfully',
        data: {
          badger: badger.toJSON(),
        },
      });
      
    } catch (error) {
      logger.error('Task submission failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process task submission',
      });
    }
  })
);

// Get task progress
router.get('/:badgerId/progress',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ progress: any }>>): Promise<void> => {
    const { badgerId } = req.params;
    const user = req.user;
    
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
    
    res.json({
      success: true,
      data: {
        progress: badger.task.progress,
      },
    });
  })
);

// Sync fitness data
router.post('/:badgerId/sync-fitness',
  authenticate,
  userRateLimit(10, 60), // 10 syncs per hour
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ progress: any }>>): Promise<void> => {
    const { badgerId } = req.params;
    const user = req.user;
    
    const badger = await HoneyBadger.findOne({
      _id: badgerId,
      recipientId: user._id,
    });
    
    if (!badger) {
      res.status(404).json({
        success: false,
        error: 'Badger not found',
      });
      return;
    }
    
    // Check if task is fitness-related
    if (badger.task.type !== 'fitness') {
      res.status(400).json({
        success: false,
        error: 'Task is not fitness-related',
      });
      return;
    }
    
    try {
      // Sync fitness data from connected services
      const fitnessData = await fitnessService.syncUserData(user);
      
      // Update task progress based on fitness data
      const progress = await calculateFitnessProgress(badger, fitnessData);
      
      badger.task.progress.percentage = progress.percentage;
      badger.task.progress.completed = progress.completed;
      badger.task.progress.lastUpdated = new Date();
      
      if (progress.completed && badger.status !== 'completed') {
        badger.status = 'completed';
        badger.completedAt = new Date();
      }
      
      await badger.save();
      
      logger.info(`Fitness data synced for badger ${badgerId}`);
      
      res.json({
        success: true,
        message: 'Fitness data synced successfully',
        data: {
          progress: badger.task.progress,
        },
      });
      
    } catch (error) {
      logger.error('Fitness sync failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to sync fitness data',
      });
    }
  })
);

// Helper function to calculate task progress
async function calculateTaskProgress(badger: any, submissions: any[]): Promise<any> {
  const { requirements, verificationMethod } = badger.task;
  let totalProgress = 0;
  let completedRequirements = 0;
  
  for (const requirement of requirements) {
    let requirementMet = false;
    
    // Check submissions against requirement
    for (const submission of submissions) {
      if (requirement.type === submission.type) {
        if (requirement.type === 'photo' || requirement.type === 'video') {
          requirementMet = true;
        } else if (typeof requirement.target === 'number' && 
                   typeof submission.content === 'number') {
          requirementMet = submission.content >= requirement.target;
        } else if (requirement.type === 'text' && submission.content) {
          requirementMet = true;
        }
      }
    }
    
    if (requirementMet) {
      completedRequirements++;
    }
  }
  
  const percentage = Math.round((completedRequirements / requirements.length) * 100);
  const completed = percentage === 100;
  
  return {
    percentage,
    completed,
    verificationStatus: verificationMethod === 'automatic' ? 'approved' : 'pending',
  };
}

// Helper function to calculate fitness progress
async function calculateFitnessProgress(badger: any, fitnessData: any): Promise<any> {
  const { requirements } = badger.task;
  let totalProgress = 0;
  let completedRequirements = 0;
  
  for (const requirement of requirements) {
    let progress = 0;
    
    switch (requirement.type) {
      case 'step-count':
        progress = Math.min(fitnessData.steps / requirement.target, 1);
        break;
      case 'exercise-minutes':
        progress = Math.min(fitnessData.exerciseMinutes / requirement.target, 1);
        break;
      case 'distance':
        progress = Math.min(fitnessData.distance / requirement.target, 1);
        break;
      case 'calories':
        progress = Math.min(fitnessData.calories / requirement.target, 1);
        break;
    }
    
    totalProgress += progress;
    if (progress >= 1) {
      completedRequirements++;
    }
  }
  
  const percentage = Math.round((totalProgress / requirements.length) * 100);
  const completed = completedRequirements === requirements.length;
  
  return {
    percentage,
    completed,
  };
}

export default router;