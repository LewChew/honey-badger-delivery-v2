import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types';

interface ErrorWithStatus extends Error {
  status?: number;
  statusCode?: number;
  errors?: Record<string, string>;
}

export const errorHandler = (
  error: ErrorWithStatus,
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): void => {
  // Log the error
  logger.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Default error values
  let status = error.status || error.statusCode || 500;
  let message = error.message || 'Internal Server Error';
  let errors: Record<string, string> | undefined;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    status = 400;
    message = 'Validation Error';
    // Handle Mongoose validation errors
    if (error.errors) {
      errors = {};
      Object.keys(error.errors).forEach(key => {
        if (error.errors && error.errors[key]) {
          errors![key] = error.errors[key].message || error.errors[key];
        }
      });
    }
  } else if (error.name === 'MongoServerError') {
    status = 400;
    // Handle duplicate key errors
    if (error.message.includes('duplicate key')) {
      message = 'Duplicate entry found';
      if (error.message.includes('email')) {
        errors = { email: 'Email already exists' };
      } else if (error.message.includes('username')) {
        errors = { username: 'Username already exists' };
      }
    }
  } else if (error.name === 'CastError') {
    status = 400;
    message = 'Invalid ID format';
  } else if (error.name === 'JsonWebTokenError') {
    status = 401;
    message = 'Invalid token';
  } else if (error.name === 'TokenExpiredError') {
    status = 401;
    message = 'Token expired';
  } else if (error.name === 'MulterError') {
    status = 400;
    if (error.message.includes('File too large')) {
      message = 'File size too large';
    } else if (error.message.includes('Unexpected field')) {
      message = 'Unexpected file field';
    } else {
      message = 'File upload error';
    }
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && status === 500) {
    message = 'Internal Server Error';
  }

  // Send error response
  const response: ApiResponse = {
    success: false,
    error: message,
  };

  if (errors) {
    response.errors = errors;
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    (response as any).stack = error.stack;
  }

  res.status(status).json(response);
};

// Not found handler
export const notFoundHandler = (
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): void => {
  const error = new Error(`Route ${req.originalUrl} not found`) as ErrorWithStatus;
  error.status = 404;
  next(error);
};

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};