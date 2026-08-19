import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  displayVersion,
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
  it("the version Google Play shows today is not under it", () => {
    // 5.86, and 86 is not a legal minor here. Applying the carry rules to it
    // would produce 6.0.0 out of a routine patch bump and skip the fourteen
    // builds still between here and the changeover.
    expect(underScheme("5.86.0")).toBe(false);
    expect(() => nextVersion("5.86.0", "patch")).toThrow(/predates it/);
  });

  it("6.0.0 is the first version under it", () => {
    expect(underScheme("5.99.0")).toBe(false);
    expect(underScheme("6.0.0")).toBe(true);
  });

  it("an old version is not reported as violating caps it was never under", () => {
    // package.json says 2.56.0, the gradle fallback says 1.75 and Play says
    // 5.86. None of them are wrong under a scheme none of them were built for.
    expect(violations("5.86.0")).toEqual([]);
    expect(violations("2.56.0")).toEqual([]);
  });

  it("everything before the scheme counts as a customer release", () => {
    // True by history rather than by design: under the run-number formula every
    // build went to the store, which is the thing being changed.
    expect(isCustomerRelease("5.86.0")).toBe(true);
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

describe("the VERSION file this repo actually ships", () => {
  const declared = readFileSync(new URL("../../../VERSION", import.meta.url), "utf-8").trim();

  it("is legal under the scheme", () => {
    // The one thing a build cannot recover from, checked where it is cheap.
    expect(violations(declared)).toEqual([]);
    expect(underScheme(declared)).toBe(true);
  });

  // ⚠️ THIS USED TO ASSERT THE LITERAL "6.0.0", which made it a test that fails on every release
  // rather than on every mistake. It went red the moment VERSION was bumped to 6.1.0 for the next
  // customer push -- correct behaviour, red test -- and the bump was made after that run's suite,
  // so a red suite shipped unnoticed (2026-08-19). A test that pins a value designed to move is
  // not protecting anything; what actually matters is that the file never goes BACKWARDS past the
  // start of the scheme and never becomes illegal.
  it("is at or after the version the scheme starts from, and never before it", () => {
    const v = parseVersion(declared);
    const start = parseVersion("6.0.0");
    const rank = ({ major, minor, patch }) => major * 10_000 + minor * 100 + patch;
    expect(rank(v)).toBeGreaterThanOrEqual(rank(start));
  });
});

describe("what a person sees", () => {
  it("a release shows two parts", () => {
    expect(displayVersion("6.0.0")).toBe("6.0");
    expect(displayVersion("6.1.0")).toBe("6.1");
    expect(displayVersion("7.0.0")).toBe("7.0");
  });

  it("an in-between build keeps the third digit, which is the point of it", () => {
    // If one of these ever reaches a store listing, the extra digit is what
    // says so at a glance.
    expect(displayVersion("6.0.1")).toBe("6.0.1");
    expect(displayVersion("6.0.99")).toBe("6.0.99");
  });

  it("agrees with isCustomerRelease, always", () => {
    for (const v of ["6.0.0", "6.0.1", "6.4.0", "6.9.99", "7.0.0"]) {
      const twoPart = displayVersion(v).split(".").length === 2;
      expect(twoPart).toBe(isCustomerRelease(v));
    }
  });

  it("leaves pre-scheme versions exactly as they are", () => {
    expect(displayVersion("5.86.0")).toBe("5.86.0");
  });
});
