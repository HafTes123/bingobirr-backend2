# BingoBirr Backend API

Real-money Bingo platform backend for Ethiopia.

## Quick Start (Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env
# Edit .env with your database URL and secrets

# 3. Generate Prisma client
npx prisma generate

# 4. Run database migrations
npx prisma migrate dev

# 5. Seed admin account + patterns
npm run seed:admin

# 6. Start development server
npm run dev
```

## Production Deployment

### 1. Database Setup

```bash
# Install PostgreSQL on your VPS (Ubuntu)
sudo apt update
sudo apt install postgresql postgresql-contrib

# Create database
sudo -u postgres psql
CREATE DATABASE bingobirr;
CREATE USER bingobirr_user WITH PASSWORD 'strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE bingobirr TO bingobirr_user;
\q

# Update .env with your database URL
DATABASE_URL="postgresql://bingobirr_user:strong_password_here@localhost:5432/bingobirr?schema=public"
```

### 2. Generate JWT Secrets

```bash
# Generate secure random strings
openssl rand -base64 64  # For JWT_ACCESS_SECRET
openssl rand -base64 64  # For JWT_ADMIN_SECRET
```

### 3. Build & Deploy

```bash
# Build TypeScript
npm run build

# Deploy migrations (production)
npx prisma migrate deploy

# Seed admin (ONLY ON FIRST DEPLOYMENT)
npm run seed:admin

# Start with PM2
npm install -g pm2
pm2 start dist/server.js --name bingobirr-api
pm2 save
pm2 startup
```

### 4. Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name api.bingobirr.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 5. SSL (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.bingobirr.com
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register player
- `POST /api/auth/login` - Player login
- `POST /api/auth/admin/login` - Admin login (IP whitelisted)
- `GET /api/auth/me` - Get current user

### Players (Authenticated)
- `GET /api/users/profile` - Get profile
- `GET /api/users/wallet` - Get wallet balance
- `GET /api/users/transactions` - Transaction history
- `POST /api/transactions` - Create deposit/withdrawal

### Game (Public + Auth)
- `GET /api/game/patterns` - Get all patterns
- `GET /api/game/settings` - Game settings
- `GET /api/game/current` - Current game state (auth required)
- `POST /api/game/cards` - Purchase card (auth required)

### Admin (Authenticated + IP Whitelisted)
- `GET /api/admin/transactions/pending` - Pending deposits
- `POST /api/admin/transactions/:id/approve` - Approve deposit
- `POST /api/admin/transactions/:id/reject` - Reject deposit
- `GET /api/admin/users` - List all players
- `PATCH /api/admin/users/:id/status` - Suspend/activate
- `POST /api/admin/game/start` - Start game
- `POST /api/admin/game/stop` - Stop game
- `GET /api/admin/patterns` - List patterns
- `POST /api/admin/patterns` - Create pattern
- `GET /api/admin/settings` - Get settings
- `POST /api/admin/settings` - Update settings
- `GET /api/admin/reports/stats` - Financial stats
- `GET /api/admin/audit-logs` - Audit trail

## Security

- ✅ JWT authentication with separate player/admin secrets
- ✅ IP whitelisting for admin endpoints
- ✅ Rate limiting (global + auth endpoints)
- ✅ Unique transaction ID constraint (prevents replay attacks)
- ✅ ACID transactions for financial operations
- ✅ Argon2id password hashing
- ✅ Server-side bingo validation (never trust client)
- ✅ Audit logging for all admin actions
- ✅ Helmet security headers
- ✅ CORS configuration
- ✅ Single device enforcement (JWT deviceId tracking)

## WebSocket Events

- `game:join` - Join a game room
- `game:state` - Receive current game state
- `game:countdown` - Purchase countdown update
- `game:started` - Game started notification
- `game:ball` - New ball drawn
- `game:claim` - Player claims bingo
- `game:winner` - Winner announced
- `game:ended` - Game ended
- `game:cancelled` - Game cancelled by admin

## Environment Variables

See `.env.example` for all required variables.

## License

Private - BingoBirr PLC
