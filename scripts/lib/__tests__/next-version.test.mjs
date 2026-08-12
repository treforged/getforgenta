import { describe, expect, it } from "vitest";
import {
  formatVersion,
  isCustomerRelease,
  nextVersion,
  parseVersion,
  underScheme,
  violations,
} from "../next-version.mjs";

const next = (v, kind) => formatVersion(nextVersion(v, kind));

describe("the 9/99 version scheme", () => {
  it("counts in-between builds in the patch", () => {
    expect(next("6.0.0", "patch")).toBe("6.0.1");
    expect(next("6.0.1", "patch")).toBe("6.0.2");
  });

  it("a customer release bumps the minor and clears the patch", () => {
    // The whole point: 6.0.1 and 6.0.2 accumulate, and 6.1.0 is what ships
    // carrying both.
    expect(next("6.0.7", "minor")).toBe("6.1.0");
  });

  it("99 is a legal patch, and 100 rolls the minor", () => {
    expect(next("6.0.98", "patch")).toBe("6.0.99");
    expect(next("6.0.99", "patch")).toBe("6.1.0");
  });

  it("9 is a legal minor, and 10 rolls the major", () => {
    expect(next("6.8.0", "minor")).toBe("6.9.0");
    expect(next("6.9.0", "minor")).toBe("7.0.0");
  });

  it("the last version of a major is x.9.99, and the next is (x+1).0.0", () => {
    // The one a person gets wrong by hand, months from now, in a hurry.
    expect(next("6.9.99", "patch")).toBe("7.0.0");
  });

  it("a major only ever moves because the minor carried", () => {
    // There is no "major" kind. A major is a consequence of ten customer
    // releases, not a decision taken separately from them.
    expect(() => nextVersion("6.0.0", "major")).toThrow(/patch.*minor/);
  });
});

describe("what goes to customers", () => {
  it("a minor release is published and an in-between build is not", () => {
    expect(isCustomerRelease("6.1.0")).toBe(true);
    expect(isCustomerRelease("6.1.1")).toBe(false);
    expect(isCustomerRelease("6.0.99")).toBe(false);
  });
});

describe("versions that predate the scheme", () => {
  it("today's version is not under it", () => {
    // The app is at 2.56.0 and 56 is not a legal minor here. Applying the carry
    // rules to it would turn a routine patch bump into 3.0.0 and reset a series
    // customers can see.
    expect(underScheme("2.56.0")).toBe(false);
    expect(() => nextVersion("2.56.0", "patch")).toThrow(/predates it/);
  });

  it("an old version is not reported as violating caps it was never under", () => {
    expect(violations("2.56.0")).toEqual([]);
  });

  it("everything before the scheme counts as a customer release", () => {
    expect(isCustomerRelease("2.56.0")).toBe(true);
  });
});

describe("catching a version edited by hand", () => {
  it("names a minor past the cap", () => {
    expect(violations("6.10.0")).toEqual([expect.stringMatching(/minor is 10/)]);
  });

  it("names a patch past the cap", () => {
    expect(violations("6.0.100")).toEqual([expect.stringMatching(/patch is 100/)]);
  });

  it("names both when both are wrong", () => {
    expect(violations("7.12.150")).toHaveLength(2);
  });

  it("a legal version has nothing to say about it", () => {
    expect(violations("6.9.99")).toEqual([]);
  });
});

describe("reading a version string", () => {
  it("parses the three parts", () => {
    expect(parseVersion("6.0.1")).toEqual({ major: 6, minor: 0, patch: 1 });
  });

  it("refuses anything that is not three numbers, rather than guessing", () => {
    for (const bad of ["6.0", "v6.0.1", "6.0.1-beta", "", null, undefined, "6.0.1.2"]) {
      expect(() => parseVersion(bad)).toThrow(/not a version/);
    }
  });
});
