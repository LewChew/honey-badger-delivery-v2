import { sendPushNotification, sendMulticastNotification } from '@/config/firebase';
import { User } from '@/models/User';
import { logger } from '@/utils/logger';

class NotificationService {
  async sendBadgerNotification(
    recipient: any,
    title: string,
    message: string,
    data: Record<string, string> = {}
  ): Promise<boolean> {
    try {
      // Check if user wants notifications
      if (!recipient.preferences.notifications.push) {
        return false;
      }
      
      // Send to all user's devices
      if (recipient.deviceTokens.length === 0) {
        logger.info(`No device tokens for user ${recipient._id}`);
        return false;
      }
      
      const result = await sendMulticastNotification(
        recipient.deviceTokens,
        title,
        message,
        {
          type: 'badger',
          ...data,
        }
      );
      
      // Remove invalid tokens
      if (result.failureCount > 0) {
        // TODO: Implement logic to remove invalid tokens
        logger.warn(`${result.failureCount} push notifications failed for user ${recipient._id}`);
      }
      
      logger.info(`Badger notification sent to user ${recipient._id}`);
      return result.successCount > 0;
      
    } catch (error) {
      logger.error('Failed to send badger notification:', error);
      return false;
    }
  }
  
  async sendTaskCompletionNotification(
    sender: any,
    badger: any,
    recipientName: string
  ): Promise<boolean> {
    try {
      if (!sender.preferences.notifications.push) {
        return false;
      }
      
      const title = 'Task Completed! 🎉';
      const message = `${recipientName} completed the task for ${badger.name}!`;
      
      return await this.sendBadgerNotification(
        sender,
        title,
        message,
        {
          badgerId: badger._id.toString(),
          type: 'task_completed',
        }
      );
      
    } catch (error) {
      logger.error('Failed to send task completion notification:', error);
      return false;
    }
  }
  
  async sendTaskReminderNotification(
    recipient: any,
    badger: any
  ): Promise<boolean> {
    try {
      if (!recipient.preferences.notifications.badgerReminders) {
        return false;
      }
      
      const title = `${badger.name} is waiting for you! 🍯`;
      const message = this.generateReminderMessage(badger);
      
      return await this.sendBadgerNotification(
        recipient,
        title,
        message,
        {
          badgerId: badger._id.toString(),
          type: 'task_reminder',
        }
      );
      
    } catch (error) {
      logger.error('Failed to send task reminder notification:', error);
      return false;
    }
  }
  
  async sendDeadlineNotification(
    recipient: any,
    badger: any,
    hoursUntilDeadline: number
  ): Promise<boolean> {
    try {
      if (!recipient.preferences.notifications.taskDeadlines) {
        return false;
      }
      
      const title = 'Task Deadline Approaching ⏰';
      const message = `Your task "${badger.task.title}" is due in ${hoursUntilDeadline} hours!`;
      
      return await this.sendBadgerNotification(
        recipient,
        title,
        message,
        {
          badgerId: badger._id.toString(),
          type: 'deadline_reminder',
          hoursLeft: hoursUntilDeadline.toString(),
        }
      );
      
    } catch (error) {
      logger.error('Failed to send deadline notification:', error);
      return false;
    }
  }
  
  async sendRewardNotification(
    recipient: any,
    badger: any
  ): Promise<boolean> {
    try {
      if (!recipient.preferences.notifications.rewards) {
        return false;
      }
      
      const title = 'Reward Ready! 🎁';
      const message = `Your reward "${badger.reward.title}" is ready to claim!`;
      
      return await this.sendBadgerNotification(
        recipient,
        title,
        message,
        {
          badgerId: badger._id.toString(),
          type: 'reward_available',
        }
      );
      
    } catch (error) {
      logger.error('Failed to send reward notification:', error);
      return false;
    }
  }
  
  async sendChatNotification(
    recipient: any,
    badger: any,
    messagePreview: string
  ): Promise<boolean> {
    try {
      if (!recipient.preferences.notifications.push) {
        return false;
      }
      
      const title = `Message from ${badger.name} 🍯`;
      const message = messagePreview.length > 100 ? 
        messagePreview.substring(0, 97) + '...' : 
        messagePreview;
      
      return await this.sendBadgerNotification(
        recipient,
        title,
        message,
        {
          badgerId: badger._id.toString(),
          type: 'chat_message',
        }
      );
      
    } catch (error) {
      logger.error('Failed to send chat notification:', error);
      return false;
    }
  }
  
  private generateReminderMessage(badger: any): string {
    const { personality, task } = badger;
    const progress = task.progress.percentage;
    
    const messages = {
      encouraging: [
        "You're doing great! Let's keep the momentum going!",
        "Every step counts. Ready for the next one?",
        "I believe in you! Let's tackle this together.",
      ],
      'tough-love': [
        "No excuses! Time to get back to work.",
        "Champions don't quit. Let's see what you're made of!",
        "The reward is waiting. Are you?",
      ],
      playful: [
        "Adventure time! Let's make progress fun!",
        "Your honey badger friend misses you! 🍯",
        "Ready to turn this task into a game?",
      ],
      zen: [
        "Mindful progress is lasting progress. When you're ready.",
        "Small steps lead to great journeys. Shall we continue?",
        "Inner strength grows with every effort. Time to nurture it.",
      ],
    };
    
    const styleMessages = messages[personality.motivationStyle as keyof typeof messages] || messages.encouraging;
    
    if (progress === 0) {
      return "Ready to start your journey? I'm here to help!";
    } else if (progress < 50) {
      return styleMessages[0];
    } else {
      return styleMessages[1];
    }
  }
  
  // Batch notification for multiple users
  async sendBulkNotifications(
    notifications: Array<{
      recipient: any;
      title: string;
      message: string;
      data?: Record<string, string>;
    }>
  ): Promise<{ successCount: number; failureCount: number }> {
    let successCount = 0;
    let failureCount = 0;
    
    const promises = notifications.map(async (notification) => {
      try {
        const success = await this.sendBadgerNotification(
          notification.recipient,
          notification.title,
          notification.message,
          notification.data
        );
        
        if (success) {
          successCount++;
        } else {
          failureCount++;
        }
      } catch (error) {
        failureCount++;
        logger.error('Bulk notification failed:', error);
      }
    });
    
    await Promise.all(promises);
    
    return { successCount, failureCount };
  }
}

export const notificationService = new NotificationService();