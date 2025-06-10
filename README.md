# 🍯🦡 Honey Badger Delivery App

A gamified digital gift delivery platform where friends and family can send motivational challenges through persistent AI honey badger companions.

## 🎯 What is Honey Badger?

Honey Badger is like digital gift cards meets personal motivation - recipients interact with an AI honey badger chatbot that delivers rewards based on completing real-world tasks. Inspired by the Rat Things from Snow Crash, these digital companions are persistent, motivational, and reward-driven.

### Core Features:
- 🎁 **Digital Gift Cards**: Send money, messages, pictures, videos
- 🏃‍♀️ **Task-Based Unlocking**: Recipients complete challenges to unlock rewards
- 🤖 **AI Chatbot**: Persistent honey badger companion guides and motivates
- 📱 **Fitness Integration**: Connect with Apple Health, Strava, Fitbit
- 📸 **Verification**: Photo/video proof of task completion
- 💰 **Flexible Rewards**: Money transfers, digital content, experiences

## 🏗 Architecture

### Frontend (iOS Optimized)
- **React Native** with Expo managed workflow
- **TypeScript** for type safety
- **Native Base** for iOS-optimized UI components
- **React Query** for data fetching and caching
- **Zustand** for state management

### Backend
- **Node.js** with Express.js
- **TypeScript** throughout
- **MongoDB** with Mongoose ODM
- **Socket.IO** for real-time chat
- **Redis** for caching and sessions
- **JWT** authentication

### Integrations
- **Stripe** for payments
- **AWS S3** for file storage
- **Firebase** for push notifications
- **OpenAI API** for chatbot intelligence
- **Apple HealthKit** integration
- **Strava API** for fitness tracking

### Deployment
- **Docker** containerization
- **Docker Compose** for local development
- **VM deployment** ready with reverse proxy
- **CI/CD** with GitHub Actions

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- iOS Simulator (for development)
- MongoDB (local or cloud)

### 1. Clone and Setup
```bash
git clone https://github.com/LewChew/honey-badger-delivery-v2.git
cd honey-badger-delivery-v2
cp .env.example .env
# Edit .env with your configuration
```

### 2. Run with Docker (VM Ready)
```bash
# Start all services
docker-compose up -d

# The app will be available at:
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# MongoDB: mongodb://localhost:27017
```

### 3. iOS Development
```bash
cd mobile
npm install
npx expo start --ios
```

### 4. Backend Development
```bash
cd backend
npm install
npm run dev
```

## 📱 iOS App Features

### Sender Experience
1. **Create Honey Badger**: Choose personality, set challenge
2. **Set Reward**: Money, message, media content
3. **Define Task**: Workout goals, photo challenges, custom tasks
4. **Send**: Recipient gets notification with honey badger arrival

### Recipient Experience
1. **Meet Your Badger**: Persistent AI companion introduction
2. **View Challenge**: Understand what needs to be completed
3. **Track Progress**: Real-time updates and motivation
4. **Submit Proof**: Photos, videos, fitness data
5. **Get Reward**: Unlock money, content, or experiences

### AI Honey Badger Personality
- **Tenacious**: Never gives up on helping you succeed
- **Supportive**: Provides encouragement and tips
- **Adaptive**: Learns your preferences and motivation style
- **Persistent**: Gentle reminders without being annoying
- **Celebratory**: Enthusiastic about your victories

## 🛠 Development

### Project Structure
```
honey-badger-delivery-v2/
├── mobile/                 # React Native iOS app
├── backend/               # Node.js API server
├── shared/                # Shared types and utilities
├── docker/                # Docker configuration
├── docs/                  # API documentation
└── scripts/               # Deployment and utility scripts
```

### API Endpoints
- `POST /auth/login` - User authentication
- `POST /badgers/create` - Send new honey badger
- `GET /badgers/received` - Get received badgers
- `POST /tasks/submit` - Submit task completion
- `GET /chat/:badgerId` - Chat history
- `POST /chat/:badgerId` - Send chat message

## 🔧 VM Deployment

The app is fully containerized and ready for VM deployment:

```bash
# Production deployment
./scripts/deploy-vm.sh

# Or manually:
docker-compose -f docker-compose.prod.yml up -d
```

### VM Requirements
- 2+ CPU cores
- 4GB+ RAM
- 20GB+ storage
- Ubuntu 20.04+ or similar
- Docker and Docker Compose installed

## 🔐 Security Features

- JWT authentication with refresh tokens
- Rate limiting on API endpoints
- Input validation and sanitization
- Secure file upload with virus scanning
- HTTPS enforcement in production
- Database connection encryption

## 🌟 Future Enhancements

- [ ] Apple Watch integration
- [ ] Voice messages from honey badger
- [ ] Group challenges and team badgers
- [ ] Marketplace for pre-made challenges
- [ ] Integration with more fitness platforms
- [ ] AR honey badger visualization
- [ ] Blockchain reward tokens

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📞 Support

For issues and questions:
- Create an issue on GitHub
- Check the [API documentation](./docs/api.md)
- Review the [deployment guide](./docs/deployment.md)

---

*"Honey badgers don't care about your excuses - they care about your success!"* 🍯🦡