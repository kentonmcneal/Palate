import { visitPhotoPath } from "../storage-urls";

// ----------------------------------------------------------------------------
// visit-photos is a private bucket (0167). The column holds a PATH.
// ----------------------------------------------------------------------------
// It was public, and an unauthenticated caller with the anon key that ships in
// the binary could list it — and list `avatars`, which returned user UUIDs.
//
// A stored SIGNED url would have been the easy fix and the wrong one: the
// signature expires, so the row outlives it and becomes a broken image nobody
// can explain. The path is stable and gets signed on read.
// ----------------------------------------------------------------------------
describe("visitPhotoPath", () => {
  it("passes a bare path through", () => {
    expect(visitPhotoPath("abc-123/v9-1788.jpg")).toBe("abc-123/v9-1788.jpg");
  });

  it("recovers the path from a legacy PUBLIC url", () => {
    // Zero of these exist today, which is why now was the moment. A migration
    // that assumes its own table is empty is one waiting to be wrong.
    expect(visitPhotoPath(
      "https://x.supabase.co/storage/v1/object/public/visit-photos/uid/v-1.jpg",
    )).toBe("uid/v-1.jpg");
  });

  it("recovers it from a signed url, and drops the query", () => {
    expect(visitPhotoPath(
      "https://x.supabase.co/storage/v1/object/sign/visit-photos/uid/v-1.jpg?token=abc.def",
    )).toBe("uid/v-1.jpg");
  });

  it("returns null for null, empty, and somebody else's host", () => {
    expect(visitPhotoPath(null)).toBeNull();
    expect(visitPhotoPath("")).toBeNull();
    expect(visitPhotoPath("https://example.com/cat.jpg")).toBeNull();
  });

  it("does not mistake an avatars url for a meal photo", () => {
    // avatars stays a public bucket and must never be signed through here.
    expect(visitPhotoPath(
      "https://x.supabase.co/storage/v1/object/public/avatars/uid/1.jpg",
    )).toBeNull();
  });

  it("decodes a percent-encoded path", () => {
    expect(visitPhotoPath(
      "https://x.supabase.co/storage/v1/object/public/visit-photos/uid/a%20b.jpg",
    )).toBe("uid/a b.jpg");
  });
});
