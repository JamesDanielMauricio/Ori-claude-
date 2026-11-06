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
  type LotToFill,
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

  it("reads a rank that is shorter than another as zeros beyond its end", () => {
    // "א" would win a tie on the id, so only the longer rank's second place can put "ב" ahead.
    const short = { customerId: "א", quantity: 1, rank: [3], orderedAt: at };
    const long = { customerId: "ב", quantity: 1, rank: [3, 1], orderedAt: at };

    expect(dealInRounds(1, [short, long])).toEqual({ א: 0, ב: 1 });
    expect(dealInRounds(1, [long, short])).toEqual({ א: 0, ב: 1 });

    // And the other way round, with the shorter rank on the later id.
    const later = { customerId: "ב", quantity: 1, rank: [3], orderedAt: at };
    const earlier = { customerId: "א", quantity: 1, rank: [3, 0.5], orderedAt: at };
    expect(dealInRounds(1, [earlier, later])).toEqual({ א: 1, ב: 0 });
    expect(dealInRounds(1, [later, earlier])).toEqual({ א: 1, ב: 0 });
  });

  it("never gives a customer more than they ordered, however much stock is left", () => {
    // "קטן" asked for one; what is left after he is served goes to the other.
    const granted = dealInRounds(4, [
      { customerId: "קטן", quantity: 1, rank: [5], orderedAt: at },
      { customerId: "גדול", quantity: 5, rank: [1], orderedAt: at },
    ]);

    expect(granted).toEqual({ קטן: 1, גדול: 3 });
  });

  it("settles an equal rank and an equal time by the lower customer id, whatever order they arrive in", () => {
    const first = { customerId: "א", quantity: 1, rank: [3], orderedAt: at };
    const second = { customerId: "ב", quantity: 1, rank: [3], orderedAt: at };

    expect(dealInRounds(1, [first, second])).toEqual({ א: 1, ב: 0 });
    expect(dealInRounds(1, [second, first])).toEqual({ א: 1, ב: 0 });
  });

  it("puts an order whose time cannot be read after every order that has one, whatever order they arrive in", () => {
    const withTime = { customerId: "עם שעה", quantity: 1, rank: [3], orderedAt: at };
    const without = { customerId: "בלי שעה", quantity: 1, rank: [3], orderedAt: "" };

    expect(dealInRounds(1, [withTime, without])).toEqual({ "עם שעה": 1, "בלי שעה": 0 });
    expect(dealInRounds(1, [without, withTime])).toEqual({ "עם שעה": 1, "בלי שעה": 0 });
  });

  it("settles two orders whose time cannot be read by the lower customer id, whatever order they arrive in", () => {
    const first = { customerId: "א", quantity: 1, rank: [3], orderedAt: "" };
    const second = { customerId: "ב", quantity: 1, rank: [3], orderedAt: "" };

    expect(dealInRounds(1, [first, second])).toEqual({ א: 1, ב: 0 });
    expect(dealInRounds(1, [second, first])).toEqual({ א: 1, ב: 0 });
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

  it("counts a day on which a family was only arranged, not ordered, as a day it sold", () => {
    const { shares } = learnFrom(
      [
        day("2026-09-01", { recorded: { [PRODUCT]: { א: 1 } } }),
        day("2026-09-02", { orders: { [PRODUCT]: { ב: 1 } } }),
      ],
      FAMILY_OF,
    );

    expect(shares).toEqual({ א: { חציל: 0.5 }, ב: { חציל: 0.5 } });
  });

  it("treats a product that is in no family as a family of its own", () => {
    const { shares } = learnFrom(
      [
        day("2026-09-01", { orders: { מלון: { א: 1 } } }),
        day("2026-09-02", { orders: { אבטיח: { ב: 1 } } }),
      ],
      FAMILY_OF,
    );

    expect(shares).toEqual({ א: { מלון: 1 }, ב: { אבטיח: 1 } });
  });

  it("learns nothing from a line of zero pallets", () => {
    const learned = learnFrom(
      [
        day("2026-09-01", {
          supply: { [PRODUCT]: 1 },
          orders: { [PRODUCT]: { אסף: 2, פשה: 0 } },
          recorded: { [PRODUCT]: { אסף: 1, כבביה: 0 } },
        }),
        // Short too, and "arranged" with nothing but a record of zero pallets:
        // that is not arranged in the app, so nothing is learnt about who came first.
        day("2026-09-02", {
          supply: { [PRODUCT]: 1 },
          orders: { [PRODUCT]: { אסף: 2 } },
          recorded: { [PRODUCT]: { אסף: 0 } },
        }),
      ],
      FAMILY_OF,
    );

    expect(learned).toEqual({
      shares: { אסף: { חציל: 1 } },
      received: { אסף: { [PRODUCT]: 1 } },
      shortages: { אסף: { [PRODUCT]: [1] } },
    });
  });

  it("judges a shortage by pallets ordered, not by how many customers ordered", () => {
    const { shortages } = learnFrom(
      [
        day("2026-09-01", {
          supply: { [PRODUCT]: 1 },
          orders: { [PRODUCT]: { אסף: 3 } },
          recorded: { [PRODUCT]: { אסף: 1 } },
        }),
      ],
      FAMILY_OF,
    );

    expect(shortages).toEqual({ אסף: { [PRODUCT]: [1] } });
  });

  it("counts a customer who got only part of what they ordered as served", () => {
    const { shortages } = learnFrom(
      [
        day("2026-09-01", {
          supply: { [PRODUCT]: 2 },
          orders: { [PRODUCT]: { אסף: 2, פשה: 1 } },
          recorded: { [PRODUCT]: { אסף: 1 } },
        }),
      ],
      FAMILY_OF,
    );

    expect(shortages).toEqual({ אסף: { [PRODUCT]: [1] }, פשה: { [PRODUCT]: [-1] } });
  });

  it("judges each product against its own stock", () => {
    const { shortages } = learnFrom(
      [
        day("2026-09-01", {
          // Plenty of the first product, one pallet of the second.
          supply: { [PRODUCT]: 5, "חציל בלאדי": 1 },
          orders: { [PRODUCT]: { אסף: 1, פשה: 1 }, "חציל בלאדי": { אסף: 1, פשה: 1 } },
          recorded: { [PRODUCT]: { אסף: 1, פשה: 1 }, "חציל בלאדי": { אסף: 1 } },
        }),
      ],
      FAMILY_OF,
    );

    expect(shortages).toEqual({
      אסף: { "חציל בלאדי": [1] },
      פשה: { "חציל בלאדי": [-1] },
    });
  });

  it("takes a product with no stock figure for the day as having had none", () => {
    const { shortages } = learnFrom(
      [
        day("2026-09-01", {
          orders: { [PRODUCT]: { אסף: 1, פשה: 1 } },
          recorded: { [PRODUCT]: { אסף: 1 } },
        }),
      ],
      FAMILY_OF,
    );

    expect(shortages).toEqual({ אסף: { [PRODUCT]: [1] }, פשה: { [PRODUCT]: [-1] } });
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

  it("takes each customer's pallets from the lot with the most left at that moment", () => {
    const cells = assignLots(
      [
        { growerId: "A", available: 4 },
        { growerId: "B", available: 3 },
      ],
      [
        { customerId: "X", quantity: 2 },
        { customerId: "Y", quantity: 2 },
      ],
    );

    // X takes lot A down to 2, so for Y lot B now has more.
    expect(byCustomer(cells)).toEqual({ X: { A: 2 }, Y: { B: 2 } });
  });

  it("splits a customer over two lots by whichever has the most left each time", () => {
    // "ב" has a saved cell on lot B, so he goes first and takes 3 of lot A's 5.
    // "א" then takes lot B whole (3 left against 2) and the last pallet from lot A.
    const cells = assignLots(
      [
        { growerId: "A", available: 5 },
        { growerId: "B", available: 3, takenBy: new Set(["ב"]) },
      ],
      [
        { customerId: "א", quantity: 4 },
        { customerId: "ב", quantity: 3 },
      ],
    );

    expect(byCustomer(cells)).toEqual({ ב: { A: 3 }, א: { B: 3, A: 1 } });
  });

  it("places first the customer who can be given from the fewest pallets", () => {
    // "ב" has a saved cell on lot C, so only 4 pallets are open to him against
    // 5 for "א" — who would be first on the id. Lots A and B tie, and B is tried first.
    const cells = assignLots(
      [
        { growerId: "A", available: 2 },
        { growerId: "B", available: 2 },
        { growerId: "C", available: 1, takenBy: new Set(["ב"]) },
      ],
      [
        { customerId: "א", quantity: 2 },
        { customerId: "ב", quantity: 2 },
      ],
    );

    expect(byCustomer(cells)).toEqual({ ב: { B: 2 }, א: { A: 2 } });
  });

  it("counts an overdrawn lot as holding nothing, not as a debt against a customer's reach", () => {
    // "א" is shut out of the overdrawn lot C and "ב" is not. C counts as empty
    // for "ב" too, so both can be given from the same 4 pallets — and "א" is
    // first on the id.
    const cells = assignLots(
      [
        { growerId: "A", available: 2 },
        { growerId: "B", available: 2 },
        { growerId: "C", available: -3, takenBy: new Set(["א"]) },
      ],
      [
        { customerId: "א", quantity: 2 },
        { customerId: "ב", quantity: 2 },
      ],
    );

    expect(byCustomer(cells)).toEqual({ א: { B: 2 }, ב: { A: 2 } });
  });

  it("serves the larger share first whatever the customers' ids", () => {
    const cells = assignLots(
      [
        { growerId: "A", available: 3 },
        { growerId: "B", available: 3 },
      ],
      [
        { customerId: "א", quantity: 1 },
        { customerId: "ב", quantity: 3 },
      ],
    );

    expect(byCustomer(cells)).toEqual({ ב: { B: 3 }, א: { A: 1 } });
  });

  it("settles customers equal in every way by the lower id, whatever order they arrive in", () => {
    const cells = assignLots(
      [
        { growerId: "A", available: 2 },
        { growerId: "B", available: 2 },
      ],
      [
        { customerId: "ב", quantity: 2 },
        { customerId: "א", quantity: 2 },
      ],
    );

    expect(byCustomer(cells)).toEqual({ א: { B: 2 }, ב: { A: 2 } });
  });

  it("places whole pallets only, whatever fraction of a pallet a lot has over", () => {
    const total = (cells: ReturnType<typeof assignLots>) =>
      cells.reduce((sum, cell) => sum + cell.quantity, 0);

    // Two lots of one and a half: three pallets on paper, two whole ones.
    expect(
      total(
        assignLots(
          [
            { growerId: "A", available: 1.5 },
            { growerId: "B", available: 1.5 },
          ],
          [{ customerId: "א", quantity: 3 }],
        ),
      ),
    ).toBe(2);
    // More wanted than fits: a lot of one and a half holds one.
    expect(
      total(
        assignLots(
          [{ growerId: "A", available: 1.5 }],
          [
            { customerId: "א", quantity: 1 },
            { customerId: "ב", quantity: 1 },
          ],
        ),
      ),
    ).toBe(1);
  });
});

/** customer → grower → pallets, whatever order the cells come in. */
function byCustomer(
  cells: ReadonlyArray<{ growerId: string; customerId: string; quantity: number }>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const cell of cells) {
    const lots = (out[cell.customerId] ??= {});
    lots[cell.growerId] = (lots[cell.growerId] ?? 0) + cell.quantity;
  }
  return out;
}

/** No customer is given more than their share, no lot gives more than it has, and no cell lands where a customer's is already saved. */
function expectValidPlacement(
  lots: readonly LotToFill[],
  shares: ReadonlyArray<{ customerId: string; quantity: number }>,
  cells: ReadonlyArray<{ growerId: string; customerId: string; quantity: number }>,
) {
  const sum = (some: typeof cells) => some.reduce((total, cell) => total + cell.quantity, 0);
  for (const share of shares) {
    const own = cells.filter((cell) => cell.customerId === share.customerId);
    expect(sum(own)).toBeLessThanOrEqual(share.quantity);
  }
  for (const lot of lots) {
    const off = cells.filter((cell) => cell.growerId === lot.growerId);
    expect(sum(off)).toBeLessThanOrEqual(Math.max(0, Math.floor(lot.available)));
    for (const cell of off) expect(lot.takenBy?.has(cell.customerId) ?? false).toBe(false);
  }
}

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

// The second review's counter-examples: on a partly arranged day, every pallet
// that can be placed is placed — whatever order the customers come in.
describe("proposeArrangement — partly arranged days, placed in full", () => {
  function placed(lines: ReturnType<typeof propose>) {
    return lines.reduce((sum, line) => sum + line.quantity, 0);
  }
  const at = "2026-10-20T05:00:00Z";

  it("places all 8 when three lots and two saved cells leave only one way to do it", () => {
    // X can use A and B (saved on C); Y can use B and C (saved on A).
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "A", varietyId: PRODUCT, available: 2 },
        { growerId: "B", varietyId: PRODUCT, available: 3 },
        { growerId: "C", varietyId: PRODUCT, available: 3 },
      ],
      orders: [
        { customerId: "X", varietyId: PRODUCT, quantity: 3, orderedAt: at },
        { customerId: "Y", varietyId: PRODUCT, quantity: 7, orderedAt: at },
      ],
      arranged: [
        { growerId: "C", varietyId: PRODUCT, customerId: "X", quantity: 1 },
        { growerId: "A", varietyId: PRODUCT, customerId: "Y", quantity: 1 },
      ],
    };

    const lines = propose(today);
    expect(placed(lines)).toBe(8);
    expect(given(lines)).toEqual({ X: 2, Y: 6 });
  });

  it("deals no pallet to a customer that no lot open to them can hold", () => {
    // X and Y are both shut out of A; only B (2 free) is open to them. Z can
    // take from either. Everyone is owed 2 and ranks equal.
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "A", varietyId: PRODUCT, available: 2 },
        { growerId: "B", varietyId: PRODUCT, available: 2 },
      ],
      orders: ["X", "Y", "Z"].map((customerId) => ({
        customerId,
        varietyId: PRODUCT,
        quantity: 3,
        orderedAt: at,
      })),
      arranged: [
        { growerId: "A", varietyId: PRODUCT, customerId: "X", quantity: 1 },
        { growerId: "A", varietyId: PRODUCT, customerId: "Y", quantity: 1 },
      ],
    };

    const lines = propose(today);
    // All 4 free pallets go out, and every line lands on a lot open to its customer.
    expect(placed(lines)).toBe(4);
    for (const line of lines) {
      expect(line.growerId === "A" && (line.customerId === "X" || line.customerId === "Y")).toBe(
        false,
      );
    }
  });

  it("gives the same proposal whatever order the lots and orders arrive in", () => {
    const lots = [
      { growerId: "A", varietyId: PRODUCT, available: 2 },
      { growerId: "B", varietyId: PRODUCT, available: 2 },
      { growerId: "C", varietyId: PRODUCT, available: 1 },
    ];
    const orders = ["X", "Y", "Z", "W"].map((customerId) => ({
      customerId,
      varietyId: PRODUCT,
      quantity: 2,
      orderedAt: at,
    }));
    const arranged = [{ growerId: "B", varietyId: PRODUCT, customerId: "Z", quantity: 0 }];
    const baseline = propose({ date: "2026-10-20", lots, orders, arranged });

    for (const permutation of [
      { lots: [...lots].reverse(), orders: [...orders].reverse() },
      {
        lots: [lots[1]!, lots[2]!, lots[0]!],
        orders: [orders[2]!, orders[0]!, orders[3]!, orders[1]!],
      },
    ]) {
      const again = propose({ date: "2026-10-20", ...permutation, arranged });
      const key = (line: (typeof baseline)[number]) =>
        `${line.growerId}|${line.customerId}|${line.quantity}`;
      expect(again.map(key).sort()).toEqual(baseline.map(key).sort());
    }
  });
});

