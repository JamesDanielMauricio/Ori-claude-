import { describe, expect, it } from "vitest";

import { formatCustomerScore, parseCustomerScore } from "./customer-score";

describe("parseCustomerScore", () => {
  it.each([
    ["1", 1],
    ["5", 5],
    ["3.5", 3.5],
    ["4.35", 4.35],
    [" 2.75 ", 2.75],
    ["5.0", 5],
    ["5.00", 5],
    ["1.0", 1],
    ["4.50", 4.5],
  ])("reads %j as a score", (typed, value) => {
    expect(parseCustomerScore(typed)).toEqual({ kind: "score", value });
  });

  it("reads a decimal comma as a decimal point", () => {
    expect(parseCustomerScore("4,35")).toEqual({ kind: "score", value: 4.35 });
  });

  it("ignores the invisible direction marks a number pasted from right-to-left text carries", () => {
    expect(parseCustomerScore("\u200e4.35\u200f")).toEqual({ kind: "score", value: 4.35 });
    expect(parseCustomerScore("\u202b3\u202c")).toEqual({ kind: "score", value: 3 });
  });

  it.each(["", "   "])("reads an empty box as no score", (typed) => {
    expect(parseCustomerScore(typed)).toEqual({ kind: "none" });
  });

  it.each([
    "0",
    "0.99",
    "5.01",
    "6",
    "-2",
    "+4",
    "05",
    ".5",
    "4.355",
    "4.3.5",
    "4 .35",
    "abc",
    "3.",
    "1e0",
    "٣",
  ])("refuses %j", (typed) => {
    expect(parseCustomerScore(typed)).toEqual({ kind: "invalid" });
  });
});

describe("formatCustomerScore", () => {
  it("shows a score without padding zeros", () => {
    expect(formatCustomerScore(4)).toBe("4");
    expect(formatCustomerScore(3.5)).toBe("3.5");
    expect(formatCustomerScore(4.35)).toBe("4.35");
  });

  it("shows nothing for a customer with no score", () => {
    expect(formatCustomerScore(null)).toBe("");
  });

  it("round-trips through parseCustomerScore", () => {
    for (const score of [1, 2.5, 4.35, 5]) {
      expect(parseCustomerScore(formatCustomerScore(score))).toEqual({
        kind: "score",
        value: score,
      });
    }
  });
});
