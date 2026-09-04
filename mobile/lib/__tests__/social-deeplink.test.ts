import { Linking } from "react-native";
import { openInstagram } from "../social";

// The deep link is the half of this that can fail silently. `canOpenURL` on a
// custom scheme returns false unless the scheme is declared in
// LSApplicationQueriesSchemes, and it can also throw; either way the user must
// still land on the profile, in the browser. A tap that does nothing is the
// only unacceptable outcome.
describe("openInstagram", () => {
  const canOpen = jest.spyOn(Linking, "canOpenURL");
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);

  beforeEach(() => { canOpen.mockReset(); open.mockClear(); });

  it("opens the app when the scheme is available", async () => {
    canOpen.mockResolvedValue(true);
    await openInstagram("kenton");
    expect(open).toHaveBeenCalledWith("instagram://user?username=kenton");
  });

  it("falls back to the web profile when the app is absent", async () => {
    canOpen.mockResolvedValue(false);
    await openInstagram("kenton");
    expect(open).toHaveBeenCalledWith("https://instagram.com/kenton");
  });

  it("falls back when canOpenURL throws rather than leaving the tap dead", async () => {
    canOpen.mockRejectedValue(new Error("nope"));
    await openInstagram("kenton");
    expect(open).toHaveBeenCalledWith("https://instagram.com/kenton");
  });

  it("escapes a handle so it cannot alter the query", async () => {
    canOpen.mockResolvedValue(true);
    await openInstagram("a b&x=1");
    expect(open).toHaveBeenCalledWith("instagram://user?username=a%20b%26x%3D1");
  });
});
