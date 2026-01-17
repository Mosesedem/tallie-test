# Tallie Restaurant Reservation API

A production-ready REST API for managing restaurants, tables, and reservations — with timezone-aware scheduling, authentication, roles, permissions, Redis caching, waitlist functionality, and peak hours management.

## Stack

- Node.js + Express
- TypeScript
- Prisma ORM + Postgres
- Redis (caching & rate limiting)
- Jest + Supertest (tests)
- JWT Authentication + RBAC
- Docker & Docker Compose
- date-fns + date-fns-tz (timezone handling)

## Features

- **Restaurant Management**: Create restaurants with timezone support, configure tables, set operating hours
- **Timezone-Aware Scheduling**: Full IANA timezone support for accurate local time handling
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

---

## ⏰ Time & Timezone Handling (IMPORTANT FOR FRONTEND)

This API uses **timezone-aware scheduling**. Understanding this is critical for correct frontend implementation.

### Key Concepts

| Concept        | Format            | Example                      | Description                   |
| -------------- | ----------------- | ---------------------------- | ----------------------------- |
| **Timezone**   | IANA string       | `"America/New_York"`         | Restaurant's local timezone   |
| **Local Time** | `HH:MM` (24-hour) | `"18:30"`                    | Time in restaurant's timezone |
| **DateTime**   | ISO 8601 UTC      | `"2026-01-17T23:30:00.000Z"` | Absolute moment in time       |
| **Date**       | `YYYY-MM-DD`      | `"2026-01-17"`               | Calendar date                 |

### How It Works

1. **Restaurants store their timezone** (e.g., `"America/New_York"`)
2. **Operating hours, peak hours, and preferred times** are in **local time** (`HH:MM` format)
3. **Reservation times** are sent as **ISO 8601 UTC strings**
4. **The API converts UTC to local time** using the restaurant's timezone for validation

### Frontend Workflow

#### When Creating a Reservation:

```javascript
// User selects: January 17, 2026 at 6:30 PM (restaurant is in New York)
// Restaurant timezone: "America/New_York"

// Convert local selection to UTC before sending to API
const localDate = new Date(2026, 0, 17, 18, 30, 0); // Jan 17, 2026 6:30 PM local
const utcString = localDate.toISOString(); // "2026-01-17T23:30:00.000Z" (if user is in NY)

// Send to API
fetch("/api/v1/reservations", {
  method: "POST",
  body: JSON.stringify({
    restaurantId: 1,
    customerName: "John Doe",
    phone: "555-1234",
    partySize: 4,
    dateTime: utcString, // Always send UTC ISO string
    durationMinutes: 90,
  }),
});
```

#### When Displaying Times:

```javascript
// API returns: startTime: "2026-01-17T23:30:00.000Z"
// Restaurant timezone: "America/New_York"

// Convert UTC to restaurant's local time for display
const utcDate = new Date("2026-01-17T23:30:00.000Z");
const displayTime = utcDate.toLocaleString("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
}); // "6:30 PM"
```

### Common IANA Timezone Examples

| Region           | Timezone String       |
| ---------------- | --------------------- |
| US Eastern       | `America/New_York`    |
| US Central       | `America/Chicago`     |
| US Mountain      | `America/Denver`      |
| US Pacific       | `America/Los_Angeles` |
| UK               | `Europe/London`       |
| Central Europe   | `Europe/Paris`        |
| Japan            | `Asia/Tokyo`          |
| Australia Sydney | `Australia/Sydney`    |
| UTC              | `UTC`                 |

> 💡 **Tip**: Use `Intl.supportedValuesOf('timeZone')` in the browser to get all valid timezone strings.

---

### Health Check

- GET /api/v1/health
  - Returns `{ status: "ok", timestamp: "..." }`

### Restaurants

#### POST /api/v1/restaurants

Creates a new restaurant with timezone configuration.

**Request Body:**

```json
{
  "name": "The Italian Place",
  "timezone": "America/New_York",
  "openingTime": "10:00",
  "closingTime": "22:00",
  "totalTables": 15
}
```

