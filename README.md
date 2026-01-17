# Tallie Restaurant Reservation API

Simple REST API for managing restaurants, tables, and reservations — with authentication, roles, permissions, Redis caching, waitlist functionality, and peak hours management.

## Stack

- Node.js + Express
- TypeScript
- Prisma ORM + Postgres
- Redis (caching & rate limiting)
- Jest + Supertest (tests)
- JWT Authentication + RBAC
- Docker & Docker Compose

## Features

- **Restaurant Management**: Create restaurants, configure tables, set operating hours
- **Reservation System**: Book, modify, cancel reservations with conflict detection
- **Seating Optimization**: Intelligent table assignment based on party size
- **Waitlist**: Queue customers when no tables available, auto-notify on availability
- **Peak Hours**: Limit reservation duration during busy periods
- **Redis Caching**: Fast availability checks with automatic cache invalidation
- **Email Notifications**: Confirmation, modification, cancellation, and waitlist emails via Brevo
- **Docker Support**: Full containerization with PostgreSQL and Redis

## Quick Start with Docker

```bash
# Start all services (PostgreSQL, Redis, App)
npm run docker:dev

# Run database migrations
npm run docker:migrate

# View logs
npm run docker:logs

# Stop services
npm run docker:dev:down
```

## Manual Setup

```bash
# Install dependencies
npm install

# Generate Prisma client (outputs to generated/prisma)
npm run generate

# Apply database migrations
npm run migrate

# Start dev server
npm run dev
```

Server listens on port 3000 by default (configurable via `PORT`).

## Environment

Create a `.env` file with:

```env
# Postgres connection
DATABASE_URL=postgres://user:password@localhost:5432/tallie

# Optional separate DB for tests
DATABASE_URL_TEST=postgres://user:password@localhost:5432/tallie_test

# Redis connection (optional - caching disabled if not set)
REDIS_URL=redis://localhost:6379

# JWT configuration
JWT_SECRET=your_access_token_secret
JWT_REFRESH_SECRET=your_refresh_token_secret
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Server
PORT=3000

# Email (Brevo)
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=noreply@tallie-test-domain.com
BREVO_SENDER_NAME=Tallie Reservations
```

## API Endpoints

All endpoints are under the `/api/v1` prefix.

### Health Check

- GET /api/v1/health
  - Returns `{ status: "ok", timestamp: "..." }`

### Restaurants

- POST /api/v1/restaurants
  - Body: `{ name, openingTime:"HH:MM", closingTime:"HH:MM", totalTables?(optional) }`
  - Creates a restaurant.

- POST /api/v1/restaurants/:id/tables
  - Body: `{ number, capacity }`
  - Adds a table to a restaurant.

- GET /api/v1/restaurants/:id
  - Returns restaurant details and tables.

- GET /api/v1/restaurants/:id/availability
  - Query: `dateTime=ISO&durationMinutes&partySize`
  - Returns available tables for the given slot and party size.
  - Includes peak hour information and seating recommendations.
  - Supports Redis caching for performance.

- GET /api/v1/restaurants/:id/reservations
  - Query: `date=YYYY-MM-DD`
  - Lists all reservations for that date.

- GET /api/v1/restaurants/:id/available-slots
  - Query: `date=YYYY-MM-DD&durationMinutes&partySize&stepMinutes?`
  - Returns all slots inside operating hours with at least one fitting table.
  - Includes peak hour indicators for each slot.

### Peak Hours Management

- GET /api/v1/restaurants/:id/peak-hours
  - Returns peak hours configuration for the restaurant.

- POST /api/v1/restaurants/:id/peak-hours
  - Body: `{ dayOfWeek: 0-6, startTime: "HH:MM", endTime: "HH:MM", maxDurationMinutes }`
  - Creates or updates peak hours configuration.
  - Example: Limit Friday 6-9 PM reservations to 90 minutes max.

- PATCH /api/v1/restaurants/:id/peak-hours/:peakHourId
  - Body: `{ startTime?, endTime?, maxDurationMinutes?, isActive? }`
  - Updates existing peak hour configuration.

- DELETE /api/v1/restaurants/:id/peak-hours/:peakHourId
  - Removes peak hour configuration.

### Reservations

- POST /api/v1/reservations
  - Body: `{ restaurantId, customerName, phone, email?, partySize, dateTime, durationMinutes, tableId?, userId? }`
  - Creates a reservation with intelligent table assignment.
  - Validates peak hour restrictions.
  - Returns table alternatives if specified table unavailable.
  - Sends confirmation email.

- GET /api/v1/reservations/suggestions
  - Query: `restaurantId&dateTime&partySize&durationMinutes`
  - Returns ranked table suggestions and alternative times.

