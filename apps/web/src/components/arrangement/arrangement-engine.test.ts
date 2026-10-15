import { describe, expect, it } from "vitest";

import {
  assignLots,
  dealInRounds,
  learnFrom,
  ownerPriority,
  productScore,
  proposeArrangement,
  type DayToPropose,
  type HistoryDay,
} from "./arrangement-engine";

// The rule set is the owner's own (Lior's spec of 2026-09-24 and the meeting
// of 2026-10-03), with the learning that the proof of concept measured best on
// October's real arrangements. Most cases below are that proof of concept's
// tests, carried over with the same names and numbers
// (Ori/arrangement-poc/poc/test_rules.py and test_engine.py); the expected
// values come from the owner's worked examples or were worked out by hand.

const FAMILY_OF = { "חציל סיטון": "חציל", "חציל בלאדי": "חציל", "כרוב אלוף": "כרוב" };
const PRODUCT = "חציל סיטון";

function day(
  date: string,
  {
    supply = {},
    orders = {},
    recorded = {},
  }: Partial<Pick<HistoryDay, "supply" | "orders" | "recorded">> = {},
): HistoryDay {
  return { date, supply, orders, recorded };
}

/** Every customer in these cases has traded for years unless a case says otherwise. */
const VETERAN = "2025-01-01";

describe("productScore", () => {
  it.each([
    [0.65, 5],
    [0.6, 5],
    [0.59, 4],
    [0.4, 4],
    [0.35, 3],
    [0.2, 3],
    [0.1, 2],
    [0.05, 2],
    [0.04, 1],
    [0, 1],
  ])("follows the owner's share bands: %s of the days is a %s", (share, score) => {
    expect(productScore(share)).toBe(score);
  });
});

describe("ownerPriority", () => {
  it.each([
    [4.0, 5, 4.5],
    [3.4, 3, 3.2],
    [3.2, 2, 2.6],
    [3.85, 1, 2.425],
  ])("is half the general score and half the product score (%s, %s)", (general, product, want) => {
    expect(ownerPriority(general, product)).toBeCloseTo(want, 10);
  });
});

describe("dealInRounds", () => {
  const at = "2026-09-23T05:00:00Z";

  it("gives everyone exactly their order when the stock covers it", () => {
    const granted = dealInRounds(10, [
      { customerId: "טמרה", quantity: 2, rank: [4], orderedAt: at },
      { customerId: "גבאי", quantity: 1, rank: [3.2], orderedAt: at },
    ]);

    expect(granted).toEqual({ טמרה: 2, גבאי: 1 });
  });

  it("gives nobody anything when nothing was picked", () => {
    const granted = dealInRounds(0, [
      { customerId: "מ.מ שיווק", quantity: 1, rank: [3.4], orderedAt: at },
      { customerId: "טמרה", quantity: 1, rank: [4], orderedAt: at },
    ]);

    expect(granted).toEqual({ "מ.מ שיווק": 0, טמרה: 0 });
  });

  it("gives everyone one pallet before anyone gets a second", () => {
    const granted = dealInRounds(2, [
      { customerId: "טמרה", quantity: 2, rank: [4], orderedAt: at },
      { customerId: "מ.מ שיווק", quantity: 1, rank: [3], orderedAt: at },
    ]);

    expect(granted).toEqual({ טמרה: 1, "מ.מ שיווק": 1 });
  });

  it("gives the spare pallet after a full round to the higher rank", () => {
    const granted = dealInRounds(3, [
      { customerId: "טמרה", quantity: 2, rank: [4], orderedAt: at },
      { customerId: "יבולי הארבעה", quantity: 2, rank: [4.35], orderedAt: at },
    ]);

    expect(granted).toEqual({ טמרה: 1, "יבולי הארבעה": 2 });
  });

  it("settles an equal rank by the earlier order", () => {
    const granted = dealInRounds(1, [
      { customerId: "מאוחר", quantity: 1, rank: [3], orderedAt: "2026-09-23T07:30:00Z" },
      { customerId: "מוקדם", quantity: 1, rank: [3], orderedAt: "2026-09-23T06:10:00Z" },
    ]);

    expect(granted).toEqual({ מאוחר: 0, מוקדם: 1 });
  });

  it("compares a rank left to right", () => {
    const granted = dealInRounds(1, [
      { customerId: "דירוג גבוה", quantity: 1, rank: [2, 4], orderedAt: at },
      { customerId: "קיבל הרבה", quantity: 1, rank: [5, 2], orderedAt: at },
    ]);

    expect(granted).toEqual({ "דירוג גבוה": 0, "קיבל הרבה": 1 });
  });

  it("matches the owner's acceptance case: peach 1881, five ordered, three picked", () => {
    // General score and "days with peach out of 20", copied from his worked example.
    const facts: Array<[string, number, number, number]> = [
      ["ירק הגליל", 2, 4.0, 13],
      ["גבאי", 1, 3.4, 7],
      ["כחלון", 1, 3.2, 2],
      ["עטרה", 1, 3.85, 0],
    ];
    const granted = dealInRounds(
      3,
      facts.map(([customerId, quantity, general, days]) => ({
        customerId,
        quantity,
        rank: [ownerPriority(general, productScore(days / 20))],
        orderedAt: at,
      })),
    );

    // One round gives ירק הגליל, גבאי and כחלון a pallet each; the owner's
    // two-tier version gave ירק הגליל both instead. The proof of concept found
    // one round-robin closer to what he actually does.
    expect(granted).toEqual({ "ירק הגליל": 1, גבאי: 1, כחלון: 1, עטרה: 0 });
  });
});

