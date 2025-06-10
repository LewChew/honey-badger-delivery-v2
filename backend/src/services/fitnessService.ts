import { User } from '@/models/User';
import { logger } from '@/utils/logger';

interface FitnessData {
  steps: number;
  exerciseMinutes: number;
  distance: number; // in kilometers
  calories: number;
  heartRate?: number;
  lastSync: Date;
}

class FitnessService {
  async syncUserData(user: any): Promise<FitnessData> {
    const fitnessData: FitnessData = {
      steps: 0,
      exerciseMinutes: 0,
      distance: 0,
      calories: 0,
      lastSync: new Date(),
    };
    
    // Sync data from all connected platforms
    for (const integration of user.fitnessIntegrations) {
      if (!integration.isActive) continue;
      
      try {
        const platformData = await this.syncFromPlatform(
          integration.platform,
          integration.accessToken,
          integration.refreshToken
        );
        
        // Aggregate data (take maximum values to avoid duplicates)
        fitnessData.steps = Math.max(fitnessData.steps, platformData.steps);
        fitnessData.exerciseMinutes = Math.max(fitnessData.exerciseMinutes, platformData.exerciseMinutes);
        fitnessData.distance = Math.max(fitnessData.distance, platformData.distance);
        fitnessData.calories = Math.max(fitnessData.calories, platformData.calories);
        
        if (platformData.heartRate) {
          fitnessData.heartRate = platformData.heartRate;
        }
        
        // Update last sync time
        integration.lastSync = new Date();
        
      } catch (error) {
        logger.error(`Failed to sync from ${integration.platform}:`, error);
        // Don't disable integration on single failure
      }
    }
    
    // Save updated integration sync times
    await user.save();
    
    return fitnessData;
  }
  
  private async syncFromPlatform(
    platform: string,
    accessToken: string,
    refreshToken?: string
  ): Promise<FitnessData> {
    switch (platform) {
      case 'apple-health':
        return this.syncFromAppleHealth(accessToken);
      case 'strava':
        return this.syncFromStrava(accessToken, refreshToken);
      case 'fitbit':
        return this.syncFromFitbit(accessToken, refreshToken);
      case 'garmin':
        return this.syncFromGarmin(accessToken);
      default:
        throw new Error(`Unsupported fitness platform: ${platform}`);
    }
  }
  
  private async syncFromAppleHealth(accessToken: string): Promise<FitnessData> {
    // Apple Health integration would be handled on the iOS app side
    // This is a placeholder for the backend to receive the data
    
    // In a real implementation, you might:
    // 1. Receive data from iOS app via API
    // 2. Use Apple's HealthKit data sharing (requires iOS app)
    // 3. Integrate with Apple Health Connect (if available)
    
    return {
      steps: 0,
      exerciseMinutes: 0,
      distance: 0,
      calories: 0,
      lastSync: new Date(),
    };
  }
  