| Field         | Type   | Required | Description                                         |
| ------------- | ------ | -------- | --------------------------------------------------- |
| `name`        | string | ✅       | Unique restaurant name                              |
| `timezone`    | string | ❌       | IANA timezone (default: `"UTC"`)                    |
| `openingTime` | string | ✅       | Opening time in `HH:MM` 24-hour format (local time) |
| `closingTime` | string | ✅       | Closing time in `HH:MM` 24-hour format (local time) |
| `totalTables` | number | ❌       | Optional total table count                          |

**Response (201):**

```json
{
  "id": 1,
  "name": "The Italian Place",
  "timezone": "America/New_York",
  "openingTime": "10:00",
  "closingTime": "22:00",
  "totalTables": 15,
  "createdAt": "2026-01-17T12:00:00.000Z",
  "updatedAt": "2026-01-17T12:00:00.000Z"
}
```

#### POST /api/v1/restaurants/:id/tables

Adds a table to a restaurant.

**Request Body:**

```json
{
  "number": 1,
  "capacity": 4
}
```

| Field      | Type   | Required | Description                          |
| ---------- | ------ | -------- | ------------------------------------ |
| `number`   | number | ✅       | Table number (unique per restaurant) |
| `capacity` | number | ✅       | Maximum party size                   |

#### GET /api/v1/restaurants/:id

Returns restaurant details including timezone and all tables.

**Response:**

```json
{
  "id": 1,
  "name": "The Italian Place",
  "timezone": "America/New_York",
  "openingTime": "10:00",
  "closingTime": "22:00",
  "totalTables": 15,
  "tables": [
    { "id": 1, "number": 1, "capacity": 4 },
    { "id": 2, "number": 2, "capacity": 6 }
  ]
}
```

#### GET /api/v1/restaurants/:id/availability

Check table availability for a specific time slot.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateTime` | string | ✅ | ISO 8601 UTC datetime (e.g., `2026-01-17T23:30:00.000Z`) |
| `durationMinutes` | number | ✅ | Reservation duration in minutes |
| `partySize` | number | ✅ | Number of guests |

**Example:** `GET /api/v1/restaurants/1/availability?dateTime=2026-01-17T23:30:00.000Z&durationMinutes=90&partySize=4`

**Response:**

```json
{
  "availableTables": [
    { "id": 1, "number": 1, "capacity": 4 },
    { "id": 2, "number": 2, "capacity": 6 }
  ],
  "recommendations": [...],
  "peakHour": {
    "active": true,
    "maxDuration": 90,
    "exceedsLimit": false
  }
}
```

#### GET /api/v1/restaurants/:id/reservations

Lists all reservations for a specific date.

**Query:** `date=YYYY-MM-DD`

**Example:** `GET /api/v1/restaurants/1/reservations?date=2026-01-17`

#### GET /api/v1/restaurants/:id/available-slots

Returns all available time slots for a given date.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | string | ✅ | Date in `YYYY-MM-DD` format |
| `durationMinutes` | number | ✅ | Reservation duration |
| `partySize` | number | ✅ | Number of guests |
| `stepMinutes` | number | ❌ | Interval between slots (default: 30) |

**Response:**

```json
{
  "slots": [
    { "start": "2026-01-17T15:00:00.000Z", "isPeakHour": false },
    { "start": "2026-01-17T15:30:00.000Z", "isPeakHour": false },
    {
      "start": "2026-01-17T23:00:00.000Z",
      "isPeakHour": true,
      "maxDuration": 90
    }
  ]
}
```

> ⚠️ **Note**: Slot times are returned in UTC. Convert to local time using the restaurant's timezone for display.

### Peak Hours Management

Peak hours allow restaurants to limit reservation durations during busy periods.

#### GET /api/v1/restaurants/:id/peak-hours

Returns all peak hour configurations for the restaurant.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "dayOfWeek": 5,
      "dayName": "Friday",
      "startTime": "18:00",
      "endTime": "21:00",
      "maxDurationMinutes": 90
    }
  ]
}
```

