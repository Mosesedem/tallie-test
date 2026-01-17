# Tallie Restaurant Reservation API

Simple REST API for managing restaurants, tables, and reservations — with authentication, roles, and permissions.

## Stack

- Node.js + Express
- TypeScript
- Prisma ORM + Postgres
- Jest + Supertest (tests)
- JWT Authentication + RBAC

## Setup

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

# JWT configuration
JWT_SECRET=your_access_token_secret
JWT_REFRESH_SECRET=your_refresh_token_secret
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Server
PORT=3000
```

Notes:

- Prisma is configured for Postgres. See `prisma.config.ts` and `src/prisma.ts`.
- The Prisma client is generated under `generated/prisma` and used throughout the app.

## API Endpoints

All endpoints are under the `/api/v1` prefix.

### Restaurants

- POST /api/v1/restaurants
  - Body: `{ name, openingTime:"HH:MM", closingTime:"HH:MM", totalTables? }`
  - Creates a restaurant.

- POST /api/v1/restaurants/:id/tables
  - Body: `{ number, capacity }`
  - Adds a table to a restaurant.

- GET /api/v1/restaurants/:id
  - Returns restaurant details and tables.

- GET /api/v1/restaurants/:id/availability
  - Query: `dateTime=ISO&durationMinutes&partySize`
  - Returns available tables for the given slot and party size.

- GET /api/v1/restaurants/:id/reservations
  - Query: `date=YYYY-MM-DD`
  - Lists all reservations for that date.

- GET /api/v1/restaurants/:id/available-slots
  - Query: `date=YYYY-MM-DD&durationMinutes&partySize&stepMinutes?`
  - Returns all slots inside operating hours with at least one fitting table.

### Reservations

- POST /api/v1/reservations
  - Body: `{ restaurantId, customerName, phone, partySize, dateTime, durationMinutes, tableId? }`
  - Creates a reservation. If `tableId` is omitted, assigns the smallest available fitting table.

- PATCH /api/v1/reservations/:id
  - Body: optional fields `{ customerName?, phone?, partySize?, dateTime?, durationMinutes?, tableId?, status? }`
  - Validates operating hours, table capacity, and overlaps.
  - Status transitions allowed: `pending→confirmed→completed`, `*→cancelled` (cannot change from `completed`/`cancelled`).

- POST /api/v1/reservations/:id/cancel
  - Cancels reservation (sets status to `cancelled`).

### Authentication

Auth routes are prefixed with `/api/v1/auth`.

- POST /api/v1/auth/register
  - Body: `{ email, password, firstName, lastName, phone? }`
  - Registers a new user (role defaults to `CUSTOMER`).

- POST /api/v1/auth/login
  - Body: `{ email, password }`
  - Returns `{ accessToken, refreshToken, user }`.

- POST /api/v1/auth/refresh
  - Body: `{ refreshToken }`
  - Returns new `accessToken`.

- POST /api/v1/auth/forgot-password
  - Body: `{ email }` (mocked flow).

- POST /api/v1/auth/reset-password
  - Body: `{ token, newPassword }` (mocked flow).

- POST /api/v1/auth/logout
  - Revokes current refresh token.

- POST /api/v1/auth/logout-all
  - Revokes all refresh tokens for the authenticated user. Requires `Authorization: Bearer <accessToken>`.

- POST /api/v1/auth/change-password
  - Body: `{ currentPassword, newPassword }`. Requires authentication.

- GET /api/v1/auth/me
  - Returns authenticated user profile.

## Business Rules

- Reservations only during operating hours.
- Parties must fit table capacity.
- No overlapping reservations per table.
- Available slots computed at `stepMinutes` intervals (default 30).
- Authentication and RBAC:
  - User roles: `SUPER_ADMIN`, `OWNER`, `MANAGER`, `STAFF`, `CUSTOMER`.
  - Staff roles: `OWNER`, `MANAGER`, `HOST`, `SERVER`.
  - Permissions enforced for restaurant-scoped actions via JWT payload.

## Tests

```bash
npm test
```

- Uses `DATABASE_URL_TEST` if provided (see `jest.setup.ts`).
- Automatically resets migrations before running tests (`prisma migrate reset --force`).

## Design Decisions

- Opening/closing hours stored as minutes-from-midnight for efficient comparisons.
- Overlap detection uses interval intersection: `startA < endB && startB < endA`.
- Auto-assignment picks the smallest capacity table that fits to optimize seating.
- Prisma Postgres with indexes on `restaurantId`/`startTime` and `tableId`/`startTime` for reservation queries.
- JWT-based auth; refresh tokens persisted and revokable.

## Limitations / Improvements

- Email delivery for password flows not implemented (mocked endpoints).
- Waitlist and peak-hour rules not implemented.
- Consider unifying API route prefix (e.g., `/api/v1`) for all resources.
- Add rate limiting and request validation error standardization.
- Dockerization and CI pipeline can be added.

## Scaling Thoughts

- Postgres with proper indexing (already applied for reservations).
- Redis for availability caching and rate-limiting.
- Partition reservations by `restaurantId` for high volume.
- Message queues for confirmations and async operations.
