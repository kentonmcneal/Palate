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

// ---------------------------------------------------------------------------
// Fixtures below are REAL subject lines from a live inbox, not invented ones.
// The previous Toast pattern looked for "receipt from X" and Toast never says
// "from", so every genuine receipt was missed — which is exactly the failure
// invented fixtures cannot catch.
// ---------------------------------------------------------------------------

const D = new Date("2026-08-22T18:45:21Z");

function toast(subject: string, text = "") {
  return parseReceipt({ from: "no-reply@toasttab.com", subject, text, internalDate: D });
}
function olo(subject: string, text = "") {
  return parseReceipt({ from: "noreply@olo.com", subject, text, internalDate: D });
}
function square(subject: string, text = "") {
  return parseReceipt({ from: "messenger@messaging.squareup.com", subject, text, internalDate: D });
}

describe("Toast — real subjects", () => {
  it('reads "<Name> - Order Received"', () => {
    expect(toast("Almyra - Order Received")?.restaurantName).toBe("Almyra");
    expect(toast("K'Far Philadelphia - Order Received")?.restaurantName).toBe("K'Far Philadelphia");
  });

  it("strips the location Toast appends after a separator", () => {
    // The address suffix makes the Places lookup worse, not better.
    expect(toast("Dough Head Pizza | 833 Wharton St - Order Received")?.restaurantName)
      .toBe("Dough Head Pizza");
    expect(toast("Order & Pay Receipt for $93.89 at La’Mode BK - 1401 Bedford Avenue")?.restaurantName)
      .toBe("La’Mode BK");
  });

  it("reads all three receipt-for-amount-at phrasings", () => {
    expect(toast("Order & Pay Receipt for $29.52 at Kick Axe Throwing - Philly")?.restaurantName)
      .toBe("Kick Axe Throwing");
    expect(toast("Email Receipt for $17.28 at Puttshack Philadelphia - Philadelphia")?.restaurantName)
      .toBe("Puttshack Philadelphia");
    expect(toast("Online Order Receipt for $42.48 at Pietro's Pizza (Philadelphia) - 1714 Walnut Street")?.restaurantName)
      .toBe("Pietro's Pizza (Philadelphia)");
  });

  it("ignores Toast marketing and policy mail", () => {
    // These arrive from the same sender and name no venue.
    expect(toast("Your Birthday treat is waiting")).toBeNull();
    expect(toast("We’ve updated our Guest Terms of Service")).toBeNull();
  });

  it("ignores the post-order survey, which would double-count a visit", () => {
    // "How was your order from X?" follows a receipt we already parsed.
    expect(toast("How was your order from Pietro's Pizza (Philadelphia)?")).toBeNull();
  });
});

describe("Olo — subject names the operator, not the restaurant", () => {
  it("takes the venue from the body when the subject names a hospitality group", () => {
    // Real message: subject said "Wolf River Hospitality Group", but the meal
    // was at PYRO'S – Cordova.
    const r = olo(
      "Wolf River Hospitality Group - Order Received",
      "PYRO'S – CORDOVA 2286 N. Germantown Parkway, Cordova, TN 38016\n(901) 207-1198",
    );
    expect(r?.restaurantName).toBe("PYRO'S – CORDOVA");
  });

  it("ignores account and adjustment mail", () => {
    expect(olo("Thanks for creating an Olo account!", "Hello from Olo!")).toBeNull();
    expect(olo("Order Adjustment", "This email confirms a payment adjustment")).toBeNull();
  });
});

describe("Square — the real sender is a subdomain", () => {
  it("parses mail from messaging.squareup.com", () => {
    // The sender list previously held messenger@squareup.com, so a from: on
    // that exact address could miss every real receipt.
    expect(square("Receipt from Love Is The Currency #BUAB")?.restaurantName)
      .toContain("Love Is The Currency");
    expect(square("Your order from Brezerk")?.restaurantName).toBe("Brezerk");
  });
});