#### POST /api/v1/restaurants/:id/peak-hours

Creates or updates a peak hours configuration.

**Request Body:**

```json
{
  "dayOfWeek": 5,
  "startTime": "18:00",
  "endTime": "21:00",
  "maxDurationMinutes": 90
}
```

| Field                | Type   | Required | Description                                  |
| -------------------- | ------ | -------- | -------------------------------------------- |
| `dayOfWeek`          | number | ✅       | 0=Sunday, 1=Monday, ..., 6=Saturday          |
| `startTime`          | string | ✅       | Start time in `HH:MM` 24-hour format (local) |
| `endTime`            | string | ✅       | End time in `HH:MM` 24-hour format (local)   |
| `maxDurationMinutes` | number | ✅       | Maximum allowed reservation duration         |

> ⚠️ Peak hours must fall within the restaurant's operating hours.

#### PATCH /api/v1/restaurants/:id/peak-hours/:peakHourId

Updates an existing peak hour configuration.

**Request Body (all fields optional):**

```json
{
  "startTime": "17:00",
  "endTime": "20:00",
  "maxDurationMinutes": 60,
  "isActive": true
}
```

#### DELETE /api/v1/restaurants/:id/peak-hours/:peakHourId

Removes a peak hour configuration.

### Reservations

#### POST /api/v1/reservations

Creates a new reservation with intelligent table assignment.

**Request Body:**

```json
{
  "restaurantId": 1,
  "customerName": "John Doe",
  "phone": "555-123-4567",
  "email": "john@example.com",
  "partySize": 4,
  "dateTime": "2026-01-17T23:30:00.000Z",
  "durationMinutes": 90,
  "tableId": 1,
  "userId": "uuid-optional"
}
```