- GET /api/v1/reservations/:id
  - Returns reservation details with restaurant and table info.

- PATCH /api/v1/reservations/:id
  - Body: optional fields `{ customerName?, phone?, partySize?, dateTime?, durationMinutes?, tableId?, status? }`
  - Validates operating hours, table capacity, overlaps, and peak hours.
  - Status transitions: `pending→confirmed→completed`, `*→cancelled`
  - Sends modification email.

- POST /api/v1/reservations/:id/cancel
  - Cancels reservation (sets status to `cancelled`).
  - Automatically checks waitlist and notifies waiting customers.
  - Sends cancellation email.

- POST /api/v1/reservations/:id/confirm
  - Confirms a pending reservation.

- POST /api/v1/reservations/:id/complete
  - Marks a confirmed reservation as completed (guest left).

### Waitlist

- POST /api/v1/waitlist
  - Body: `{ restaurantId, customerName, phone, email?, partySize, preferredDate, preferredTime, flexibilityMins?, durationMinutes, userId? }`
  - Adds customer to waitlist when no tables available.
  - Returns waitlist position.

- GET /api/v1/waitlist
  - Query: `restaurantId&date=YYYY-MM-DD`
  - Lists waitlist entries for a restaurant on a date.

- GET /api/v1/waitlist/:id
  - Returns waitlist entry details with position.

- PATCH /api/v1/waitlist/:id
  - Body: `{ customerName?, phone?, email?, partySize?, preferredTime?, flexibilityMins?, durationMinutes? }`
  - Updates waitlist entry.

- POST /api/v1/waitlist/:id/cancel
  - Cancels waitlist entry.

- POST /api/v1/waitlist/:id/convert
  - Body: `{ tableId?, startTime? }`
  - Converts waitlist entry to reservation.

- POST /api/v1/waitlist/check-availability
  - Body: `{ restaurantId, date }`
  - Checks and notifies waitlist entries when tables become available.
  - Can be triggered by cron job or after cancellations.

### Authentication

Auth routes are prefixed with `/api/v1/auth`.

- POST /api/v1/auth/register
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/forgot-password
- POST /api/v1/auth/reset-password
- POST /api/v1/auth/logout
- POST /api/v1/auth/logout-all (requires auth)
- POST /api/v1/auth/change-password (requires auth)
- GET /api/v1/auth/me (requires auth)

## Business Rules

### Reservation Rules

- Reservations only during operating hours
- Parties must fit table capacity
- No overlapping reservations per table
- Peak hour duration limits enforced

### Seating Optimization

- Auto-assignment picks the smallest capacity table that fits
- Suggests alternatives when preferred table unavailable
- Provides alternative time slots when fully booked

### Peak Hours

- Configure per day of week with time range
- Set maximum reservation duration during peak times
- Example: Friday 6-9 PM → max 90 minute reservations

#### Automation Behavior

- Reservations that exceed the configured peak-hour `maxDurationMinutes` are automatically rejected during creation and updates.
- Availability endpoints annotate slots with `isPeakHour` and `maxDuration` to guide users.
- Waitlist conversions also enforce peak-hour limits and operating hours for consistency.

#### Configure Example (Friday 6–9 PM, 90 min cap)

```bash
curl -X POST \
  http://localhost:3000/api/v1/restaurants/{restaurantId}/peak-hours \
  -H 'Content-Type: application/json' \
  -d '{
    "dayOfWeek": 5,
    "startTime": "18:00",
    "endTime": "21:00",
    "maxDurationMinutes": 90
  }'
```

Notes:

- `dayOfWeek`: 0=Sunday ... 5=Friday ... 6=Saturday
- Peak windows must be inside operating hours; overlapping windows are allowed but each has its own cap.
- Changes are cached and invalidated automatically.

### Waitlist

- FIFO ordering per restaurant/date
- Automatic notification when table becomes available
- 30-minute claim window after notification
- Flexibility window for preferred time matching

## Sample Scenarios

### Scenario 1: Normal Booking

```
Restaurant opens 10 AM - 10 PM
Table 1: capacity 4
Request: Party of 3 at 7 PM for 2 hours
Result: ✅ Assigned to Table 1 (1 extra seat)
```

### Scenario 2: Overlap Detection

```
Existing: Table 1 booked 7-9 PM
Request: Table 1 at 8 PM for 2 hours
Result: ❌ Conflict - suggests alternative times (6 PM, 9 PM)
```

### Scenario 3: Capacity Mismatch

```
Tables: Table 1 (4 seats), Table 2 (6 seats)
Request: Party of 6 for Table 1
Result: ❌ Capacity too small - suggests Table 2
```

### Scenario 4: Peak Hour Enforcement