describe("assignLots — placed in full", () => {
  it("finds a placement for every pallet whenever one exists", () => {
    // Lots A=1, B=2, C=2. X (1) is shut out of C; Y (4) is shut out of A.
    const cells = assignLots(
      [
        { growerId: "A", available: 1, takenBy: new Set(["Y"]) },
        { growerId: "B", available: 2 },
        { growerId: "C", available: 2, takenBy: new Set(["X"]) },
      ],
      [
        { customerId: "X", quantity: 1 },
        { customerId: "Y", quantity: 4 },
      ],
    );

    expect(cells.reduce((sum, cell) => sum + cell.quantity, 0)).toBe(5);
    expect(cells.find((cell) => cell.customerId === "X")?.growerId).toBe("A");
  });

  it("moves a customer's pallet to another lot to make room for one more", () => {
    // Lot B (1) is shut to Q, so the pallet on it can only be P's; the rest
    // share lot A (5). The 6 pallets the lots hold can all go, though 7 are wanted.
    const lots = [
      { growerId: "A", available: 5 },
      { growerId: "B", available: 1, takenBy: new Set(["Q"]) },
    ];
    const shares = [
      { customerId: "P", quantity: 5 },
      { customerId: "Q", quantity: 2 },
    ];

    const cells = assignLots(lots, shares);

    expectValidPlacement(lots, shares, cells);
    expect(cells.reduce((sum, cell) => sum + cell.quantity, 0)).toBe(6);
  });

  it("places every pallet when making room for one takes moving a chain of others", () => {
    // R can only use lot C; Q, who is on it, can only go to lot B; P, who is
    // on that, can go to lot A. All five fit, but only if the later customers
    // push the earlier ones along.
    const lots = [
      { growerId: "A", available: 2, takenBy: new Set(["Q", "R"]) },
      { growerId: "B", available: 2, takenBy: new Set(["R"]) },
      { growerId: "C", available: 2, takenBy: new Set(["P"]) },
    ];
    const shares = [
      { customerId: "P", quantity: 2 },
      { customerId: "Q", quantity: 2 },
      { customerId: "R", quantity: 1 },
    ];

    const cells = assignLots(lots, shares);

    expectValidPlacement(lots, shares, cells);
    expect(cells.reduce((sum, cell) => sum + cell.quantity, 0)).toBe(5);
  });

  it("gives the pallets that fit to the lower id of two equal customers, whatever order they arrive in", () => {
    const lots = [{ growerId: "A", available: 1 }];
    const first = { customerId: "א", quantity: 3 };
    const second = { customerId: "ב", quantity: 3 };

    expect(byCustomer(assignLots(lots, [first, second]))).toEqual({ א: { A: 1 } });
    expect(byCustomer(assignLots(lots, [second, first]))).toEqual({ א: { A: 1 } });
  });
});