| Field             | Type   | Required | Description                               |
| ----------------- | ------ | -------- | ----------------------------------------- |
| `restaurantId`    | number | ✅       | Restaurant ID                             |
| `customerName`    | string | ✅       | Guest name                                |
| `phone`           | string | ✅       | Contact phone (min 5 chars)               |
| `email`           | string | ❌       | Email for confirmations                   |
| `partySize`       | number | ✅       | Number of guests                          |
| `dateTime`        | string | ✅       | **ISO 8601 UTC** datetime                 |
| `durationMinutes` | number | ✅       | Reservation duration in minutes           |
| `tableId`         | number | ❌       | Specific table (auto-assigned if omitted) |
| `userId`          | string | ❌       | Associated user UUID                      |

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "restaurantId": 1,
    "tableId": 1,
    "customerName": "John Doe",
    "phone": "555-123-4567",
    "partySize": 4,
    "startTime": "2026-01-17T23:30:00.000Z",
    "durationMinutes": 90,
    "status": "confirmed"
  },
  "selectedTable": { "tableId": 1, "tableNumber": 1, "capacity": 4, "score": 0 },
  "alternatives": [...]
}
```

**Error Response (409 - No Tables Available):**

```json
{
  "error": "No available table for the requested time slot",
  "details": {
    "suggestions": ["Try 30 minutes earlier", "Try 30 minutes later"],
    "addToWaitlist": true,
    "waitlistUrl": "/api/v1/waitlist"
  }
}
```

#### GET /api/v1/reservations/suggestions

Get ranked table suggestions for a time slot.

**Query:** `restaurantId&dateTime&partySize&durationMinutes`

#### GET /api/v1/reservations/:id

Returns reservation details with restaurant and table info.

#### PATCH /api/v1/reservations/:id

Updates a reservation. Validates operating hours, capacity, overlaps, and peak hours.

**Request Body (all fields optional):**

```json
{
  "customerName": "Jane Doe",
  "phone": "555-987-6543",
  "partySize": 6,
  "dateTime": "2026-01-17T00:00:00.000Z",
  "durationMinutes": 120,
  "tableId": 2,
  "status": "confirmed"
}
```

**Status Transitions:**

- `pending` → `confirmed` or `cancelled`
- `confirmed` → `completed` or `cancelled`
- `completed` → (no transitions)
- `cancelled` → (no transitions)

#### POST /api/v1/reservations/:id/cancel

Cancels a reservation. Automatically checks waitlist and notifies waiting customers.

#### POST /api/v1/reservations/:id/confirm

Confirms a pending reservation.

#### POST /api/v1/reservations/:id/complete

Marks a confirmed reservation as completed (guest has left).

### Waitlist

When no tables are available, customers can join a waitlist.

#### POST /api/v1/waitlist

Adds a customer to the waitlist.

**Request Body:**

```json
{
  "restaurantId": 1,
  "customerName": "Jane Smith",
  "phone": "555-987-6543",
  "email": "jane@example.com",
  "partySize": 4,
  "preferredDate": "2026-01-17",
  "preferredTime": "19:00",
  "flexibilityMins": 60,
  "durationMinutes": 90,
  "userId": "uuid-optional"
}
```

| Field             | Type   | Required | Description                                         |
| ----------------- | ------ | -------- | --------------------------------------------------- |
| `restaurantId`    | number | ✅       | Restaurant ID                                       |
| `customerName`    | string | ✅       | Guest name                                          |
| `phone`           | string | ✅       | Contact phone                                       |
| `email`           | string | ❌       | Email for notifications                             |
| `partySize`       | number | ✅       | Number of guests                                    |
| `preferredDate`   | string | ✅       | Date in `YYYY-MM-DD` format                         |
| `preferredTime`   | string | ✅       | Time in `HH:MM` 24-hour format (**local time**)     |
| `flexibilityMins` | number | ❌       | Flexibility window ±minutes (default: 60, max: 240) |
| `durationMinutes` | number | ✅       | Desired reservation duration                        |
| `userId`          | string | ❌       | Associated user UUID                                |

> ⚠️ **Important**: `preferredTime` is in the **restaurant's local timezone**, not UTC.

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": 5,
    "position": 3,
    "message": "Added to waitlist. You will be notified when a table becomes available."
  }
}
```

#### GET /api/v1/waitlist

Lists waitlist entries for a restaurant on a specific date.

**Query:** `restaurantId=1&date=2026-01-17`

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 5,
      "customerName": "Jane Smith",
      "partySize": 4,
      "preferredTime": "19:00",
      "status": "waiting",
      "position": 1
    }
  ]
}
```

#### GET /api/v1/waitlist/:id

Returns waitlist entry details with current position.

#### PATCH /api/v1/waitlist/:id

Updates a waitlist entry.

**Request Body (all optional):**

```json
{
  "customerName": "Jane Doe",
  "phone": "555-111-2222",
  "email": "jane.doe@example.com",
  "partySize": 6,
  "preferredTime": "20:00",
  "flexibilityMins": 30,
  "durationMinutes": 60
}
```

#### POST /api/v1/waitlist/:id/cancel

Cancels a waitlist entry.

#### POST /api/v1/waitlist/:id/convert

Converts a waitlist entry to a confirmed reservation.

**Request Body:**

```json
{
  "tableId": 1,
  "startTime": "2026-01-17T00:00:00.000Z"
}
```

| Field       | Type   | Required | Description                                   |
| ----------- | ------ | -------- | --------------------------------------------- |
| `tableId`   | number | ❌       | Specific table (auto-assigned if omitted)     |
| `startTime` | string | ❌       | ISO 8601 UTC (uses preferred time if omitted) |

#### POST /api/v1/waitlist/check-availability

Manually triggers a check for available tables and notifies waitlist entries.

**Request Body:**

```json
{
  "restaurantId": 1,
  "date": "2026-01-17"
}
```

> 💡 This is also triggered automatically when a reservation is cancelled.

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
Restaurant: "The Italian Place" (timezone: America/New_York)
Operating hours: 10:00 AM - 10:00 PM (local)
Table 1: capacity 4

Frontend sends:
  dateTime: "2026-01-17T00:00:00.000Z" (= 7 PM Eastern on Jan 16)
  partySize: 3
  durationMinutes: 120

Result: ✅ Assigned to Table 1 (1 extra seat)
```

