import OpenAI from 'openai';
import { HoneyBadger } from '@/models/HoneyBadger';
import { logger } from '@/utils/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class AIChatService {
  private getPersonalityPrompt(personality: any): string {
    const { motivationStyle, communicationFrequency, reminderTone } = personality;
    
    let prompt = "You are a helpful, encouraging honey badger companion. ";
    
    switch (motivationStyle) {
      case 'tough-love':
        prompt += "You're direct and no-nonsense, pushing people to exceed their limits. ";
        break;
      case 'playful':
        prompt += "You're fun and lighthearted, using humor and games to motivate. ";
        break;
      case 'zen':
        prompt += "You're calm and mindful, focusing on inner peace and steady progress. ";
        break;
      default: // encouraging
        prompt += "You're supportive and positive, celebrating every small victory. ";
    }
    
    switch (reminderTone) {
      case 'persistent':
        prompt += "You're persistent but not annoying, gently nudging when needed. ";
        break;
      case 'casual':
        prompt += "You're laid-back and casual in your communication style. ";
        break;
      default: // gentle
        prompt += "You use a gentle, caring tone in all interactions. ";
    }
    
    return prompt;
  }
  
  private getTaskContext(badger: any): string {
    const { task, reward } = badger;
    return `Task: ${task.title} - ${task.description}. Reward: ${reward.title} (${reward.value}${reward.currency ? ' ' + reward.currency : ''}). Progress: ${task.progress.percentage}% complete.`;
  }
  
  async generateWelcomeMessage(
    badger: any,
    senderName: string,
    recipientName: string
  ): Promise<string> {
    try {
      const personalityPrompt = this.getPersonalityPrompt(badger.personality);
      const taskContext = this.getTaskContext(badger);
      
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `${personalityPrompt}You're introducing yourself as ${badger.name}, a honey badger sent by ${senderName} to help ${recipientName}. Keep it under 150 words, friendly, and mention the task briefly.`,
          },
          {
            role: 'user',
            content: `Generate a welcome message. ${taskContext}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.8,
      });
      
      return response.choices[0]?.message?.content || 
        `Hi ${recipientName}! I'm ${badger.name}, your new honey badger companion sent by ${senderName}. I'm here to help you with your task: ${badger.task.title}. Let's make this fun and rewarding! 🍯🦡`;
      
    } catch (error) {
      logger.error('Error generating welcome message:', error);
      return `Hi ${recipientName}! I'm ${badger.name}, your honey badger companion. ${senderName} sent me to help you achieve your goal. Let's get started! 🍯🦡`;
    }
  }
  
  async generateChatResponse(
    badger: any,
    userMessage: string,
    userName: string
  ): Promise<{ content: string; metadata: any }> {
    try {
      const personalityPrompt = this.getPersonalityPrompt(badger.personality);
      const taskContext = this.getTaskContext(badger);
      const recentMessages = badger.chat.slice(-5).map((msg: any) => 
        `${msg.senderId === 'badger' ? badger.name : userName}: ${msg.content}`
      ).join('\n');
      
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `${personalityPrompt}You're ${badger.name}, responding to ${userName}. ${taskContext} Recent conversation: ${recentMessages}. Keep responses under 200 words, personalized, and motivating.`,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        max_tokens: 250,
        temperature: 0.7,
      });
      
      const content = response.choices[0]?.message?.content || 
        "Thanks for sharing! I'm here to support you every step of the way. How can I help you with your task today? 🍯";
      
      // Determine emotion and motivation type
      const emotion = this.analyzeEmotion(userMessage, badger.task.progress.percentage);
      const motivation = this.getMotivationType(badger.task.progress.percentage);
      
      return {
        content,
        metadata: {
          emotion,
          motivation,
          taskReference: badger._id.toString(),
        },
      };
      
    } catch (error) {
      logger.error('Error generating chat response:', error);
      return {
        content: "I'm here to help! Tell me more about how you're doing with your task. 🍯🦡",
        metadata: {
          emotion: 'supportive',
          motivation: 'general',
        },
      };
    }
  }
  
  async generateProgressResponse(
    badger: any,
    submissions: any[],
    progress: any
  ): Promise<string> {
    try {
      const personalityPrompt = this.getPersonalityPrompt(badger.personality);
      const taskContext = this.getTaskContext(badger);
      
      const submissionSummary = submissions.map(sub => 
        `${sub.type}: ${sub.type === 'photo' || sub.type === 'video' ? 'file uploaded' : sub.content}`
      ).join(', ');
      
      const progressText = progress.completed ? 
        "Task completed!" : 
        `Progress: ${progress.percentage}%`;
      
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `${personalityPrompt}Respond to task progress submission. ${taskContext} New submissions: ${submissionSummary}. ${progressText}. Be encouraging and specific about their progress.`,
          },
          {
            role: 'user',
            content: `I just submitted progress: ${submissionSummary}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.8,
      });
      
      return response.choices[0]?.message?.content || 
        (progress.completed ? 
          "Amazing work! You've completed the task! 🎉 Your reward is ready!" :
          `Great progress! You're ${progress.percentage}% of the way there. Keep it up! 💪`);
      
    } catch (error) {
      logger.error('Error generating progress response:', error);
      return progress.completed ? 
        "Congratulations! Task completed! 🎉" :
        `Nice work! ${progress.percentage}% complete. You're doing great! 💪`;
    }
  }
  
  async generateMotivationalQuote(
    badger: any,
    userName: string
  ): Promise<{ quote: string; mood: string }> {
    try {
      const personalityPrompt = this.getPersonalityPrompt(badger.personality);
      const taskContext = this.getTaskContext(badger);
      
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `${personalityPrompt}Generate a short motivational quote (under 100 words) for ${userName}. ${taskContext}. Make it personal and inspiring.`,
          },
          {
            role: 'user',
            content: 'Give me some motivation to keep going.',
          },
        ],
        max_tokens: 150,
        temperature: 0.9,
      });
      
      const quote = response.choices[0]?.message?.content || 
        "Honey badgers don't give up, and neither do you! Every step forward is a victory. 🍯💪";
      
      const mood = this.getMoodFromProgress(badger.task.progress.percentage);
      
      return { quote, mood };
      
    } catch (error) {
      logger.error('Error generating motivational quote:', error);
      return {
        quote: "You've got this! Honey badgers believe in persistence, and so do I! 🍯🦡",
        mood: 'encouraging',
      };
    }
  }
  
  private analyzeEmotion(message: string, progress: number): string {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('stuck') || lowerMessage.includes('difficult') || 
        lowerMessage.includes('hard') || lowerMessage.includes('frustrated')) {
      return 'supportive';
    }
    
    if (lowerMessage.includes('excited') || lowerMessage.includes('great') || 
        lowerMessage.includes('awesome') || lowerMessage.includes('love')) {
      return 'celebratory';
    }
    
    if (progress > 75) {
      return 'encouraging';
    }
    
    return 'friendly';
  }
  
  private getMotivationType(progress: number): string {
    if (progress === 0) return 'getting-started';
    if (progress < 25) return 'early-progress';
    if (progress < 50) return 'momentum-building';
    if (progress < 75) return 'halfway-motivation';
    if (progress < 100) return 'final-push';
    return 'completion';
  }
  
  private getMoodFromProgress(progress: number): string {
    if (progress === 0) return 'motivating';
    if (progress < 50) return 'encouraging';
    if (progress < 100) return 'energetic';
    return 'celebratory';
  }
}

export const aiChatService = new AIChatService();