describe("learnFrom", () => {
  it("measures a family habit as the share of the days the family sold on which the customer ordered or got it", () => {
    const { shares } = learnFrom(
      [
        day("2026-09-01", { orders: { "חציל סיטון": { א: 1 } } }),
        day("2026-09-02", {
          orders: { "חציל בלאדי": { ב: 1 } },
          recorded: { "חציל סיטון": { א: 1 } },
        }),
        day("2026-09-03", { orders: { "חציל סיטון": { ב: 2 } } }),
        day("2026-09-06", { orders: { "כרוב אלוף": { א: 1 } } }),
      ],
      FAMILY_OF,
    );

    expect(shares["א"]?.["חציל"]).toBeCloseTo(2 / 3, 10);
    expect(shares["ב"]?.["חציל"]).toBeCloseTo(2 / 3, 10);
    expect(shares["א"]?.["כרוב"]).toBe(1);
    expect(shares["ב"]?.["כרוב"]).toBeUndefined();
  });

  it("counts the days a customer was given each exact variety", () => {
    const { received } = learnFrom(
      [
        day("2026-09-01", { recorded: { "חציל סיטון": { א: 2, ב: 1 } } }),
        day("2026-09-02", { recorded: { "חציל סיטון": { א: 1 }, "חציל בלאדי": { ב: 1 } } }),
        day("2026-09-03", { orders: { "חציל סיטון": { ג: 1 } } }),
      ],
      FAMILY_OF,
    );

    expect(received).toEqual({
      א: { "חציל סיטון": 2 },
      ב: { "חציל סיטון": 1, "חציל בלאדי": 1 },
    });
  });

  it("notes who was served and who was not, each time a product that was arranged ran short", () => {
    const { shortages } = learnFrom(
      [
        // Out of date order on purpose: outcomes are kept oldest first.
        shortDay("2026-09-06", "פשה"),
        shortDay("2026-09-01", "אסף"),
        // Enough stock: teaches nothing about who comes first.
        day("2026-09-02", {
          supply: { [PRODUCT]: 5 },
          orders: { [PRODUCT]: { אסף: 1, פשה: 1 } },
          recorded: { [PRODUCT]: { אסף: 1, פשה: 1 } },
        }),
        // Short, but not arranged in the app that day: nothing to learn from.
        day("2026-09-03", { supply: { [PRODUCT]: 1 }, orders: { [PRODUCT]: { אסף: 1, פשה: 1 } } }),
      ],
      FAMILY_OF,
    );

    expect(shortages).toEqual({
      אסף: { [PRODUCT]: [1, -1] },
      פשה: { [PRODUCT]: [-1, 1] },
    });
  });
});

