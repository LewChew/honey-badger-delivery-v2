import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ApiResponse } from '@/types';

// Validation middleware factory
export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response<ApiResponse>, next: NextFunction): void => {
    const { error } = schema.validate(req.body, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      const errors: Record<string, string> = {};
      
      error.details.forEach((detail) => {
        const key = detail.path.join('.');
        errors[key] = detail.message;
      });

      res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors,
      });
      return;
    }

    next();
  };
};

// Common validation schemas
export const schemas = {
  // Auth schemas
  register: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required',
    }),
    username: Joi.string().alphanum().min(3).max(30).required().messages({
      'string.alphanum': 'Username can only contain letters and numbers',
      'string.min': 'Username must be at least 3 characters long',
      'string.max': 'Username must be less than 30 characters',
      'any.required': 'Username is required',
    }),
    password: Joi.string().min(6).required().messages({
      'string.min': 'Password must be at least 6 characters long',
      'any.required': 'Password is required',
    }),
    fullName: Joi.string().min(1).max(100).required().messages({
      'string.min': 'Full name is required',
      'string.max': 'Full name must be less than 100 characters',
      'any.required': 'Full name is required',
    }),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    deviceToken: Joi.string().optional(),
  }),

  // User schemas
  updateProfile: Joi.object({
    fullName: Joi.string().min(1).max(100).optional(),
    phoneNumber: Joi.string().pattern(/^\+[1-9]\d{1,14}$/).optional().allow(null),
    avatar: Joi.string().uri().optional().allow(null),
  }),

  updatePreferences: Joi.object({
    notifications: Joi.object({
      push: Joi.boolean().optional(),
      email: Joi.boolean().optional(),
      sms: Joi.boolean().optional(),
      badgerReminders: Joi.boolean().optional(),
      taskDeadlines: Joi.boolean().optional(),
      rewards: Joi.boolean().optional(),
    }).optional(),
    privacy: Joi.object({
      profileVisibility: Joi.string().valid('public', 'friends', 'private').optional(),
      shareProgress: Joi.boolean().optional(),
      shareRewards: Joi.boolean().optional(),
    }).optional(),
    badgerPersonality: Joi.object({
      motivationStyle: Joi.string().valid('encouraging', 'tough-love', 'playful', 'zen').optional(),
      communicationFrequency: Joi.string().valid('high', 'medium', 'low').optional(),
      reminderTone: Joi.string().valid('gentle', 'persistent', 'casual').optional(),
    }).optional(),
  }),

  // Badger schemas
  createBadger: Joi.object({
    name: Joi.string().min(1).max(50).required(),
    recipientEmail: Joi.string().email().required(),
    task: Joi.object({
      type: Joi.string().valid('fitness', 'photo', 'video', 'location', 'habit', 'custom').required(),
      title: Joi.string().min(1).max(100).required(),
      description: Joi.string().min(1).max(500).required(),
      requirements: Joi.array().items(
        Joi.object({
          type: Joi.string().valid('step-count', 'exercise-minutes', 'distance', 'calories', 'photo', 'video', 'text').required(),
          target: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
          unit: Joi.string().optional(),
          description: Joi.string().required(),
        })
      ).min(1).required(),
      verificationMethod: Joi.string().valid('automatic', 'photo', 'video', 'manual', 'location', 'none').required(),
      deadline: Joi.date().greater('now').optional(),
    }).required(),
    reward: Joi.object({
      type: Joi.string().valid('money', 'gift-card', 'digital-content', 'experience', 'message', 'photo', 'video').required(),
      title: Joi.string().min(1).max(100).required(),
      description: Joi.string().max(500).optional(),
      value: Joi.alternatives().try(Joi.number().positive(), Joi.string().min(1)).required(),
      currency: Joi.string().length(3).uppercase().optional(),
      mediaUrl: Joi.string().uri().optional(),
    }).required(),
    personality: Joi.object({
      motivationStyle: Joi.string().valid('encouraging', 'tough-love', 'playful', 'zen').optional(),
      communicationFrequency: Joi.string().valid('high', 'medium', 'low').optional(),
      reminderTone: Joi.string().valid('gentle', 'persistent', 'casual').optional(),
    }).optional(),
    expiresAt: Joi.date().greater('now').optional(),
  }),

  // Task schemas
  submitTask: Joi.object({
    submissions: Joi.array().items(
      Joi.object({
        type: Joi.string().valid('photo', 'video', 'text', 'data').required(),
        content: Joi.string().required(),
        metadata: Joi.object().optional(),
      })
    ).min(1).required(),
  }),

  // Chat schemas
  sendMessage: Joi.object({
    content: Joi.string().min(1).max(2000).required(),
    type: Joi.string().valid('text', 'image', 'audio').optional().default('text'),
  }),

  // Payment schemas
  createPayment: Joi.object({
    amount: Joi.number().positive().min(0.5).required(),
    currency: Joi.string().length(3).uppercase().optional().default('USD'),
  }),
};