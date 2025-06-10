import AWS from 'aws-sdk';
import sharp from 'sharp';
import { logger } from '@/utils/logger';

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

const s3 = new AWS.S3();
const bucketName = process.env.AWS_S3_BUCKET || 'honey-badger-files';

class FileService {
  async uploadToS3(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    options: {
      optimize?: boolean;
      maxWidth?: number;
      quality?: number;
    } = {}
  ): Promise<string> {
    try {
      let processedBuffer = buffer;
      
      // Optimize images if requested
      if (options.optimize && mimeType.startsWith('image/')) {
        processedBuffer = await this.optimizeImage(buffer, {
          maxWidth: options.maxWidth || 1920,
          quality: options.quality || 85,
        });
      }
      
      const uploadParams = {
        Bucket: bucketName,
        Key: fileName,
        Body: processedBuffer,
        ContentType: mimeType,
        ACL: 'public-read',
        CacheControl: 'max-age=31536000', // 1 year
      };
      
      const result = await s3.upload(uploadParams).promise();
      
      logger.info(`File uploaded to S3: ${fileName}`);
      return result.Location;
      
    } catch (error) {
      logger.error('S3 upload failed:', error);
      throw new Error('File upload failed');
    }
  }
  
  async deleteFromS3(fileUrl: string): Promise<void> {
    try {
      // Extract key from URL
      const url = new URL(fileUrl);
      const key = url.pathname.substring(1); // Remove leading slash
      
      const deleteParams = {
        Bucket: bucketName,
        Key: key,
      };
      
      await s3.deleteObject(deleteParams).promise();
      
      logger.info(`File deleted from S3: ${key}`);
      
    } catch (error) {
      logger.error('S3 deletion failed:', error);
      // Don't throw error for deletion failures
    }
  }
  
  async generatePresignedUrl(
    fileName: string,
    expiresIn: number = 3600
  ): Promise<string> {
    try {
      const params = {
        Bucket: bucketName,
        Key: fileName,
        Expires: expiresIn,
      };
      
      const url = await s3.getSignedUrlPromise('getObject', params);
      return url;
      
    } catch (error) {
      logger.error('Presigned URL generation failed:', error);
      throw new Error('Failed to generate download URL');
    }
  }
  
  private async optimizeImage(
    buffer: Buffer,
    options: {
      maxWidth: number;
      quality: number;
    }
  ): Promise<Buffer> {
    try {
      const { maxWidth, quality } = options;
      
      const image = sharp(buffer);
      const metadata = await image.metadata();
      
      // Only resize if image is larger than maxWidth
      let pipeline = image;
      if (metadata.width && metadata.width > maxWidth) {
        pipeline = pipeline.resize(maxWidth, null, {
          withoutEnlargement: true,
          fit: 'inside',
        });
      }
      
      // Optimize based on format
      if (metadata.format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality, progressive: true });
      } else if (metadata.format === 'png') {
        pipeline = pipeline.png({ 
          quality, 
          compressionLevel: 9,
          progressive: true,
        });
      } else if (metadata.format === 'webp') {
        pipeline = pipeline.webp({ quality });
      }
      
      return await pipeline.toBuffer();
      
    } catch (error) {
      logger.error('Image optimization failed:', error);
      return buffer; // Return original if optimization fails
    }
  }
  
  getFileExtension(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    };
    
    return mimeToExt[mimeType] || 'bin';
  }
  
  generateFileName(
    prefix: string,
    originalName: string,
    mimeType: string
  ): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2);
    const extension = this.getFileExtension(mimeType);
    
    // Clean original name
    const cleanName = originalName
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .substring(0, 50);
    
    return `${prefix}/${timestamp}-${randomString}-${cleanName}.${extension}`;
  }
  
  validateFile(
    buffer: Buffer,
    mimeType: string,
    maxSize: number
  ): { valid: boolean; error?: string } {
    // Check file size
    if (buffer.length > maxSize) {
      return {
        valid: false,
        error: `File size exceeds limit of ${Math.round(maxSize / 1024 / 1024)}MB`,
      };
    }
    
    // Check mime type
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/webm',
    ];
    
    if (!allowedTypes.includes(mimeType)) {
      return {
        valid: false,
        error: 'File type not allowed',
      };
    }
    
    return { valid: true };
  }
}

const fileService = new FileService();

// Export individual functions for convenience
export const uploadToS3 = fileService.uploadToS3.bind(fileService);
export const deleteFromS3 = fileService.deleteFromS3.bind(fileService);
export const generatePresignedUrl = fileService.generatePresignedUrl.bind(fileService);
export const validateFile = fileService.validateFile.bind(fileService);
export const generateFileName = fileService.generateFileName.bind(fileService);

export { fileService };