/** A day on which one pallet was picked, the named customers ordered one each, and `served` got it. */
function shortDay(date: string, served: string, ordered: string[] = ["אסף", "פשה"]): HistoryDay {
  return day(date, {
    supply: { [PRODUCT]: 1 },
    orders: { [PRODUCT]: Object.fromEntries(ordered.map((name) => [name, 1])) },
    recorded: { [PRODUCT]: { [served]: 1 } },
  });
}

/** One lot of PRODUCT with `available` pallets, ordered one each by `ordered` on 2026-10-20. */
function oneLotDay(
  available: number,
  ordered: Array<[string, number]>,
  orderedAt = "2026-10-20T05:00:00Z",
): DayToPropose {
  return {
    date: "2026-10-20",
    lots: [{ growerId: "מגדל", varietyId: PRODUCT, available }],
    orders: ordered.map(([customerId, quantity]) => ({
      customerId,
      varietyId: PRODUCT,
      quantity,
      orderedAt,
    })),
    arranged: [],
  };
}

function propose(
  today: DayToPropose,
  {
    history = [],
    scores = {},
    since = {},
  }: {
    history?: HistoryDay[];
    scores?: Record<string, number>;
    since?: Record<string, string>;
  } = {},
) {
  const customers = new Set([
    ...Object.keys(scores),
    ...Object.keys(since),
    ...today.orders.map((order) => order.customerId),
  ]);
  return proposeArrangement({
    day: today,
    learned: learnFrom(history, FAMILY_OF),
    familyOf: FAMILY_OF,
    customers: Object.fromEntries(
      [...customers].map((customerId) => [
        customerId,
        { generalScore: scores[customerId] ?? null, since: since[customerId] ?? VETERAN },
      ]),
    ),
  });
}

/** customer -> pallets of PRODUCT in a proposal. */
function given(lines: ReturnType<typeof propose>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of lines) {
    if (line.varietyId === PRODUCT)
      out[line.customerId] = (out[line.customerId] ?? 0) + line.quantity;
  }
  return out;
}

describe("proposeArrangement — who gets a product that runs short", () => {
  it("gives everyone their order when there is enough", () => {
    const lines = propose(
      oneLotDay(5, [
        ["א", 2],
        ["ב", 1],
      ]),
    );

    expect(given(lines)).toEqual({ א: 2, ב: 1 });
  });

  it("proposes nothing for a product nobody picked", () => {
    const today = { ...oneLotDay(0, [["א", 1]]), lots: [] };

    expect(propose(today)).toEqual([]);
  });

  it("ranks by the owner's general score and family habit when history says nothing else", () => {
    // "קבוע" orders eggplant on 65% of the days it sells: product score 5, priority 4.2.
    // "גבוה" has no habit: 0.5 × 4.0 + 0.5 × 1 = 2.5.
    const history = ["2026-09-01", "2026-09-02", "2026-09-03"].map((date, index) =>
      day(date, { orders: { "חציל בלאדי": index < 2 ? { קבוע: 1 } : { אחר: 1 } } }),
    );
    const lines = propose(
      oneLotDay(1, [
        ["גבוה", 1],
        ["קבוע", 1],
      ]),
      {
        history,
        scores: { גבוה: 4.0, קבוע: 3.4 },
      },
    );

    expect(given(lines)).toEqual({ קבוע: 1 });
  });

  it("treats a customer with no score as score one", () => {
    const lines = propose(
      {
        ...oneLotDay(1, []),
        orders: [
          {
            customerId: "לא מדורג",
            varietyId: PRODUCT,
            quantity: 1,
            orderedAt: "2026-10-20T04:00:00Z",
          },
          {
            customerId: "מדורג",
            varietyId: PRODUCT,
            quantity: 1,
            orderedAt: "2026-10-20T06:00:00Z",
          },
        ],
      },
      { scores: { מדורג: 3.0 } },
    );

    expect(given(lines)).toEqual({ מדורג: 1 });
  });

  it("gives a customer of under 30 days their general score as their product score", () => {
    // "ותיק" has the eggplant habit at 50% of days: product score 4, priority 3.5.
    // "חדש" joined on 20.09: 0.5 × 4.0 + 0.5 × 4.0 = 4.0.
    const history = [
      day("2026-09-01", { orders: { "חציל בלאדי": { ותיק: 1 } } }),
      day("2026-09-02", { orders: { "חציל בלאדי": { אחר: 1 } } }),
    ];
    const lines = propose(
      {
        ...oneLotDay(1, [
          ["חדש", 1],
          ["ותיק", 1],
        ]),
        date: "2026-10-04",
      },
      { history, scores: { חדש: 4.0, ותיק: 3.0 }, since: { חדש: "2026-09-20" } },
    );

    expect(given(lines)).toEqual({ חדש: 1 });
  });

  it("serves the customer who usually gets this exact variety ahead of a higher score", () => {
    const history = [
      ...["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"].map(
        (date) => day(date, { recorded: { [PRODUCT]: { קבוע: 1 } } }),
      ),
      day("2026-09-07", { recorded: { [PRODUCT]: { "דירוג גבוה": 1 } } }),
    ];
    const lines = propose(
      oneLotDay(1, [
        ["דירוג גבוה", 1],
        ["קבוע", 1],
      ]),
      {
        history,
        scores: { "דירוג גבוה": 4.5, קבוע: 3.0 },
      },
    );

    expect(given(lines)).toEqual({ קבוע: 1 });
  });

  it("falls back to the owner's priority when history is equal", () => {
    const lines = propose(
      {
        ...oneLotDay(1, []),
        orders: [
          {
            customerId: "נמוך",
            varietyId: PRODUCT,
            quantity: 1,
            orderedAt: "2026-10-20T04:00:00Z",
          },
          {
            customerId: "גבוה",
            varietyId: PRODUCT,
            quantity: 1,
            orderedAt: "2026-10-20T06:00:00Z",
          },
        ],
      },
      { scores: { גבוה: 4.0, נמוך: 2.0 } },
    );

    expect(given(lines)).toEqual({ גבוה: 1 });
  });
});

