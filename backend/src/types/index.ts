export interface User {
  _id: string;
  email: string;
  username: string;
  fullName: string;
  avatar?: string;
  phoneNumber?: string;
  preferences: UserPreferences;
  fitnessIntegrations: FitnessIntegration[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  badgerPersonality: BadgerPersonality;
}

export interface NotificationSettings {
  push: boolean;
  email: boolean;
  sms: boolean;
  badgerReminders: boolean;
  taskDeadlines: boolean;
  rewards: boolean;
}

export interface PrivacySettings {
  profileVisibility: 'public' | 'friends' | 'private';
  shareProgress: boolean;
  shareRewards: boolean;
}

export interface BadgerPersonality {
  motivationStyle: 'encouraging' | 'tough-love' | 'playful' | 'zen';
  communicationFrequency: 'high' | 'medium' | 'low';
  reminderTone: 'gentle' | 'persistent' | 'casual';
}

export interface FitnessIntegration {
  platform: 'apple-health' | 'strava' | 'fitbit' | 'garmin';
  accessToken: string;
  refreshToken?: string;
  isActive: boolean;
  lastSync: Date;
}

export interface HoneyBadger {
  _id: string;
  name: string;
  senderId: string;
  recipientId: string;
  status: BadgerStatus;
  personality: BadgerPersonality;
  avatar: string;
  task: Task;
  reward: Reward;
  chat: ChatMessage[];
  createdAt: Date;
  expiresAt?: Date;
  completedAt?: Date;
}

export type BadgerStatus = 
  | 'created'
  | 'sent'
  | 'received'
  | 'in-progress'
  | 'awaiting-verification'
  | 'completed'
  | 'expired'
  | 'cancelled';

export interface Task {
  type: TaskType;
  title: string;
  description: string;
  requirements: TaskRequirement[];
  verificationMethod: VerificationMethod;
  deadline?: Date;
  progress: TaskProgress;
}

export type TaskType = 
  | 'fitness'
  | 'photo'
  | 'video'
  | 'location'
  | 'habit'
  | 'custom';

export interface TaskRequirement {
  type: 'step-count' | 'exercise-minutes' | 'distance' | 'calories' | 'photo' | 'video' | 'text';
  target: number | string;
  unit?: string;
  description: string;
}

export type VerificationMethod = 
  | 'automatic'  // Fitness data
  | 'photo'
  | 'video'
  | 'manual'     // Self-reported
  | 'location'   // GPS check
  | 'none';      // Trust-based

export interface TaskProgress {
  completed: boolean;
  percentage: number;
  submissions: TaskSubmission[];
  verificationStatus: 'pending' | 'approved' | 'rejected' | 'needs-review';
  lastUpdated: Date;
}

export interface TaskSubmission {
  type: 'photo' | 'video' | 'text' | 'data';
  content: string; // URL for media, text for descriptions, JSON for data
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface Reward {
  type: RewardType;
  title: string;
  description?: string;
  value: number | string;
  currency?: string;
  mediaUrl?: string;
  isRedeemed: boolean;
  redeemedAt?: Date;
}

export type RewardType = 
  | 'money'
  | 'gift-card'
  | 'digital-content'
  | 'experience'
  | 'message'
  | 'photo'
  | 'video';

export interface ChatMessage {
  _id: string;
  senderId: string; // 'badger' for AI messages
  content: string;
  type: 'text' | 'image' | 'audio' | 'system';
  timestamp: Date;
  metadata?: {
    emotion?: string;
    motivation?: string;
    taskReference?: string;
  };
}

export interface Payment {
  _id: string;
  badgerId: string;
  senderId: string;
  recipientId: string;
  amount: number;
  currency: string;
  stripePaymentIntentId: string;
  status: PaymentStatus;
  processingFee: number;
  netAmount: number;
  createdAt: Date;
  processedAt?: Date;
}

export type PaymentStatus = 
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  errors?: Record<string, string>;
}

export interface SocketEvents {
  // Client to server
  'join-badger': (badgerId: string) => void;
  'leave-badger': (badgerId: string) => void;
  'send-message': (data: { badgerId: string; content: string; type: string }) => void;
  'task-update': (data: { badgerId: string; progress: any }) => void;
  
  // Server to client
  'message-received': (message: ChatMessage) => void;
  'badger-update': (badger: Partial<HoneyBadger>) => void;
  'task-progress': (progress: TaskProgress) => void;
  'notification': (notification: Notification) => void;
}

export interface Notification {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  badgerId?: string;
  actionUrl?: string;
  timestamp: Date;
}