### Scenario 2: Overlap Detection

```
Existing: Table 1 booked 7-9 PM (Eastern)
Request: Table 1 at 8 PM for 2 hours

Result: ❌ Conflict
Response includes:
  - suggestions: ["Try 30 minutes earlier", "Try 30 minutes later"]
  - addToWaitlist: true
```

### Scenario 3: Capacity Mismatch

```
Tables: Table 1 (4 seats), Table 2 (6 seats)
Request: Party of 6 for Table 1

Result: ❌ Capacity too small
Response suggests: Table 2 as alternative
```

### Scenario 4: Peak Hour Enforcement

```
Peak Hours: Friday 6-9 PM (local), max 90 minutes
Request: Friday 7 PM (local) for 120 minutes

Result: ❌ Exceeds peak hour limit
Error: "Peak hour restriction: Maximum reservation duration is 90 minutes during this time"
```

### Scenario 5: Waitlist Flow

```
1. Customer tries to book Saturday 7 PM — no tables available
2. Customer added to waitlist (position #3)
   - preferredDate: "2026-01-17"
   - preferredTime: "19:00" (local time, HH:MM format)
   - flexibilityMins: 60
3. Another customer cancels their Saturday 7 PM reservation
4. API automatically checks waitlist
5. Position #1 notified via email (if email provided)
6. Customer converts waitlist entry to reservation within 30 minutes
```

### Scenario 6: Timezone Handling

```
Restaurant in Los Angeles (America/Los_Angeles)
Operating hours: 11:00 - 23:00 (local)

Customer in New York books for "9 PM" (their time):
  - If they want 9 PM LA time → dateTime: "2026-01-18T05:00:00.000Z"
  - If they want 9 PM their time (6 PM LA) → dateTime: "2026-01-18T02:00:00.000Z"

Frontend must clarify: "All times are in restaurant's local time (Pacific)"
```

---