  private async syncFromStrava(
    accessToken: string,
    refreshToken?: string
  ): Promise<FitnessData> {
    try {
      // Get today's activities from Strava
      const today = new Date().toISOString().split('T')[0];
      const response = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${Date.parse(today) / 1000}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );
      
      if (!response.ok) {
        if (response.status === 401 && refreshToken) {
          // Token expired, refresh it
          const newAccessToken = await this.refreshStravaToken(refreshToken);
          return this.syncFromStrava(newAccessToken);
        }
        throw new Error(`Strava API error: ${response.status}`);
      }
      
      const activities = await response.json();
      
      let totalDistance = 0;
      let totalMovingTime = 0;
      let totalCalories = 0;
      
      for (const activity of activities) {
        totalDistance += activity.distance / 1000; // Convert meters to kilometers
        totalMovingTime += activity.moving_time / 60; // Convert seconds to minutes
        if (activity.kilojoules) {
          totalCalories += activity.kilojoules * 0.239; // Convert kJ to calories
        }
      }
      
      return {
        steps: 0, // Strava doesn't provide step count
        exerciseMinutes: totalMovingTime,
        distance: totalDistance,
        calories: totalCalories,
        lastSync: new Date(),
      };
      
    } catch (error) {
      logger.error('Strava sync failed:', error);
      throw error;
    }
  }
  
  private async syncFromFitbit(
    accessToken: string,
    refreshToken?: string
  ): Promise<FitnessData> {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get multiple data types from Fitbit
      const endpoints = [
        `activities/steps/date/${today}/1d.json`,
        `activities/distance/date/${today}/1d.json`,
        `activities/calories/date/${today}/1d.json`,
        `activities/minutesVeryActive/date/${today}/1d.json`,
      ];
      
      const promises = endpoints.map(endpoint =>
        fetch(`https://api.fitbit.com/1/user/-/${endpoint}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        })
      );
      
      const responses = await Promise.all(promises);
      
      // Check for authentication errors
      for (const response of responses) {
        if (response.status === 401 && refreshToken) {
          const newAccessToken = await this.refreshFitbitToken(refreshToken);
          return this.syncFromFitbit(newAccessToken);
        }
        if (!response.ok) {
          throw new Error(`Fitbit API error: ${response.status}`);
        }
      }
      
      const [stepsData, distanceData, caloriesData, activeMinutesData] = 
        await Promise.all(responses.map(r => r.json()));
      
      return {
        steps: parseInt(stepsData['activities-steps'][0]?.value || '0'),
        exerciseMinutes: parseInt(activeMinutesData['activities-minutesVeryActive'][0]?.value || '0'),
        distance: parseFloat(distanceData['activities-distance'][0]?.value || '0'),
        calories: parseInt(caloriesData['activities-calories'][0]?.value || '0'),
        lastSync: new Date(),
      };
      
    } catch (error) {
      logger.error('Fitbit sync failed:', error);
      throw error;
    }
  }
  
  private async syncFromGarmin(accessToken: string): Promise<FitnessData> {
    // Garmin Connect IQ would require specific SDK integration
    // This is a placeholder implementation
    
    try {
      // Garmin's API structure would depend on their specific endpoints
      // This is a simplified example
      
      return {
        steps: 0,
        exerciseMinutes: 0,
        distance: 0,
        calories: 0,
        lastSync: new Date(),
      };
      
    } catch (error) {
      logger.error('Garmin sync failed:', error);
      throw error;
    }
  }
  
  private async refreshStravaToken(refreshToken: string): Promise<string> {
    try {
      const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.STRAVA_CLIENT_ID,
          client_secret: process.env.STRAVA_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to refresh Strava token');
      }
      
      const data = await response.json();
      return data.access_token;
      
    } catch (error) {
      logger.error('Strava token refresh failed:', error);
      throw error;
    }
  }
  
  private async refreshFitbitToken(refreshToken: string): Promise<string> {
    try {
      const response = await fetch('https://api.fitbit.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(
            `${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`
          ).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `grant_type=refresh_token&refresh_token=${refreshToken}`,
      });
      
      if (!response.ok) {
        throw new Error('Failed to refresh Fitbit token');
      }
      
      const data = await response.json();
      return data.access_token;
      
    } catch (error) {
      logger.error('Fitbit token refresh failed:', error);
      throw error;
    }
  }
  
  // Validate fitness data for task requirements
  validateFitnessGoal(
    requirement: any,
    fitnessData: FitnessData
  ): { met: boolean; progress: number; current: number } {
    let current = 0;
    let target = requirement.target;
    
    switch (requirement.type) {
      case 'step-count':
        current = fitnessData.steps;
        break;
      case 'exercise-minutes':
        current = fitnessData.exerciseMinutes;
        break;
      case 'distance':
        current = fitnessData.distance;
        break;
      case 'calories':
        current = fitnessData.calories;
        break;
    }
    
    const progress = Math.min((current / target) * 100, 100);
    const met = current >= target;
    
    return { met, progress, current };
  }
}

export const fitnessService = new FitnessService();