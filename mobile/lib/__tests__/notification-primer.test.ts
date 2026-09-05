import { primerDecision } from "../notification-primer";
import { fontFamilyForWeight } from "../../components/Text";

describe("notification primer", () => {
  it("shows once to somebody who has never been asked", () => {
    expect(primerDecision({ seen: false, granted: false })).toBe("show");
  });

  it("never shows to somebody who already said yes", () => {
    expect(primerDecision({ seen: false, granted: true })).toBe("skip");
  });

  it("never shows twice", () => {
    expect(primerDecision({ seen: true, granted: false })).toBe("skip");
  });
});

describe("Inter for every weight", () => {
  // Text.defaultProps stopped working under React 19, so every raw
  // `fontWeight` style had been falling back to the system font. The wrapper
  // maps each weight to the loaded Inter face; this pins the mapping.
  it("maps numeric and named weights to a loaded Inter face", () => {
    expect(fontFamilyForWeight(undefined)).toBe("Inter_400Regular");
    expect(fontFamilyForWeight("400")).toBe("Inter_400Regular");
    expect(fontFamilyForWeight("500")).toBe("Inter_500Medium");
    expect(fontFamilyForWeight("600")).toBe("Inter_600SemiBold");
    expect(fontFamilyForWeight("700")).toBe("Inter_700Bold");
    expect(fontFamilyForWeight("bold")).toBe("Inter_700Bold");
    expect(fontFamilyForWeight("800")).toBe("Inter_800ExtraBold");
    expect(fontFamilyForWeight(900)).toBe("Inter_800ExtraBold");
  });
});
