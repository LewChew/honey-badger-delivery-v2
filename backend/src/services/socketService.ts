import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from '@/models/User';
import { HoneyBadger } from '@/models/HoneyBadger';
import { logger } from '@/utils/logger';
import { SocketEvents } from '@/types';

interface AuthenticatedSocket extends Socket {
  user?: any;
}

class SocketService {
  private io!: Server;
  
  initialize(io: Server): void {
    this.io = io;
  }
  
  // Emit to specific badger room
  emitToBadgerRoom(badgerId: string, event: string, data: any): void {
    this.io.to(`badger:${badgerId}`).emit(event, data);
  }
  
  // Emit to specific user
  emitToUser(userId: string, event: string, data: any): void {
    this.io.to(`user:${userId}`).emit(event, data);
  }
  
  // Emit to all users
  broadcast(event: string, data: any): void {
    this.io.emit(event, data);
  }
}

export const socketService = new SocketService();

// Socket authentication middleware
const authenticateSocket = async (
  socket: AuthenticatedSocket,
  next: (err?: Error) => void
): Promise<void> => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication token required'));
    }
    
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return next(new Error('Server configuration error'));
    }
    
    const decoded = jwt.verify(token, jwtSecret) as { userId: string };
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return next(new Error('User not found'));
    }
    
    socket.user = user;
    next();
    
  } catch (error) {
    next(new Error('Invalid authentication token'));
  }
};

// Setup socket handlers
export const setupSocketHandlers = (io: Server): void => {
  socketService.initialize(io);
  
  // Authentication middleware
  io.use(authenticateSocket);
  
  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user;
    
    if (!user) {
      socket.disconnect();
      return;
    }
    
    logger.info(`User connected: ${user._id} (${socket.id})`);
    
    // Join user-specific room
    socket.join(`user:${user._id}`);
    
    // Handle joining badger rooms
    socket.on('join-badger', async (badgerId: string) => {
      try {
        // Verify user has access to this badger
        const badger = await HoneyBadger.findOne({
          _id: badgerId,
          $or: [
            { senderId: user._id },
            { recipientId: user._id },
          ],
        });
        
        if (!badger) {
          socket.emit('error', { message: 'Badger not found or access denied' });
          return;
        }
        
        socket.join(`badger:${badgerId}`);
        socket.emit('joined-badger', { badgerId });
        
        logger.info(`User ${user._id} joined badger room: ${badgerId}`);
        
      } catch (error) {
        logger.error('Error joining badger room:', error);
        socket.emit('error', { message: 'Failed to join badger room' });
      }
    });
    
    // Handle leaving badger rooms
    socket.on('leave-badger', (badgerId: string) => {
      socket.leave(`badger:${badgerId}`);
      socket.emit('left-badger', { badgerId });
      
      logger.info(`User ${user._id} left badger room: ${badgerId}`);
    });
    
    // Handle typing indicators
    socket.on('typing-start', (data: { badgerId: string }) => {
      socket.to(`badger:${data.badgerId}`).emit('user-typing', {
        userId: user._id,
        username: user.username,
        badgerId: data.badgerId,
      });
    });
    
    socket.on('typing-stop', (data: { badgerId: string }) => {
      socket.to(`badger:${data.badgerId}`).emit('user-stopped-typing', {
        userId: user._id,
        badgerId: data.badgerId,
      });
    });
    
    // Handle task progress updates
    socket.on('task-update', async (data: { badgerId: string; progress: any }) => {
      try {
        const badger = await HoneyBadger.findOne({
          _id: data.badgerId,
          recipientId: user._id, // Only recipient can update progress
        });
        
        if (!badger) {
          socket.emit('error', { message: 'Badger not found or not authorized' });
          return;
        }
        
        // Emit progress update to sender
        socket.to(`badger:${data.badgerId}`).emit('task-progress', {
          badgerId: data.badgerId,
          progress: data.progress,
          updatedBy: user.username,
        });
        
        logger.info(`Task progress updated for badger ${data.badgerId} by user ${user._id}`);
        
      } catch (error) {
        logger.error('Error updating task progress:', error);
        socket.emit('error', { message: 'Failed to update task progress' });
      }
    });
    
    // Handle presence updates
    socket.on('update-presence', (data: { status: 'online' | 'away' | 'offline' }) => {
      // Broadcast presence to user's active badger rooms
      const rooms = Array.from(socket.rooms).filter(room => room.startsWith('badger:'));
      
      rooms.forEach(room => {
        socket.to(room).emit('user-presence', {
          userId: user._id,
          status: data.status,
          timestamp: new Date(),
        });
      });
    });
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`User disconnected: ${user._id} (${socket.id}) - ${reason}`);
      
      // Notify badger rooms about user going offline
      const rooms = Array.from(socket.rooms).filter(room => room.startsWith('badger:'));
      
      rooms.forEach(room => {
        socket.to(room).emit('user-presence', {
          userId: user._id,
          status: 'offline',
          timestamp: new Date(),
        });
      });
    });
    
    // Handle errors
    socket.on('error', (error) => {
      logger.error(`Socket error for user ${user._id}:`, error);
    });
  });
  
  // Handle global events
  io.on('connect_error', (error) => {
    logger.error('Socket connection error:', error);
  });
  
  logger.info('Socket.IO handlers setup complete');
};