// Continuous learning, as the owner described it in the meeting of 2026-10-03:
// "if I change it the same way twice, the third time propose what I did".
describe("proposeArrangement — learning from the owner's corrections", () => {
  const GENERAL = { אסף: 4.5, פשה: 3.0, כבביה: 3.0, "א.צ": 3.0, חדש: 3.0 };
  const ASAF_ALWAYS = [
    shortDay("2026-09-01", "אסף"),
    shortDay("2026-09-02", "אסף"),
    shortDay("2026-09-03", "אסף"),
  ];

  function whoGetsIt(history: HistoryDay[], ordered: string[] = ["אסף", "פשה"]) {
    return given(
      propose(
        oneLotDay(
          1,
          ordered.map((name) => [name, 1]),
        ),
        { history, scores: GENERAL },
      ),
    );
  }

  it("keeps giving it to the usual customer when nobody corrected it", () => {
    expect(whoGetsIt(ASAF_ALWAYS)).toEqual({ אסף: 1 });
  });

  it("does not change the proposal after one exception", () => {
    expect(whoGetsIt([...ASAF_ALWAYS, shortDay("2026-09-06", "פשה")])).toEqual({ אסף: 1 });
  });

  it("follows the same correction made twice on the third time", () => {
    const history = [...ASAF_ALWAYS, shortDay("2026-09-06", "פשה"), shortDay("2026-09-07", "פשה")];

    expect(whoGetsIt(history)).toEqual({ פשה: 1 });
  });

  it("drops a customer replaced by a different one each time below one it knows nothing about", () => {
    const history = [
      ...ASAF_ALWAYS,
      shortDay("2026-09-06", "פשה", ["אסף", "פשה"]),
      shortDay("2026-09-07", "כבביה", ["אסף", "כבביה"]),
    ];

    expect(whoGetsIt(history, ["אסף", "חדש"])).toEqual({ חדש: 1 });
  });

  it("learns a return to the old choice as well", () => {
    const history = [
      ...ASAF_ALWAYS,
      shortDay("2026-09-06", "פשה"),
      shortDay("2026-09-07", "פשה"),
      shortDay("2026-09-08", "אסף"),
      shortDay("2026-09-09", "אסף"),
    ];

    expect(whoGetsIt(history)).toEqual({ אסף: 1 });
  });
});