## API Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "details": { ... }
}
```

### Common Error Codes

| Status | Error          | Description                                   |
| ------ | -------------- | --------------------------------------------- |
| 400    | Bad Request    | Invalid input, validation failed              |
| 401    | Unauthorized   | Missing or invalid authentication             |
| 403    | Forbidden      | Insufficient permissions                      |
| 404    | Not Found      | Resource doesn't exist                        |
| 409    | Conflict       | Resource conflict (e.g., no tables available) |
| 422    | Unprocessable  | Business rule violation                       |
| 500    | Internal Error | Server error                                  |

### Specific Error Examples

**Outside Operating Hours:**

```json
{
  "error": "Reservation time outside operating hours"
}
```

**Peak Hour Exceeded:**

```json
{
  "error": "Peak hour restriction: Maximum reservation duration is 90 minutes during this time",
  "details": {
    "isPeakHour": true,
    "maxDuration": 90
  }
}
```

**No Tables Available:**

```json
{
  "error": "No available table for the requested time slot",
  "details": {
    "suggestions": ["Try 30 minutes earlier", "Try 30 minutes later"],
    "addToWaitlist": true,
    "waitlistUrl": "/api/v1/waitlist"
  }
}
```

**Invalid Status Transition:**

```json
{
  "error": "Invalid status transition from completed to confirmed"
}
```

**Invalid Timezone:**

```json
{
  "error": "Validation failed",
  "details": [
    {
      "path": ["timezone"],
      "message": "Invalid IANA timezone (e.g., 'America/New_York', 'Europe/London')"
    }
  ]
}
```

---

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

### Timezone Architecture

- **Restaurants store IANA timezone** (e.g., `"America/New_York"`) for proper DST handling
- **Operating hours and peak hours** stored as local time strings (`HH:MM`) — no timezone conversion needed when configuring
- **Reservation times** stored as UTC `DateTime` in the database for consistent querying
- **Validation** converts UTC to restaurant's local time for operating hours and peak hours checks
- **date-fns-tz** library handles all timezone conversions reliably

### Why This Approach?

| Approach                   | Pros                | Cons                                                  |
| -------------------------- | ------------------- | ----------------------------------------------------- |
| ❌ Minutes from midnight   | Simple math         | No timezone support, DST issues                       |
| ❌ Store everything as UTC | Consistent storage  | Complex for operating hours that are inherently local |
| ✅ **Hybrid (current)**    | Best of both worlds | Slightly more complex implementation                  |

The hybrid approach:

- **Local times** for human-configured settings (hours, peak times)
- **UTC timestamps** for absolute moments (reservations, notifications)
- **IANA timezones** for accurate conversion between the two

### Other Technical Decisions

- **Overlap detection**: Uses interval intersection `startA < endB && startB < endA`
- **Seating optimization**: Scores tables by extra capacity (lower = better fit)
- **Redis caching**: Pattern-based invalidation for consistency
- **Waitlist**: FIFO with flexibility windows for time matching
- **Peak hours**: Per day-of-week with time ranges
- **JWT auth**: Refresh tokens stored and revokable

## Email Notifications

Sent via Brevo (commented out and used basic logging as requested):

- **Reservation Confirmation**: When created or confirmed
- **Reservation Modification**: When details changed
- **Reservation Cancellation**: When cancelled
- **Waitlist Confirmation**: When added to waitlist
- **Waitlist Notification**: When table becomes available

---

## Frontend Integration Guide

### Complete Example: Booking Flow

```typescript
// types.ts
interface Restaurant {
  id: number;
  name: string;
  timezone: string;  // e.g., "America/New_York"
  openingTime: string;  // e.g., "10:00"
  closingTime: string;  // e.g., "22:00"
}

interface TimeSlot {
  start: string;  // ISO 8601 UTC
  isPeakHour: boolean;
  maxDuration?: number;
}

// utils/time.ts
/**
 * Convert a local date/time selection to UTC for API calls
 */
function localToUTC(
  date: Date,          // Local date object
  timeString: string,  // "HH:MM" format
  timezone: string     // Restaurant's IANA timezone
): string {
  const [hours, minutes] = timeString.split(':').map(Number);

  // Create date in the specified timezone
  const localDateTime = new Date(date);
  localDateTime.setHours(hours, minutes, 0, 0);

  // For proper timezone handling, use a library like date-fns-tz
  // This is a simplified example
  return localDateTime.toISOString();
}

/**
 * Format UTC datetime for display in restaurant's local timezone
 */
function formatForDisplay(
  utcString: string,
  timezone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = new Date(utcString);
  return date.toLocaleString('en-US', {
    timeZone: timezone,
    ...options
  });
}

// Example usage in React component
function BookingForm({ restaurant }: { restaurant: Restaurant }) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>('18:00');
  const [partySize, setPartySize] = useState<number>(2);
  const [duration, setDuration] = useState<number>(90);

  // Generate time slots based on restaurant hours
  const generateTimeSlots = (): string[] => {
    const slots: string[] = [];
    const [openHour, openMin] = restaurant.openingTime.split(':').map(Number);
    const [closeHour, closeMin] = restaurant.closingTime.split(':').map(Number);

    let currentMinutes = openHour * 60 + openMin;
    const closeMinutes = closeHour * 60 + closeMin;

    while (currentMinutes + duration <= closeMinutes) {
      const h = Math.floor(currentMinutes / 60);
      const m = currentMinutes % 60;
      slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
      currentMinutes += 30; // 30-minute intervals
    }
    return slots;
  };

  const handleSubmit = async () => {
    // Convert local selection to UTC for API
    const dateTimeUTC = localToUTC(selectedDate, selectedTime, restaurant.timezone);

    const response = await fetch('/api/v1/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantId: restaurant.id,
        customerName: 'John Doe',
        phone: '555-123-4567',
        partySize,
        dateTime: dateTimeUTC,  // Always send UTC
        durationMinutes: duration
      })
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 409) {
        // No tables available - show waitlist option
        console.log('Suggestions:', result.details.suggestions);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Date picker - shows local dates */}
      <input
        type="date"
        value={selectedDate.toISOString().split('T')[0]}
        onChange={(e) => setSelectedDate(new Date(e.target.value))}
      />

      {/* Time selector - shows local times based on restaurant hours */}
      <select value={selectedTime} onChange={(e) => setSelectedTime(e.target.value)}>
        {generateTimeSlots().map(time => (
          <option key={time} value={time}>
            {formatTime12Hour(time)} {/* Convert "18:00" to "6:00 PM" */}
          </option>
        ))}
      </select>

      <p>Restaurant timezone: {restaurant.timezone}</p>
    </form>
  );
}