// Cases a mutation check of the engine showed the tests above left open: each
// is a rule the code states and no case yet depended on.
describe("proposeArrangement — saved cells and order lines, counted per customer and per product", () => {
  const at = "2026-10-20T05:00:00Z";
  const CABBAGE = "כרוב אלוף";

  it("lets a saved cell of one product change nothing about another product", () => {
    // "א" has a saved cell on the grower's eggplant lot. The grower's cabbage is
    // another lot, and the eggplant is no part of what "א" is owed in cabbage.
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "מגדל", varietyId: PRODUCT, available: 2 },
        { growerId: "מגדל", varietyId: CABBAGE, available: 2 },
      ],
      orders: [{ customerId: "א", varietyId: CABBAGE, quantity: 2, orderedAt: at }],
      arranged: [{ growerId: "מגדל", varietyId: PRODUCT, customerId: "א", quantity: 1 }],
    };

    expect(propose(today)).toEqual([
      { growerId: "מגדל", varietyId: CABBAGE, customerId: "א", quantity: 2 },
    ]);
  });

  it("adds up what a customer already has when it sits in cells on several lots", () => {
    // "א" ordered 3 and has a pallet in each of two lots that are now empty.
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "ריק א", varietyId: PRODUCT, available: 0 },
        { growerId: "ריק ב", varietyId: PRODUCT, available: 0 },
        { growerId: "מלא", varietyId: PRODUCT, available: 5 },
      ],
      orders: [{ customerId: "א", varietyId: PRODUCT, quantity: 3, orderedAt: at }],
      arranged: [
        { growerId: "ריק א", varietyId: PRODUCT, customerId: "א", quantity: 1 },
        { growerId: "ריק ב", varietyId: PRODUCT, customerId: "א", quantity: 1 },
      ],
    };

    expect(given(propose(today))).toEqual({ א: 1 });
  });

  it("adds up two order lines of one customer for one product", () => {
    const lines = propose({
      ...oneLotDay(5, []),
      orders: [
        { customerId: "א", varietyId: PRODUCT, quantity: 1, orderedAt: at },
        { customerId: "א", varietyId: PRODUCT, quantity: 2, orderedAt: at },
      ],
    });

    expect(given(lines)).toEqual({ א: 3 });
  });

  it.each([
    ["the later line first", ["2026-10-20T08:00:00Z", "2026-10-20T05:00:00Z"]],
    ["the earlier line first", ["2026-10-20T05:00:00Z", "2026-10-20T08:00:00Z"]],
  ])("ranks a customer with two order lines by the earlier of them, %s", (_case, times) => {
    // "יחיד" is first on the id and ordered at 06:00; "כפול" ordered at 05:00
    // and again at 08:00, and should count as having ordered at 05:00.
    const lines = propose({
      ...oneLotDay(1, []),
      orders: [
        ...times.map((orderedAt) => ({
          customerId: "כפול",
          varietyId: PRODUCT,
          quantity: 1,
          orderedAt,
        })),
        { customerId: "יחיד", varietyId: PRODUCT, quantity: 1, orderedAt: "2026-10-20T06:00:00Z" },
      ],
    });

    expect(given(lines)).toEqual({ כפול: 1 });
  });

  it("ignores an order line of zero pallets, its time included", () => {
    // The zero line was written at 04:00; the customer's real order, at 08:00,
    // comes after "יחיד"'s at 06:00.
    const lines = propose({
      ...oneLotDay(1, []),
      orders: [
        { customerId: "ביטל", varietyId: PRODUCT, quantity: 1, orderedAt: "2026-10-20T08:00:00Z" },
        { customerId: "ביטל", varietyId: PRODUCT, quantity: 0, orderedAt: "2026-10-20T04:00:00Z" },
        { customerId: "יחיד", varietyId: PRODUCT, quantity: 1, orderedAt: "2026-10-20T06:00:00Z" },
      ],
    });

    expect(given(lines)).toEqual({ יחיד: 1 });
  });

  it("deals whole pallets when an order or a saved cell is a fraction", () => {
    // 2.5 ordered: two whole pallets.
    expect(given(propose(oneLotDay(10, [["א", 2.5]])))).toEqual({ א: 2 });

    // 3.5 ordered with half a pallet already saved: three more.
    const today: DayToPropose = {
      ...oneLotDay(10, [["א", 3.5]]),
      lots: [
        { growerId: "ריק", varietyId: PRODUCT, available: 0 },
        { growerId: "מגדל", varietyId: PRODUCT, available: 10 },
      ],
      arranged: [{ growerId: "ריק", varietyId: PRODUCT, customerId: "א", quantity: 0.5 }],
    };
    expect(given(propose(today))).toEqual({ א: 3 });
  });
});