```
Peak Hours: Friday 6-9 PM, max 90 minutes
Request: Friday 7 PM for 120 minutes
Result: ❌ Exceeds peak hour limit - max 90 minutes allowed
```

### Scenario 5: Waitlist Flow

```
1. No tables available for Saturday 7 PM
2. Customer added to waitlist (position #3)
3. Another customer cancels Saturday 7 PM reservation
4. Waitlist position #1 notified via email
5. Customer converts waitlist entry to reservation
```

## Redis Caching

- Availability checks cached for 5 minutes
- Available slots cached per restaurant/date/party size
- Peak hours configuration cached for 1 hour
- Automatic cache invalidation on:
  - Reservation creation/modification/cancellation
  - Peak hours changes

## Docker Configuration

### Development

```bash
npm run docker:dev          # Start with hot reload
npm run docker:dev:down     # Stop services
npm run docker:logs         # View application logs
npm run docker:migrate      # Run migrations in container
```

### Production

```bash
npm run docker:prod         # Start production build
npm run docker:prod:down    # Stop production services
```

### Services

- **postgres**: PostgreSQL 16 on port 5432
- **redis**: Redis 7 on port 6379
- **app**: Node.js application on port 3000

## Tests

```bash
npm test
```

- Uses `DATABASE_URL_TEST` if provided
- Automatically resets migrations before running tests

## Design Decisions

- Opening/closing hours stored as minutes-from-midnight for efficient comparisons
- Overlap detection uses interval intersection: `startA < endB && startB < endA`
- Seating optimization scores tables by extra capacity (lower = better)
- Redis caching with pattern-based invalidation for consistency
- Waitlist uses FIFO with flexibility windows for matching
- Peak hours per day-of-week with time ranges
- JWT-based auth with refresh tokens stored and revokable

## Email Notifications

Sent via Brevo (commented out and used basic logging as requested):

- **Reservation Confirmation**: When created or confirmed
- **Reservation Modification**: When details changed
- **Reservation Cancellation**: When cancelled
- **Waitlist Confirmation**: When added to waitlist
- **Waitlist Notification**: When table becomes available

## Project Structure

(NOTE: this structure is AI generated for illustration purposes)

```
├── prisma/
│   └── schema.prisma       # Database schema
├── src/
│   ├── app.ts              # Express app setup
│   ├── server.ts           # Server entry point
│   ├── prisma.ts           # Prisma client
│   ├── middleware/
│   │   ├── auth.ts         # Authentication middleware
│   │   └── error.ts        # Error handling
│   ├── routes/
│   │   ├── auth.ts         # Auth endpoints
│   │   ├── reservations.ts # Reservation endpoints
│   │   ├── restaurants.ts  # Restaurant endpoints
│   │   └── waitlist.ts     # Waitlist endpoints
│   ├── utils/
│   │   ├── auth.ts         # JWT & auth utilities
│   │   ├── email.ts        # Email service (Brevo)
│   │   ├── peakHours.ts    # Peak hours service
│   │   ├── redis.ts        # Redis caching service
│   │   ├── seating.ts      # Seating optimization
│   │   └── time.ts         # Time utilities
│   └── validation/
│       └── schemas.ts      # Zod validation schemas
├── Dockerfile              # Production Docker build
├── Dockerfile.dev          # Development Docker build
├── docker-compose.yml      # Development compose
└── docker-compose.prod.yml # Production compose
```

## Limitations / Future Improvements

- [ ] Add rate limiting middleware
- [ ] Implement WebSocket for real-time waitlist updates
- [ ] Add real SMS notifications
- [ ] Support multi-location restaurant chains
- [ ] Add analytics dashboard
- [ ] Implement recurring reservations
- [ ] Add payment integration for deposits
- [ ] CI/CD pipeline with GitHub Actions
- [ ] Add support for custom domain
- [ ] Add a review and rating system for restaurants
- [ ] Add pricing tiers for different restaurant sizes/features
- [ ] Allow restaurants to define custom cancellation policies
- [ ] Allow customers to upload special requests or notes with reservations
- [ ] Allow customers to view and manage their reservation history
- [ ] Allow restaurants to offer promotional codes or discounts for reservations
- [ ] Setup Cron jobs for periodic tasks (e.g., clearing old data, sending reminders, and checking waitlist availability, and auto-canceling unclaimed waitlist spots, auto-cancelling reservations if not confirmed within a certain time frame)
- [ ] Implement logic to remember user preferences (e.g., favorite restaurants, preferred seating)
- [ ] Implement a multi-user selection for reservations (group bookings).

## Scaling Considerations

- Redis for rate-limiting
- Message queues for async email sending
- Read replicas for heavy read workloads
- Horizontal scaling of app containers behind a load balancer
