# Tallie Restaurant Reservation API

Simple REST API for managing restaurants, tables, and reservations.

## Stack

- Node.js + Express
- TypeScript
- Prisma ORM + SQLite
- Jest + Supertest (tests)

## Setup

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run generate

# Apply database migrations
npm run migrate

# Start dev server
npm run dev
```

Server listens on port 3000 by default.

## Environment

- Configure `DATABASE_URL` in `.env` (defaults to `file:./dev.db`).

## API Endpoints

- POST /restaurants
  - Body: `{ name, openingTime:"HH:MM", closingTime:"HH:MM", totalTables? }`
  - Creates a restaurant.

- POST /restaurants/:id/tables
  - Body: `{ number, capacity }`
  - Adds a table to a restaurant.

- GET /restaurants/:id
  - Returns restaurant details and tables.

- GET /restaurants/:id/availability
  - Query: `dateTime=ISO&durationMinutes&partySize`
  - Returns available tables for the given slot and party size.

- GET /restaurants/:id/reservations
  - Query: `date=YYYY-MM-DD`
  - Lists all reservations for that date.

- GET /restaurants/:id/available-slots
  - Query: `date=YYYY-MM-DD&durationMinutes&partySize&stepMinutes?`
  - Returns all slots inside operating hours with at least one fitting table.

- POST /reservations
  - Body: `{ restaurantId, customerName, phone, partySize, dateTime, durationMinutes, tableId? }`
  - Creates a reservation. If `tableId` is omitted, assigns the smallest available fitting table.

- PATCH /reservations/:id
  - Body: optional fields `{ customerName?, phone?, partySize?, dateTime?, durationMinutes?, tableId?, status? }`
  - Modifies reservation with full validation (hours, capacity, overlaps). Status transitions allowed: `pending→confirmed→completed`, `*→cancelled` except from `completed/cancelled`.

- POST /reservations/:id/cancel
  - Cancels reservation (sets status to `cancelled`).

## Business Rules

- Reservations only during operating hours.
- Parties must fit table capacity.
- No overlapping reservations per table.
- Available slots computed at `stepMinutes` intervals (default 30).

## Tests

```bash
npm test
```

- Uses a separate SQLite `test.db` and resets migrations before running.

## Design Decisions

- Opening/closing hours stored as minutes-from-midnight for efficient comparisons.
- Overlap detection uses interval intersection: `startA < endB && startB < endA`.
- Auto-assignment picks the smallest capacity table that fits to optimize seating.

## Limitations / Improvements

- No authentication or multi-tenant separation.
- Peak-hour rules and waitlist not implemented.
- Redis caching for availability could reduce repeated computations.
- Add modify/cancel reservation endpoints and reservation statuses lifecycle.
- Dockerization and CI pipeline can be added.

## Scaling Thoughts

- For multiple restaurants and higher load:
  - Switch to Postgres with proper indexing (restaurantId, startTime).
  - Use Redis for availability caching and rate-limiting.
  - Apply sharding or partitioning by restaurantId for reservations.
  - Employ message queues for confirmation and async operations.
