import request from "supertest";
import app from "../src/app";
import { prisma } from "../src/prisma";

beforeAll(async () => {
  // Reset DB
  await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS Reservation;");
  await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS Table;");
  await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS Restaurant;");
  // Apply migrations via Prisma schema programmatically
  // In tests, ensure tables exist by running a simple migration-like creation using Prisma
  // Instead of raw SQL for portability, we'll rely on migrating in dev and use the same sqlite file for tests.
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Restaurant reservation API", () => {
  let restaurantId: number;
  let tableId: number;

  test("Create restaurant", async () => {
    const res = await request(app)
      .post("/restaurants")
      .send({
        name: "Tallie Place",
        openingTime: "10:00",
        closingTime: "22:00",
        totalTables: 10,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    restaurantId = res.body.id;
  });

  test("Add table", async () => {
    const res = await request(app)
      .post(`/restaurants/${restaurantId}/tables`)
      .send({ number: 1, capacity: 4 });
    expect(res.status).toBe(201);
    expect(res.body.capacity).toBe(4);
    tableId = res.body.id;
  });

  test("Create reservation and prevent overlap", async () => {
    const start = new Date();
    start.setHours(19, 0, 0, 0); // 7 PM today
    const res1 = await request(app).post("/reservations").send({
      restaurantId,
      customerName: "Alice",
      phone: "123456",
      partySize: 4,
      dateTime: start.toISOString(),
      durationMinutes: 120,
      tableId,
    });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post("/reservations")
      .send({
        restaurantId,
        customerName: "Bob",
        phone: "7891011",
        partySize: 4,
        dateTime: new Date(start.getTime() + 60 * 60 * 1000).toISOString(), // 8 PM overlaps
        durationMinutes: 60,
        tableId,
      });
    expect(res2.status).toBe(409);
  });

  test("Capacity check fails for oversized party", async () => {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const res = await request(app).post("/reservations").send({
      restaurantId,
      customerName: "Charlie",
      phone: "5555555",
      partySize: 6, // capacity 4 table cannot fit
      dateTime: start.toISOString(),
      durationMinutes: 60,
      tableId,
    });
    expect(res.status).toBe(400);
  });

  test("Modify reservation time to overlap should fail", async () => {
    // Create a second reservation on the same table at 8 PM for 60m
    const base = new Date();
    base.setHours(20, 0, 0, 0); // 8 PM
    const createSecond = await request(app).post("/reservations").send({
      restaurantId,
      customerName: "Dora",
      phone: "000111",
      partySize: 4,
      dateTime: base.toISOString(),
      durationMinutes: 60,
    });
    expect(createSecond.status).toBe(201);

    // Fetch first reservation id by querying the day's reservations
    const dateStr = new Date().toISOString().slice(0, 10);
    const list = await request(app)
      .get(`/restaurants/${restaurantId}/reservations`)
      .query({ date: dateStr });
    expect(list.status).toBe(200);
    const first = list.body.find((r: any) => r.customerName === "Alice");
    expect(first).toBeDefined();

    // Attempt to move first to 7:30 PM for 2 hours, overlapping with 8 PM reservation
    const patch = await request(app)
      .patch(`/reservations/${first.id}`)
      .send({
        dateTime: new Date(new Date().setHours(19, 30, 0, 0)).toISOString(),
        durationMinutes: 120,
      });
    expect(patch.status).toBe(409);
  });

  test("Cancel reservation changes status", async () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const list = await request(app)
      .get(`/restaurants/${restaurantId}/reservations`)
      .query({ date: dateStr });
    const target =
      list.body.find((r: any) => r.customerName === "Bob") ?? list.body[0];
    const cancel = await request(app)
      .post(`/reservations/${target.id}/cancel`)
      .send();
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
  });
});
