import {
  parseReceipt,
  isPlausibleName,
  nameKey,
} from "../../../supabase/functions/_shared/receipt-parser";

const DT = new Date("2026-08-14T19:30:00Z");

function msg(from: string, subject: string, text = "") {
  return parseReceipt({ from, subject, text, internalDate: DT });
}

// A parser returning the WRONG name is strictly worse than one returning
// nothing: it spends a paid Google lookup, writes a false visit, and poisons
// the taste graph every recommendation is computed from. So the negative cases
// below matter more than the positive ones.

describe("real receipts parse", () => {
  it("OpenTable", () => {
    expect(msg("no-reply@opentable.com", "Your reservation at Lilia is confirmed")?.restaurantName)
      .toBe("Lilia");
  });

  it("Resy", () => {
    expect(msg("info@resy.com", "Your reservation is confirmed at Atomix")?.restaurantName)
      .toBe("Atomix");
  });

  it("DoorDash", () => {
    expect(msg("no-reply@doordash.com", "Your DoorDash order from Sweetgreen")?.restaurantName)
      .toBe("Sweetgreen");
  });

  it("Uber Eats", () => {
    expect(msg("no-reply@order.uber.com", "Your Tuesday lunch with Joe's Pizza")?.restaurantName)
      .toBe("Joe's Pizza");
  });

  it("Square", () => {
    expect(msg("messenger@squareup.com", "Receipt from Tartine Bakery")?.restaurantName)
      .toBe("Tartine Bakery");
  });

  it("Toast", () => {
    expect(msg("receipts@toasttab.com", "Your receipt from Zahav")?.restaurantName)
      .toBe("Zahav");
  });

  it("carries the source category", () => {
    expect(msg("info@resy.com", "Reservation confirmed at Cote")?.source).toBe("reservation");
    expect(msg("noreply@grubhub.com", "Order from Han Dynasty")?.source).toBe("delivery");
    expect(msg("messenger@squareup.com", "Receipt from Elixr")?.source).toBe("pos");
  });

  it("strips trailing order scaffolding", () => {
    expect(msg("no-reply@doordash.com", "Your DoorDash order from Sweetgreen (#12345)")?.restaurantName)
      .toBe("Sweetgreen");
    expect(msg("noreply@grubhub.com", "Order from Han Dynasty | Receipt")?.restaurantName)
      .toBe("Han Dynasty");
  });
});

describe("refuses to guess", () => {
  it("does not treat a bare 'at' as a restaurant — the SevenRooms bug", () => {
    // The old pattern was /(?:at|reservation:)\s+(.+)/ which matched any "at".
    expect(msg("noreply@sevenrooms.com", "Your table is ready at 7pm")).toBeNull();
  });

  it("never names the platform itself", () => {
    expect(msg("no-reply@order.uber.com", "Receipt from Uber Eats")).toBeNull();
    expect(msg("no-reply@doordash.com", "Your DoorDash order from DoorDash")).toBeNull();
  });

  it("rejects marketing that mentions a restaurant word", () => {
    expect(msg("noreply@yelp.com", "Thanks for using Yelp!")).toBeNull();
    expect(msg("no-reply@opentable.com", "Rate your recent experience")).toBeNull();
    expect(msg("no-reply@doordash.com", "50% off your next order")).toBeNull();
  });

  it("returns null for an unknown sender rather than attempting it", () => {
    expect(msg("newsletter@somewhere.com", "Order from Lilia")).toBeNull();
  });

  it("rejects a swallowed sentence", () => {
    expect(msg("no-reply@doordash.com", "Order from the restaurant you visited last week has been delivered to your door")).toBeNull();
  });
});

describe("isPlausibleName", () => {
  it("accepts ordinary restaurant names", () => {
    for (const n of ["Lilia", "Joe's Pizza", "Han Dynasty", "The Cheesecake Factory", "Cafe Réveille"]) {
      expect(isPlausibleName(n)).toBe(true);
    }
  });

  it("rejects platforms, empties, numbers and sentences", () => {
    for (const n of ["", " ", "a", "DoorDash", "Uber Eats", "12", "-", "your order",
                     "Your reservation is confirmed and we look forward to seeing you"]) {
      expect(isPlausibleName(n)).toBe(false);
    }
  });

  it("rejects anything absurdly long", () => {
    expect(isPlausibleName("x".repeat(61))).toBe(false);
  });
});

describe("nameKey", () => {
  it("collapses punctuation so one restaurant is one key", () => {
    expect(nameKey("Joe's Pizza")).toBe(nameKey("Joes Pizza"));
    expect(nameKey("Tartine  Bakery")).toBe("tartine bakery");
  });

  it("keeps genuinely different places apart", () => {
    expect(nameKey("Lilia")).not.toBe(nameKey("Lilia Cafe"));
  });
});
