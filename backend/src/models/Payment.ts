import mongoose, { Document, Schema } from 'mongoose';
import { Payment as IPayment, PaymentStatus } from '@/types';

export interface PaymentDocument extends IPayment, Document {}

const paymentSchema = new Schema({
  badgerId: {
    type: Schema.Types.ObjectId,
    ref: 'HoneyBadger',
    required: true,
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
  amount: {
    type: Number,
    required: true,
    min: 0.5, // Minimum $0.50
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true,
  },
  stripePaymentIntentId: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded'],
    default: 'pending',
  },
  processingFee: {
    type: Number,
    required: true,
    min: 0,
  },
  netAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  processedAt: {
    type: Date,
    default: null,
  },
  failureReason: {
    type: String,
    default: null,
  },
  refundReason: {
    type: String,
    default: null,
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

// Indexes
paymentSchema.index({ badgerId: 1 });
paymentSchema.index({ senderId: 1, createdAt: -1 });
paymentSchema.index({ recipientId: 1, status: 1 });
paymentSchema.index({ stripePaymentIntentId: 1 });
paymentSchema.index({ status: 1 });

// Calculate processing fee (e.g., 2.9% + $0.30)
paymentSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('amount')) {
    this.processingFee = Math.round((this.amount * 0.029 + 0.30) * 100) / 100;
    this.netAmount = Math.round((this.amount - this.processingFee) * 100) / 100;
  }
  next();
});

// Method to mark as processed
paymentSchema.methods.markAsProcessed = function(status: PaymentStatus) {
  this.status = status;
  this.processedAt = new Date();
  return this.save();
};

export const Payment = mongoose.model<PaymentDocument>('Payment', paymentSchema);