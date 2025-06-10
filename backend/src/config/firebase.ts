import admin from 'firebase-admin';
import { logger } from '@/utils/logger';

let firebaseApp: admin.app.App;

export const initializeFirebase = async (): Promise<void> => {
  try {
    if (admin.apps.length === 0) {
      const serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
      };

      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });

      logger.info('Firebase initialized successfully');
    }
  } catch (error) {
    logger.error('Failed to initialize Firebase:', error);
    throw error;
  }
};

export const getFirebaseApp = (): admin.app.App => {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized');
  }
  return firebaseApp;
};

// Push notification service
export const sendPushNotification = async (
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<boolean> => {
  try {
    const message = {
      notification: {
        title,
        body,
      },
      data: data || {},
      token: deviceToken,
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    logger.info('Push notification sent successfully:', response);
    return true;
  } catch (error) {
    logger.error('Failed to send push notification:', error);
    return false;
  }
};

// Send notification to multiple devices
export const sendMulticastNotification = async (
  deviceTokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<{ successCount: number; failureCount: number }> => {
  try {
    const message = {
      notification: {
        title,
        body,
      },
      data: data || {},
      tokens: deviceTokens,
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().sendMulticast(message);
    logger.info(`Push notifications sent: ${response.successCount} success, ${response.failureCount} failures`);
    
    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (error) {
    logger.error('Failed to send multicast notification:', error);
    return { successCount: 0, failureCount: deviceTokens.length };
  }
};