describe("proposeArrangement — what is already arranged", () => {
  it("proposes only what is still owed to a customer, out of what is still free", () => {
    // "א" ordered 3 and already has 2 off the first lot, which is now empty.
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "ריק", varietyId: PRODUCT, available: 0 },
        { growerId: "מלא", varietyId: PRODUCT, available: 2 },
      ],
      orders: [
        { customerId: "א", varietyId: PRODUCT, quantity: 3, orderedAt: "2026-10-20T05:00:00Z" },
        { customerId: "ב", varietyId: PRODUCT, quantity: 2, orderedAt: "2026-10-20T05:00:00Z" },
      ],
      arranged: [{ growerId: "ריק", varietyId: PRODUCT, customerId: "א", quantity: 2 }],
    };

    // Owed: א 1, ב 2 — three wanted, two free: one each.
    expect(given(propose(today))).toEqual({ א: 1, ב: 1 });
  });

  it("leaves out of the dealing a customer whose cell on every lot with stock is already taken", () => {
    // "א" has 2 of their 3 off the only lot. A proposal does not change a saved
    // cell, so the one pallet still owed to them cannot be proposed — and the
    // free stock goes to whoever it can go to.
    const lines = propose({
      ...oneLotDay(2, [
        ["א", 3],
        ["ב", 2],
      ]),
      arranged: [{ growerId: "מגדל", varietyId: PRODUCT, customerId: "א", quantity: 2 }],
    });

    expect(given(lines)).toEqual({ ב: 2 });
  });

  it("never proposes into a cell that already holds a saved allocation", () => {
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "שמור", varietyId: PRODUCT, available: 5 },
        { growerId: "אחר", varietyId: PRODUCT, available: 1 },
      ],
      orders: [
        { customerId: "א", varietyId: PRODUCT, quantity: 3, orderedAt: "2026-10-20T05:00:00Z" },
      ],
      arranged: [{ growerId: "שמור", varietyId: PRODUCT, customerId: "א", quantity: 1 }],
    };

    // Two more are owed, but the lot with stock already has a cell for "א":
    // only the other lot can be proposed from.
    expect(propose(today)).toEqual([
      { growerId: "אחר", varietyId: PRODUCT, customerId: "א", quantity: 1 },
    ]);
  });

  it("gives nothing more to a customer who already has all they ordered", () => {
    const lines = propose({
      ...oneLotDay(4, [["א", 2]]),
      arranged: [{ growerId: "מגדל", varietyId: PRODUCT, customerId: "א", quantity: 2 }],
    });

    expect(lines).toEqual([]);
  });
});

describe("assignLots — whose lot each customer's pallets come off", () => {
  it("takes a customer's pallets from the lot with the most left, in one piece when it can", () => {
    const cells = assignLots(
      [
        { growerId: "קטן", available: 2 },
        { growerId: "גדול", available: 5 },
      ],
      [{ customerId: "א", quantity: 3 }],
    );

    expect(cells).toEqual([{ growerId: "גדול", customerId: "א", quantity: 3 }]);
  });

  it("serves the largest share first, so it is the one kept whole", () => {
    const cells = assignLots(
      [
        { growerId: "א-מגדל", available: 3 },
        { growerId: "ב-מגדל", available: 3 },
      ],
      [
        { customerId: "קטן", quantity: 1 },
        { customerId: "גדול", quantity: 3 },
      ],
    );

    expect(cells).toEqual([
      { growerId: "ב-מגדל", customerId: "גדול", quantity: 3 },
      { growerId: "א-מגדל", customerId: "קטן", quantity: 1 },
    ]);
  });

  it("splits a customer over two lots only when no lot has enough", () => {
    const cells = assignLots(
      [
        { growerId: "א-מגדל", available: 2 },
        { growerId: "ב-מגדל", available: 2 },
      ],
      [{ customerId: "א", quantity: 3 }],
    );

    expect(cells).toEqual([
      { growerId: "ב-מגדל", customerId: "א", quantity: 2 },
      { growerId: "א-מגדל", customerId: "א", quantity: 1 },
    ]);
  });

  it("skips a lot whose cell for that customer is already taken", () => {
    const cells = assignLots(
      [
        { growerId: "גדול", available: 5, takenBy: new Set(["א"]) },
        { growerId: "קטן", available: 2 },
      ],
      [{ customerId: "א", quantity: 3 }],
    );

    expect(cells).toEqual([{ growerId: "קטן", customerId: "א", quantity: 2 }]);
  });

  it("gives out no more than the lots hold", () => {
    const cells = assignLots(
      [{ growerId: "יחיד", available: 1 }],
      [
        { customerId: "א", quantity: 1 },
        { customerId: "ב", quantity: 1 },
      ],
    );

    expect(cells.reduce((sum, cell) => sum + cell.quantity, 0)).toBe(1);
  });
});

