import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { Payment } from '@/models/Payment';
import { HoneyBadger } from '@/models/HoneyBadger';
import { User } from '@/models/User';
import { authenticate, userRateLimit } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { ApiResponse } from '@/types';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

interface AuthRequest extends Request {
  user?: any;
}

// Create payment intent for badger reward
router.post('/create-intent',
  authenticate,
  userRateLimit(10, 60), // 10 payment attempts per hour
  validate(schemas.createPayment),
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ clientSecret: string; paymentId: string }>>): Promise<void> => {
    const { amount, currency = 'USD' } = req.body;
    const { badgerId } = req.query;
    const user = req.user;
    
    if (!badgerId) {
      res.status(400).json({
        success: false,
        error: 'Badger ID required',
      });
      return;
    }
    
    // Find badger and verify sender
    const badger = await HoneyBadger.findOne({
      _id: badgerId,
      senderId: user._id,
    }).populate('recipientId');
    
    if (!badger) {
      res.status(404).json({
        success: false,
        error: 'Badger not found or not authorized',
      });
      return;
    }
    
    // Check if badger reward is money type
    if (badger.reward.type !== 'money') {
      res.status(400).json({
        success: false,
        error: 'Badger reward is not money type',
      });
      return;
    }
    
    try {
      // Create Stripe payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        metadata: {
          badgerId: badger._id.toString(),
          senderId: user._id.toString(),
          recipientId: badger.recipientId._id.toString(),
        },
        description: `Honey Badger reward: ${badger.name}`,
      });
      
      // Create payment record
      const payment = new Payment({
        badgerId: badger._id,
        senderId: user._id,
        recipientId: badger.recipientId._id,
        amount,
        currency,
        stripePaymentIntentId: paymentIntent.id,
        status: 'pending',
      });
      
      await payment.save();
      
      logger.info(`Payment intent created: ${paymentIntent.id} for badger ${badger._id}`);
      
      res.json({
        success: true,
        message: 'Payment intent created successfully',
        data: {
          clientSecret: paymentIntent.client_secret!,
          paymentId: payment._id.toString(),
        },
      });
      
    } catch (error) {
      logger.error('Payment intent creation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create payment intent',
      });
    }
  })
);

// Confirm payment
router.post('/confirm/:paymentId',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ payment: any }>>): Promise<void> => {
    const { paymentId } = req.params;
    const user = req.user;
    
    const payment = await Payment.findOne({
      _id: paymentId,
      senderId: user._id,
    });
    
    if (!payment) {
      res.status(404).json({
        success: false,
        error: 'Payment not found',
      });
      return;
    }
    
    try {
      // Retrieve payment intent from Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(
        payment.stripePaymentIntentId
      );
      
      // Update payment status based on Stripe status
      if (paymentIntent.status === 'succeeded') {
        payment.status = 'succeeded';
        payment.processedAt = new Date();
        
        // Update badger reward as redeemed
        const badger = await HoneyBadger.findById(payment.badgerId);
        if (badger) {
          badger.reward.isRedeemed = true;
          badger.reward.redeemedAt = new Date();
          await badger.save();
        }
      } else {
        payment.status = paymentIntent.status as any;
      }
      
      await payment.save();
      
      logger.info(`Payment confirmed: ${payment._id} with status ${payment.status}`);
      
      res.json({
        success: true,
        message: 'Payment status updated',
        data: {
          payment: payment.toJSON(),
        },
      });
      
    } catch (error) {
      logger.error('Payment confirmation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to confirm payment',
      });
    }
  })
);

// Get payment history
router.get('/history',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ payments: any[]; total: number }>>): Promise<void> => {
    const { page = 1, limit = 20, type = 'all' } = req.query;
    const user = req.user;
    
    let query: any = {};
    
    if (type === 'sent') {
      query.senderId = user._id;
    } else if (type === 'received') {
      query.recipientId = user._id;
    } else {
      query.$or = [
        { senderId: user._id },
        { recipientId: user._id },
      ];
    }
    
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    
    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('badgerId', 'name avatar')
        .populate('senderId', 'username fullName avatar')
        .populate('recipientId', 'username fullName avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit as string))
        .lean(),
      Payment.countDocuments(query),
    ]);
    
    res.json({
      success: true,
      data: {
        payments,
        total,
      },
    });
  })
);

// Get specific payment
router.get('/:paymentId',
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response<ApiResponse<{ payment: any }>>): Promise<void> => {
    const { paymentId } = req.params;
    const user = req.user;
    
    const payment = await Payment.findOne({
      _id: paymentId,
      $or: [
        { senderId: user._id },
        { recipientId: user._id },
      ],
    })
    .populate('badgerId', 'name avatar')
    .populate('senderId', 'username fullName avatar')
    .populate('recipientId', 'username fullName avatar');
    
    if (!payment) {
      res.status(404).json({
        success: false,
        error: 'Payment not found',
      });
      return;
    }
    
    res.json({
      success: true,
      data: {
        payment: payment.toJSON(),
      },
    });
  })
);

// Stripe webhook endpoint
router.post('/webhook',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      logger.error('Stripe webhook secret not configured');
      res.status(500).send('Webhook secret not configured');
      return;
    }
    
    let event: Stripe.Event;
    
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (error) {
      logger.error('Webhook signature verification failed:', error);
      res.status(400).send(`Webhook Error: ${error}`);
      return;
    }
    
    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      default:
        logger.info(`Unhandled webhook event type: ${event.type}`);
    }
    
    res.json({ received: true });
  })
);

// Handle successful payment
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  try {
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id,
    });
    
    if (!payment) {
      logger.error(`Payment not found for payment intent: ${paymentIntent.id}`);
      return;
    }
    
    payment.status = 'succeeded';
    payment.processedAt = new Date();
    await payment.save();
    
    // Update badger reward
    const badger = await HoneyBadger.findById(payment.badgerId);
    if (badger && !badger.reward.isRedeemed) {
      badger.reward.isRedeemed = true;
      badger.reward.redeemedAt = new Date();
      await badger.save();
      
      // Send notification to recipient
      const recipient = await User.findById(payment.recipientId);
      if (recipient) {
        // TODO: Send push notification about reward availability
        logger.info(`Reward available for user ${recipient._id} in badger ${badger._id}`);
      }
    }
    
    logger.info(`Payment succeeded: ${payment._id}`);
    
  } catch (error) {
    logger.error('Error handling payment success:', error);
  }
}

// Handle failed payment
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  try {
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id,
    });
    
    if (!payment) {
      logger.error(`Payment not found for payment intent: ${paymentIntent.id}`);
      return;
    }
    
    payment.status = 'failed';
    payment.failureReason = paymentIntent.last_payment_error?.message || 'Payment failed';
    await payment.save();
    
    logger.info(`Payment failed: ${payment._id} - ${payment.failureReason}`);
    
  } catch (error) {
    logger.error('Error handling payment failure:', error);
  }
}

export default router;