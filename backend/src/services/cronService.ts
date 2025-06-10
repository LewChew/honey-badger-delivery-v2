import cron from 'node-cron';
import { HoneyBadger } from '@/models/HoneyBadger';
import { User } from '@/models/User';
import { notificationService } from './notificationService';
import { logger } from '@/utils/logger';

class CronService {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  
  start(): void {
    this.scheduleTaskReminders();
    this.scheduleDeadlineChecks();
    this.scheduleExpiredBadgerCleanup();
    this.scheduleMotivationalMessages();
    
    logger.info('Cron jobs started successfully');
  }
  
  stop(): void {
    this.jobs.forEach((job, name) => {
      job.stop();
      logger.info(`Stopped cron job: ${name}`);
    });
    this.jobs.clear();
  }
  
  private scheduleTaskReminders(): void {
    // Send reminders every 4 hours for active badgers
    const reminderJob = cron.schedule('0 */4 * * *', async () => {
      try {
        await this.sendTaskReminders();
      } catch (error) {
        logger.error('Task reminder job failed:', error);
      }
    }, { scheduled: false });
    
    this.jobs.set('taskReminders', reminderJob);
    reminderJob.start();
    
    logger.info('Task reminder job scheduled (every 4 hours)');
  }
  
  private scheduleDeadlineChecks(): void {
    // Check for approaching deadlines every hour
    const deadlineJob = cron.schedule('0 * * * *', async () => {
      try {
        await this.checkDeadlines();
      } catch (error) {
        logger.error('Deadline check job failed:', error);
      }
    }, { scheduled: false });
    
    this.jobs.set('deadlineChecks', deadlineJob);
    deadlineJob.start();
    
    logger.info('Deadline check job scheduled (hourly)');
  }
  
  private scheduleExpiredBadgerCleanup(): void {
    // Clean up expired badgers daily at 2 AM
    const cleanupJob = cron.schedule('0 2 * * *', async () => {
      try {
        await this.cleanupExpiredBadgers();
      } catch (error) {
        logger.error('Expired badger cleanup job failed:', error);
      }
    }, { scheduled: false });
    
    this.jobs.set('expiredCleanup', cleanupJob);
    cleanupJob.start();
    
    logger.info('Expired badger cleanup job scheduled (daily at 2 AM)');
  }
  
  private scheduleMotivationalMessages(): void {
    // Send motivational messages twice daily
    const motivationJob = cron.schedule('0 9,18 * * *', async () => {
      try {
        await this.sendMotivationalMessages();
      } catch (error) {
        logger.error('Motivational message job failed:', error);
      }
    }, { scheduled: false });
    
    this.jobs.set('motivationalMessages', motivationJob);
    motivationJob.start();
    
    logger.info('Motivational message job scheduled (9 AM and 6 PM daily)');
  }
  
  private async sendTaskReminders(): Promise<void> {
    // Find badgers that haven't had activity in the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const badgers = await HoneyBadger.find({
      status: { $in: ['received', 'in-progress'] },
      'task.progress.lastUpdated': { $lt: oneDayAgo },
    }).populate('recipientId');
    
    let remindersSent = 0;
    
    for (const badger of badgers) {
      const recipient = badger.recipientId;
      
      // Check user's reminder preferences
      if (recipient.preferences.notifications.badgerReminders) {
        const frequency = recipient.preferences.badgerPersonality.communicationFrequency;
        
        // Respect user's communication frequency preference
        const lastMessage = badger.chat[badger.chat.length - 1];
        const hoursSinceLastMessage = lastMessage ? 
          (Date.now() - new Date(lastMessage.timestamp).getTime()) / (1000 * 60 * 60) : 24;
        
        let shouldSend = false;
        switch (frequency) {
          case 'high':
            shouldSend = hoursSinceLastMessage >= 4;
            break;
          case 'medium':
            shouldSend = hoursSinceLastMessage >= 12;
            break;
          case 'low':
            shouldSend = hoursSinceLastMessage >= 24;
            break;
        }
        
        if (shouldSend) {
          await notificationService.sendTaskReminderNotification(recipient, badger);
          remindersSent++;
        }
      }
    }
    
    logger.info(`Sent ${remindersSent} task reminders`);
  }
  
  private async checkDeadlines(): Promise<void> {
    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    // Find badgers with deadlines in the next 24 hours
    const badgers = await HoneyBadger.find({
      status: { $in: ['received', 'in-progress'] },
      'task.deadline': {
        $gte: now,
        $lte: twentyFourHoursFromNow,
      },
    }).populate('recipientId');
    
    let deadlineNotificationsSent = 0;
    
    for (const badger of badgers) {
      const recipient = badger.recipientId;
      const deadline = new Date(badger.task.deadline);
      const hoursUntilDeadline = Math.ceil(
        (deadline.getTime() - now.getTime()) / (1000 * 60 * 60)
      );
      
      await notificationService.sendDeadlineNotification(
        recipient,
        badger,
        hoursUntilDeadline
      );
      
      deadlineNotificationsSent++;
    }
    
    // Mark expired badgers
    const expiredBadgers = await HoneyBadger.updateMany(
      {
        status: { $in: ['received', 'in-progress'] },
        'task.deadline': { $lt: now },
      },
      {
        status: 'expired',
      }
    );
    
    logger.info(`Sent ${deadlineNotificationsSent} deadline notifications`);
    logger.info(`Marked ${expiredBadgers.modifiedCount} badgers as expired`);
  }
  
  private async cleanupExpiredBadgers(): Promise<void> {
    // Mark badgers as expired if they have an expiration date in the past
    const now = new Date();
    
    const result = await HoneyBadger.updateMany(
      {
        status: { $nin: ['completed', 'cancelled', 'expired'] },
        expiresAt: { $lt: now },
      },
      {
        status: 'expired',
      }
    );
    
    logger.info(`Marked ${result.modifiedCount} badgers as expired during cleanup`);
  }
  
  private async sendMotivationalMessages(): Promise<void> {
    // Find active badgers with low progress
    const badgers = await HoneyBadger.find({
      status: { $in: ['received', 'in-progress'] },
      'task.progress.percentage': { $lt: 75 }, // Less than 75% complete
    }).populate('recipientId');
    
    let motivationsSent = 0;
    
    for (const badger of badgers) {
      const recipient = badger.recipientId;
      
      // Only send if user wants motivational messages
      if (recipient.preferences.badgerPersonality.communicationFrequency !== 'low') {
        // Check if we haven't sent a motivation recently
        const lastMotivationalMessage = badger.chat
          .slice()
          .reverse()
          .find(msg => msg.senderId === 'badger' && msg.metadata?.motivation);
        
        const hoursSinceLastMotivation = lastMotivationalMessage ? 
          (Date.now() - new Date(lastMotivationalMessage.timestamp).getTime()) / (1000 * 60 * 60) : 24;
        
        if (hoursSinceLastMotivation >= 12) { // At least 12 hours since last motivation
          // This would trigger the AI to generate and send a motivational message
          // For now, we'll just log it
          logger.info(`Would send motivation to badger ${badger._id}`);
          motivationsSent++;
        }
      }
    }
    
    logger.info(`Sent ${motivationsSent} motivational messages`);
  }
}

export const cronService = new CronService();

// Auto-start cron jobs when the module is imported
if (process.env.NODE_ENV !== 'test') {
  cronService.start();
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    cronService.stop();
  });
  
  process.on('SIGINT', () => {
    cronService.stop();
  });
}