describe("proposeArrangement — the lines it returns", () => {
  it("names the grower, the product and the customer of every cell, in whole pallets", () => {
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "מגדל", varietyId: PRODUCT, available: 3 },
        { growerId: "מגדל", varietyId: "כרוב אלוף", available: 1 },
      ],
      orders: [
        { customerId: "א", varietyId: PRODUCT, quantity: 2, orderedAt: "2026-10-20T05:00:00Z" },
        { customerId: "ב", varietyId: "כרוב אלוף", quantity: 4, orderedAt: "2026-10-20T05:00:00Z" },
      ],
      arranged: [],
    };

    expect(propose(today)).toEqual([
      { growerId: "מגדל", varietyId: PRODUCT, customerId: "א", quantity: 2 },
      { growerId: "מגדל", varietyId: "כרוב אלוף", customerId: "ב", quantity: 1 },
    ]);
  });

  it("does not give a customer who ordered nothing of a product any of it", () => {
    const lines = propose(oneLotDay(9, [["א", 1]]));

    expect(lines).toEqual([{ growerId: "מגדל", varietyId: PRODUCT, customerId: "א", quantity: 1 }]);
  });
});

// Cases the first review showed were missing: each pins one rule that a
// change to the engine could otherwise break unnoticed.
describe("proposeArrangement — rules pinned after review", () => {
  it("subtracts what a customer already has, even when they can still be given more", () => {
    // X ordered 3 and has 2 off the first lot; the second lot has plenty.
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "ריק", varietyId: PRODUCT, available: 0 },
        { growerId: "מלא", varietyId: PRODUCT, available: 5 },
      ],
      orders: [
        { customerId: "X", varietyId: PRODUCT, quantity: 3, orderedAt: "2026-10-20T05:00:00Z" },
      ],
      arranged: [{ growerId: "ריק", varietyId: PRODUCT, customerId: "X", quantity: 2 }],
    };

    expect(given(propose(today))).toEqual({ X: 1 });
  });

  it("ranks how often a customer got this exact product above the owner's priority", () => {
    // A got this product 3 days; B got its sibling 6 days, which makes B's
    // family habit and priority the higher (4.5 against 2.5).
    const history = [
      ...["2026-09-01", "2026-09-02", "2026-09-03"].map((date) =>
        day(date, { recorded: { [PRODUCT]: { A: 1 } } }),
      ),
      ...["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"].map(
        (date) => day(date, { recorded: { "חציל בלאדי": { B: 1 } } }),
      ),
    ];
    const lines = propose(
      oneLotDay(1, [
        ["A", 1],
        ["B", 1],
      ]),
      {
        history,
        scores: { A: 2.0, B: 4.0 },
      },
    );

    expect(given(lines)).toEqual({ A: 1 });
  });

  it("weighs the last three shortages, not the last two", () => {
    // Last two: one each, a tie that the scores would settle for פשה.
    // Last three: אסף +1, פשה −1.
    const history = [
      shortDay("2026-09-01", "פשה"),
      shortDay("2026-09-02", "אסף"),
      shortDay("2026-09-03", "אסף"),
      shortDay("2026-09-04", "פשה"),
    ];
    const lines = propose(
      oneLotDay(1, [
        ["אסף", 1],
        ["פשה", 1],
      ]),
      {
        history,
        scores: { אסף: 3.0, פשה: 4.5 },
      },
    );

    expect(given(lines)).toEqual({ אסף: 1 });
  });

  it("does not count a day with exactly enough stock as a shortage", () => {
    const { shortages } = learnFrom(
      [
        day("2026-09-01", {
          supply: { [PRODUCT]: 2 },
          orders: { [PRODUCT]: { אסף: 1, פשה: 1 } },
          recorded: { [PRODUCT]: { אסף: 1 } },
        }),
      ],
      FAMILY_OF,
    );

    expect(shortages).toEqual({});
  });

  it("scores a customer with no score exactly as one scored 1", () => {
    // Equal in every other way, so the earlier order settles it.
    const lines = propose(
      {
        ...oneLotDay(1, []),
        orders: [
          {
            customerId: "לא מדורג",
            varietyId: PRODUCT,
            quantity: 1,
            orderedAt: "2026-10-20T04:00:00Z",
          },
          {
            customerId: "מדורג 1",
            varietyId: PRODUCT,
            quantity: 1,
            orderedAt: "2026-10-20T06:00:00Z",
          },
        ],
      },
      { scores: { "מדורג 1": 1.0 } },
    );

    expect(given(lines)).toEqual({ "לא מדורג": 1 });
  });

  it("deals whole pallets only, out of a lot with half a pallet over", () => {
    const lines = propose(
      oneLotDay(1.5, [
        ["א", 1],
        ["ב", 1],
      ]),
    );

    expect(lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(1);
  });

  it("counts a customer as new for fewer than 30 days, and not when the day they joined is unknown", () => {
    // New, a 4.0 is ranked 4.0; otherwise, with no habit, 2.5 — below "ותיק"'s 3.5.
    const history = [
      day("2026-09-01", { orders: { "חציל בלאדי": { ותיק: 1 } } }),
      day("2026-09-02", { orders: { "חציל בלאדי": { אחר: 1 } } }),
    ];
    const winner = (since: string | null) =>
      given(
        proposeArrangement({
          day: {
            ...oneLotDay(1, [
              ["חדש", 1],
              ["ותיק", 1],
            ]),
            date: "2026-10-04",
          },
          learned: learnFrom(history, FAMILY_OF),
          familyOf: FAMILY_OF,
          customers: {
            חדש: { generalScore: 4.0, since },
            ותיק: { generalScore: 3.0, since: VETERAN },
          },
        }),
      );

    expect(winner("2026-09-05")).toEqual({ חדש: 1 }); // 29 days
    expect(winner("2026-09-04")).toEqual({ ותיק: 1 }); // 30 days
    expect(winner(null)).toEqual({ ותיק: 1 });
  });

  it("puts an order with no time after every order that has one", () => {
    const lines = propose({
      ...oneLotDay(1, []),
      orders: [
        { customerId: "בלי שעה", varietyId: PRODUCT, quantity: 1, orderedAt: "" },
        {
          customerId: "עם שעה",
          varietyId: PRODUCT,
          quantity: 1,
          orderedAt: "2026-10-20T07:00:00Z",
        },
      ],
    });

    expect(given(lines)).toEqual({ "עם שעה": 1 });
  });

  it("places first the customer who can be given from the fewest lots", () => {
    // X ordered 3 and already has 1 off lot A, so only lot B is open to them;
    // Y ordered 2 and can take from either. Both lots have 2 free.
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "A", varietyId: PRODUCT, available: 2 },
        { growerId: "B", varietyId: PRODUCT, available: 2 },
      ],
      // Y is listed first: the order lines arrive in no particular order.
      orders: [
        { customerId: "Y", varietyId: PRODUCT, quantity: 2, orderedAt: "2026-10-20T06:00:00Z" },
        { customerId: "X", varietyId: PRODUCT, quantity: 3, orderedAt: "2026-10-20T05:00:00Z" },
      ],
      arranged: [{ growerId: "A", varietyId: PRODUCT, customerId: "X", quantity: 1 }],
    };

    expect(propose(today)).toEqual([
      { growerId: "B", varietyId: PRODUCT, customerId: "X", quantity: 2 },
      { growerId: "A", varietyId: PRODUCT, customerId: "Y", quantity: 2 },
    ]);
  });

  it("treats a saved cell of zero pallets as taken all the same", () => {
    const lines = propose({
      ...oneLotDay(3, [["א", 2]]),
      arranged: [{ growerId: "מגדל", varietyId: PRODUCT, customerId: "א", quantity: 0 }],
    });

    expect(lines).toEqual([]);
  });
});