describe("proposeArrangement — the stock, the ranking, and a customer shut out of a lot", () => {
  const at = "2026-10-20T05:00:00Z";

  it("takes nothing off the other lots for a lot that is overdrawn", () => {
    const lines = propose({
      date: "2026-10-20",
      lots: [
        { growerId: "מלא", varietyId: PRODUCT, available: 3 },
        { growerId: "חסר", varietyId: PRODUCT, available: -2 },
      ],
      orders: [{ customerId: "א", varietyId: PRODUCT, quantity: 3, orderedAt: at }],
      arranged: [],
    });

    expect(lines).toEqual([{ growerId: "מלא", varietyId: PRODUCT, customerId: "א", quantity: 3 }]);
  });

  it("deals only the whole pallets the lots hold, to the best ranked, when each has half a pallet over", () => {
    // 1.5 + 1.5 is three pallets on paper and two whole ones.
    const lines = propose(
      {
        date: "2026-10-20",
        lots: [
          { growerId: "A", varietyId: PRODUCT, available: 1.5 },
          { growerId: "B", varietyId: PRODUCT, available: 1.5 },
        ],
        orders: ["א", "ב", "ג"].map((customerId) => ({
          customerId,
          varietyId: PRODUCT,
          quantity: 1,
          orderedAt: at,
        })),
        arranged: [],
      },
      { scores: { א: 2.0, ב: 3.0, ג: 4.0 } },
    );

    expect(given(lines)).toEqual({ ב: 1, ג: 1 });
  });

  it("does not rank a customer with no score above one scored 1", () => {
    // The mirror of the case where the unscored customer ordered first: here
    // the scored one did, and the tie goes to him.
    const lines = propose(
      {
        ...oneLotDay(1, []),
        orders: [
          {
            customerId: "מדורג 1",
            varietyId: PRODUCT,
            quantity: 1,
            orderedAt: "2026-10-20T04:00:00Z",
          },
          {
            customerId: "לא מדורג",
            varietyId: PRODUCT,
            quantity: 1,
            orderedAt: "2026-10-20T06:00:00Z",
          },
        ],
      },
      { scores: { "מדורג 1": 1.0 } },
    );

    expect(given(lines)).toEqual({ "מדורג 1": 1 });
  });

  it("takes a product that is in no family for a family of its own when ranking", () => {
    const MELON = "מלון";
    // "קבוע" orders melon on 2 of its 3 days: product score 5, priority 4.2,
    // above "גבוה"'s 0.5 × 4.0 + 0.5 × 1 = 2.5.
    const history = ["2026-09-01", "2026-09-02", "2026-09-03"].map((date, index) =>
      day(date, { orders: { [MELON]: index < 2 ? { קבוע: 1 } : { אחר: 1 } } }),
    );
    const lines = propose(
      {
        date: "2026-10-20",
        lots: [{ growerId: "מגדל", varietyId: MELON, available: 1 }],
        orders: ["גבוה", "קבוע"].map((customerId) => ({
          customerId,
          varietyId: MELON,
          quantity: 1,
          orderedAt: at,
        })),
        arranged: [],
      },
      { history, scores: { גבוה: 4.0, קבוע: 3.4 } },
    );

    expect(lines).toEqual([
      { growerId: "מגדל", varietyId: MELON, customerId: "קבוע", quantity: 1 },
    ]);
  });

  it("still serves the best ranked first when a saved cell shuts one customer out of a lot", () => {
    // Two lots of one pallet. X has a saved cell on lot B, so only lot A is
    // open to him; Y and Z can take either. Three want a pallet and two can
    // have one: the two best ranked, not whoever happens to fit.
    const today: DayToPropose = {
      date: "2026-10-20",
      lots: [
        { growerId: "A", varietyId: PRODUCT, available: 1 },
        { growerId: "B", varietyId: PRODUCT, available: 1 },
      ],
      orders: [
        { customerId: "X", varietyId: PRODUCT, quantity: 2, orderedAt: at },
        { customerId: "Y", varietyId: PRODUCT, quantity: 1, orderedAt: at },
        { customerId: "Z", varietyId: PRODUCT, quantity: 1, orderedAt: at },
      ],
      arranged: [{ growerId: "B", varietyId: PRODUCT, customerId: "X", quantity: 1 }],
    };

    expect(given(propose(today, { scores: { X: 1.0, Y: 4.0, Z: 3.0 } }))).toEqual({ Y: 1, Z: 1 });
  });
});