// Displaying existing reservations
function ReservationCard({ reservation, restaurant }: Props) {
  // API returns UTC, display in restaurant's local time
  const displayTime = formatForDisplay(
    reservation.startTime,
    restaurant.timezone,
    { hour: '2-digit', minute: '2-digit', hour12: true }
  );

  const displayDate = formatForDisplay(
    reservation.startTime,
    restaurant.timezone,
    { weekday: 'long', month: 'long', day: 'numeric' }
  );

  return (
    <div>
      <p>{displayDate}</p>
      <p>{displayTime}</p>
    </div>
  );
}
```

### Recommended Libraries

| Library         | Purpose                                   | Install                   |
| --------------- | ----------------------------------------- | ------------------------- |
| **date-fns-tz** | Timezone conversion                       | `npm install date-fns-tz` |
| **luxon**       | Alternative date library with built-in TZ | `npm install luxon`       |
| **dayjs**       | Lightweight with timezone plugin          | `npm install dayjs`       |

### Using date-fns-tz (Recommended)

```typescript
import { zonedTimeToUtc, utcToZonedTime, format } from "date-fns-tz";

// Convert user's local selection to UTC for API
const userSelectedLocal = new Date(2026, 0, 17, 18, 30); // 6:30 PM
const timezone = "America/New_York";
const utcDate = zonedTimeToUtc(userSelectedLocal, timezone);
const isoString = utcDate.toISOString(); // Send this to API

// Convert API response (UTC) to display in restaurant's timezone
const apiResponse = "2026-01-17T23:30:00.000Z";
const localDate = utcToZonedTime(new Date(apiResponse), timezone);
const displayString = format(localDate, "h:mm a", { timeZone: timezone }); // "6:30 PM"
```

---

## Project Structure

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

- [x] ~~Add timezone support for restaurants~~ ✅ Completed
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

---

## Quick Reference

### Time Formats Cheat Sheet

| Where                              | Format       | Example                      | Timezone |
| ---------------------------------- | ------------ | ---------------------------- | -------- |
| Restaurant openingTime/closingTime | `HH:MM`      | `"10:00"`                    | Local    |
| Peak hours startTime/endTime       | `HH:MM`      | `"18:00"`                    | Local    |
| Waitlist preferredTime             | `HH:MM`      | `"19:30"`                    | Local    |
| Reservation dateTime (request)     | ISO 8601     | `"2026-01-17T23:30:00.000Z"` | UTC      |
| Reservation startTime (response)   | ISO 8601     | `"2026-01-17T23:30:00.000Z"` | UTC      |
| Date-only fields                   | `YYYY-MM-DD` | `"2026-01-17"`               | N/A      |

### Day of Week Values

| Value | Day       |
| ----- | --------- |
| 0     | Sunday    |
| 1     | Monday    |
| 2     | Tuesday   |
| 3     | Wednesday |
| 4     | Thursday  |
| 5     | Friday    |
| 6     | Saturday  |

### Reservation Status Flow

```
┌─────────┐     ┌───────────┐     ┌───────────┐
│ pending │ ──▶ │ confirmed │ ──▶ │ completed │
└─────────┘     └───────────┘     └───────────┘
     │               │
     ▼               ▼
