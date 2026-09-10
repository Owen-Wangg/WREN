import { parsePbtRuns } from "./pbtConfig.js";

describe("pbtConfig", () => {
  it("defaults to 25 when the override is missing or blank", () => {
    expect(parsePbtRuns(undefined)).toBe(25);
    expect(parsePbtRuns("")).toBe(25);
    expect(parsePbtRuns("   ")).toBe(25);
  });

  it("accepts positive integer overrides with surrounding whitespace", () => {
    expect(parsePbtRuns("1")).toBe(1);
    expect(parsePbtRuns(" 100 ")).toBe(100);
  });

  it.each(["0", "-1", "1.5", "1e2", "abc", "9007199254740992"])(
    "defaults to 25 for invalid override %p",
    (value) => {
      expect(parsePbtRuns(value)).toBe(25);
    },
  );
});
