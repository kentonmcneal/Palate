// The redirect URI is the whole bug. Google's iOS OAuth clients accept the
// reversed client id with a SINGLE slash before the path; expo's
// makeRedirectUri emits two, which makes the path an authority and gets the
// request rejected before the user ever sees a consent screen.
//
// Reproduced here as a pure string contract so a future refactor cannot
// silently reintroduce it — the failure is invisible in code review and only
// shows up as "Error 400: invalid_request" on a real device.

const CLIENT_ID = "239407939279-g4v2vualn6mqlljtkt53vi0k2mhkuqtu.apps.googleusercontent.com";

function reversedClientId(clientId: string): string {
  return clientId.replace(/^(.+)\.apps\.googleusercontent\.com$/, "com.googleusercontent.apps.$1");
}

function redirectUriFor(clientId: string): string {
  return `${reversedClientId(clientId)}:/oauth2redirect`;
}

describe("Google iOS OAuth redirect", () => {
  it("reverses the client id into the registered scheme", () => {
    expect(reversedClientId(CLIENT_ID))
      .toBe("com.googleusercontent.apps.239407939279-g4v2vualn6mqlljtkt53vi0k2mhkuqtu");
  });

  it("uses exactly one slash before the path", () => {
    const uri = redirectUriFor(CLIENT_ID);
    expect(uri).toBe(
      "com.googleusercontent.apps.239407939279-g4v2vualn6mqlljtkt53vi0k2mhkuqtu:/oauth2redirect",
    );
    // The two-slash form is what expo's helper produced and what Google rejects.
    expect(uri).not.toContain("://");
  });

  it("matches the scheme registered in app.json CFBundleURLSchemes", () => {
    // If these drift, Google accepts the request and iOS never hands the code
    // back — a silent failure worse than the loud one.
    const appJson = require("../../app.json");
    const schemes: string[] = appJson.expo.ios.infoPlist.CFBundleURLTypes
      .flatMap((t: { CFBundleURLSchemes: string[] }) => t.CFBundleURLSchemes);
    expect(schemes).toContain(reversedClientId(CLIENT_ID));
  });
});