┌───────────────────────┐
│      cancelled        │
└───────────────────────┘
```

### Waitlist Status Flow

```
┌─────────┐     ┌──────────┐     ┌───────────┐
│ waiting │ ──▶ │ notified │ ──▶ │ converted │
└─────────┘     └──────────┘     └───────────┘
     │               │
     ▼               ▼
┌─────────┐     ┌─────────┐
│ expired │     │cancelled│
└─────────┘     └─────────┘
```

---

## Scaling Considerations

- Redis for rate-limiting
- Message queues for async email sending
- Read replicas for heavy read workloads
- Horizontal scaling of app containers behind a load balancer

---

## Database Schema

### Core Models

```
Restaurant
├── id: Int (PK)
├── name: String (unique)
├── timezone: String (default: "UTC")  // IANA timezone
├── openingTime: String                 // HH:MM local time
├── closingTime: String                 // HH:MM local time
├── totalTables: Int?
├── createdAt: DateTime
└── updatedAt: DateTime

Table
├── id: Int (PK)
├── restaurantId: Int (FK)
├── number: Int
├── capacity: Int
└── (unique: restaurantId + number)

Reservation
├── id: Int (PK)
├── restaurantId: Int (FK)
├── tableId: Int (FK)
├── userId: String? (FK)
├── customerName: String
├── phone: String
├── partySize: Int
├── startTime: DateTime                 // UTC
├── durationMinutes: Int
├── status: ReservationStatus
├── createdAt: DateTime
└── updatedAt: DateTime

WaitlistEntry
├── id: Int (PK)
├── restaurantId: Int (FK)
├── userId: String? (FK)
├── customerName: String
├── email: String?
├── phone: String
├── partySize: Int
├── preferredDate: DateTime             // UTC (date only)
├── preferredTime: String               // HH:MM local time
├── flexibilityMins: Int (default: 60)
├── durationMinutes: Int
├── status: WaitlistStatus
├── notifiedAt: DateTime?
├── expiresAt: DateTime?
├── createdAt: DateTime
└── updatedAt: DateTime

PeakHours
├── id: Int (PK)
├── restaurantId: Int (FK)
├── dayOfWeek: Int (0-6)
├── startTime: String                   // HH:MM local time
├── endTime: String                     // HH:MM local time
├── maxDurationMinutes: Int
├── isActive: Boolean (default: true)
├── createdAt: DateTime
└── updatedAt: DateTime
```

### Enums

```typescript
ReservationStatus: "pending" | "confirmed" | "completed" | "cancelled";
WaitlistStatus: "waiting" | "notified" | "converted" | "expired" | "cancelled";
UserRole: "SUPER_ADMIN" | "OWNER" | "MANAGER" | "STAFF" | "CUSTOMER";
StaffRole: "OWNER" | "MANAGER" | "HOST" | "SERVER";
```

---

## Migration Notes

After updating the schema, run:

```bash
# Generate new Prisma client
npx prisma generate

# Create and apply migration
npx prisma migrate dev --name timezone_support

# Or for production
npx prisma migrate deploy
```

### Data Migration (if upgrading from minutes-based times)

If you have existing data with the old `openingTimeMinutes`/`closingTimeMinutes` format, you'll need to migrate:

```sql
-- Example migration script (adjust as needed)
UPDATE "Restaurant"
SET
  "openingTime" = LPAD(("openingTimeMinutes" / 60)::TEXT, 2, '0') || ':' || LPAD(("openingTimeMinutes" % 60)::TEXT, 2, '0'),
  "closingTime" = LPAD(("closingTimeMinutes" / 60)::TEXT, 2, '0') || ':' || LPAD(("closingTimeMinutes" % 60)::TEXT, 2, '0'),
  "timezone" = 'UTC';
```
