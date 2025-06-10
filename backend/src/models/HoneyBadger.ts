import mongoose, { Document, Schema } from 'mongoose';
import { HoneyBadger as IHoneyBadger, Task, Reward, ChatMessage, BadgerStatus } from '@/types';

export interface HoneyBadgerDocument extends IHoneyBadger, Document {}

const taskRequirementSchema = new Schema({
  type: {
    type: String,
    enum: ['step-count', 'exercise-minutes', 'distance', 'calories', 'photo', 'video', 'text'],
    required: true,
  },
  target: {
    type: Schema.Types.Mixed, // Can be number or string
    required: true,
  },
  unit: {
    type: String,
    default: null,
  },
  description: {
    type: String,
    required: true,
  },
}, { _id: false });

const taskSubmissionSchema = new Schema({
  type: {
    type: String,
    enum: ['photo', 'video', 'text', 'data'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, { _id: false });

const taskProgressSchema = new Schema({
  completed: {
    type: Boolean,
    default: false,
  },
  percentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  submissions: [taskSubmissionSchema],
  verificationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'needs-review'],
    default: 'pending',
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const taskSchema = new Schema({
  type: {
    type: String,
    enum: ['fitness', 'photo', 'video', 'location', 'habit', 'custom'],
    required: true,
  },
  title: {
    type: String,
    required: true,
    maxlength: 100,
  },
  description: {
    type: String,
    required: true,
    maxlength: 500,
  },
  requirements: [taskRequirementSchema],
  verificationMethod: {
    type: String,
    enum: ['automatic', 'photo', 'video', 'manual', 'location', 'none'],
    required: true,
  },
  deadline: {
    type: Date,
    default: null,
  },
  progress: {
    type: taskProgressSchema,
    default: () => ({}),
  },
}, { _id: false });

const rewardSchema = new Schema({
  type: {
    type: String,
    enum: ['money', 'gift-card', 'digital-content', 'experience', 'message', 'photo', 'video'],
    required: true,
  },
  title: {
    type: String,
    required: true,
    maxlength: 100,
  },
  description: {
    type: String,
    maxlength: 500,
  },
  value: {
    type: Schema.Types.Mixed, // Can be number or string
    required: true,
  },
  currency: {
    type: String,
    default: 'USD',
  },
  mediaUrl: {
    type: String,
    default: null,
  },
  isRedeemed: {
    type: Boolean,
    default: false,
  },
  redeemedAt: {
    type: Date,
    default: null,
  },
}, { _id: false });

const chatMessageSchema = new Schema({
  senderId: {
    type: String,
    required: true, // 'badger' for AI messages, userId for user messages
  },
  content: {
    type: String,
    required: true,
    maxlength: 2000,
  },
  type: {
    type: String,
    enum: ['text', 'image', 'audio', 'system'],
    default: 'text',
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  metadata: {
    emotion: { type: String },
    motivation: { type: String },
    taskReference: { type: String },
  },
});

const badgerPersonalitySchema = new Schema({
  motivationStyle: {
    type: String,
    enum: ['encouraging', 'tough-love', 'playful', 'zen'],
    default: 'encouraging',
  },
  communicationFrequency: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium',
  },
  reminderTone: {
    type: String,
    enum: ['gentle', 'persistent', 'casual'],
    default: 'gentle',
  },
}, { _id: false });

const honeyBadgerSchema = new Schema({
  name: {
    type: String,
    required: true,
    maxlength: 50,
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  recipientId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['created', 'sent', 'received', 'in-progress', 'awaiting-verification', 'completed', 'expired', 'cancelled'],
    default: 'created',
  },
  personality: {
    type: badgerPersonalitySchema,
    default: () => ({}),
  },
  avatar: {
    type: String,
    default: 'default-badger.png',
  },
  task: {
    type: taskSchema,
    required: true,
  },
  reward: {
    type: rewardSchema,
    required: true,
  },
  chat: [chatMessageSchema],
  expiresAt: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Indexes for performance
honeyBadgerSchema.index({ senderId: 1, createdAt: -1 });
honeyBadgerSchema.index({ recipientId: 1, status: 1 });
honeyBadgerSchema.index({ status: 1 });
honeyBadgerSchema.index({ expiresAt: 1 });

// Virtual for chat count
honeyBadgerSchema.virtual('chatCount').get(function() {
  return this.chat.length;
});

// Method to add chat message
honeyBadgerSchema.methods.addChatMessage = function(message: Partial<ChatMessage>) {
  this.chat.push({
    ...message,
    timestamp: new Date(),
  });
  return this.save();
};

// Method to update task progress
honeyBadgerSchema.methods.updateTaskProgress = function(progressData: Partial<any>) {
  Object.assign(this.task.progress, progressData);
  this.task.progress.lastUpdated = new Date();
  return this.save();
};

// Method to complete badger
honeyBadgerSchema.methods.complete = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  this.task.progress.completed = true;
  this.task.progress.percentage = 100;
  return this.save();
};

export const HoneyBadger = mongoose.model<HoneyBadgerDocument>('HoneyBadger', honeyBadgerSchema);