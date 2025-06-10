import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import { User as IUser, UserPreferences, FitnessIntegration } from '@/types';

export interface UserDocument extends IUser, Document {
  password: string;
  deviceTokens: string[];
  emailVerified: boolean;
  phoneVerified: boolean;
  lastActive: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  toJSON(): any;
}

const notificationSettingsSchema = new Schema({
  push: { type: Boolean, default: true },
  email: { type: Boolean, default: true },
  sms: { type: Boolean, default: false },
  badgerReminders: { type: Boolean, default: true },
  taskDeadlines: { type: Boolean, default: true },
  rewards: { type: Boolean, default: true },
}, { _id: false });

const privacySettingsSchema = new Schema({
  profileVisibility: { 
    type: String, 
    enum: ['public', 'friends', 'private'], 
    default: 'friends' 
  },
  shareProgress: { type: Boolean, default: true },
  shareRewards: { type: Boolean, default: false },
}, { _id: false });

const badgerPersonalitySchema = new Schema({
  motivationStyle: { 
    type: String, 
    enum: ['encouraging', 'tough-love', 'playful', 'zen'], 
    default: 'encouraging' 
  },
  communicationFrequency: { 
    type: String, 
    enum: ['high', 'medium', 'low'], 
    default: 'medium' 
  },
  reminderTone: { 
    type: String, 
    enum: ['gentle', 'persistent', 'casual'], 
    default: 'gentle' 
  },
}, { _id: false });

const userPreferencesSchema = new Schema({
  notifications: { type: notificationSettingsSchema, default: () => ({}) },
  privacy: { type: privacySettingsSchema, default: () => ({}) },
  badgerPersonality: { type: badgerPersonalitySchema, default: () => ({}) },
}, { _id: false });

const fitnessIntegrationSchema = new Schema({
  platform: { 
    type: String, 
    enum: ['apple-health', 'strava', 'fitbit', 'garmin'], 
    required: true 
  },
  accessToken: { type: String, required: true },
  refreshToken: { type: String },
  isActive: { type: Boolean, default: true },
  lastSync: { type: Date, default: Date.now },
}, { _id: false });

const userSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'],
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false, // Don't include password in queries by default
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  avatar: {
    type: String,
    default: null,
  },
  phoneNumber: {
    type: String,
    default: null,
    match: [/^\+[1-9]\d{1,14}$/, 'Please enter a valid phone number with country code'],
  },
  deviceTokens: [{
    type: String,
  }],
  emailVerified: {
    type: Boolean,
    default: false,
  },
  phoneVerified: {
    type: Boolean,
    default: false,
  },
  preferences: {
    type: userPreferencesSchema,
    default: () => ({}),
  },
  fitnessIntegrations: [fitnessIntegrationSchema],
  lastActive: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.__v;
      return ret;
    },
  },
});

// Index for performance
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ lastActive: 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error as any);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

// Update last active on login
userSchema.methods.updateLastActive = function() {
  this.lastActive = new Date();
  return this.save({ validateBeforeSave: false });
};

export const User = mongoose.model<UserDocument>('User', userSchema);