import { updateArrangementRecordInputSchema } from "@ori/domain/arrangement";
import { saveCustomerInputSchema, saveProductInputSchema } from "@ori/domain/reference-data";
import { describe, expect, it } from "vitest";

import { errorMessage } from "./error-message";

// The errors here are REAL ones, thrown by the same schemas the save buttons
// parse their forms with — so a change in how zod shapes its issues shows up
// here rather than as English JSON in a toast.
function thrownBy(parse: () => unknown): unknown {
  try {
    parse();
  } catch (error) {
    return error;
  }
  throw new Error("expected the schema to reject this input");
}

const validProduct = {
  id: null,
  familyId: "11111111-1111-4111-8111-111111111111",
  name: "זן",
  sizes: null,
  packType: null,
  price: null,
  priceRangeFrom: null,
  priceRangeTo: null,
  priceType: null,
  noOverbooking: 0,
  highlightPriceFluctuations: false,
  isSeasonalAvailable: true,
  numberOfOrdersPerCustomer: null,
  expectedVersion: null,
  customerPalletCaps: [],
};

describe("errorMessage", () => {
  it("says what to fix for a blank required name, instead of the ZodError's JSON", () => {
    const error = thrownBy(() =>
      saveCustomerInputSchema.parse({
        id: null,
        name: "",
        status: "active",
        canSeeProductPrices: false,
        whatsappGroupId: null,
      }),
    );
    expect(errorMessage(error)).toBe("יש למלא את כל שדות החובה.");
  });

  it("explains number problems in words", () => {
    expect(
      errorMessage(thrownBy(() => saveProductInputSchema.parse({ ...validProduct, noOverbooking: 1.5 }))),
    ).toBe("יש להזין מספר שלם.");
    expect(
      errorMessage(
        thrownBy(() => saveProductInputSchema.parse({ ...validProduct, numberOfOrdersPerCustomer: 0 })),
      ),
    ).toBe("המספר שהוזן קטן מדי.");
    expect(
      errorMessage(thrownBy(() => saveProductInputSchema.parse({ ...validProduct, price: Number("x") }))),
    ).toBe("יש להזין מספר.");
    expect(
      errorMessage(
        thrownBy(() =>
          updateArrangementRecordInputSchema.parse({
            id: "11111111-1111-4111-8111-111111111111",
            quantityPallets: 0,
          }),
        ),
      ),
    ).toBe("המספר שהוזן קטן מדי.");
  });

  it("asks for a choice when an id is missing", () => {
    expect(errorMessage(thrownBy(() => saveProductInputSchema.parse({ ...validProduct, familyId: "" })))).toBe(
      "יש לבחור ערך מהרשימה.",
    );
  });

  it("passes other errors' own messages through, and never returns an empty string", () => {
    expect(errorMessage({ code: "P0009", message: "OVER_ALLOCATION: too many" })).toBe(
      "OVER_ALLOCATION: too many",
    );
    expect(errorMessage(new Error("network down"))).toBe("network down");
    expect(errorMessage({ message: "" })).toBe("שגיאה לא ידועה");
    expect(errorMessage(null)).toBe("שגיאה לא ידועה");
    expect(errorMessage("text")).toBe("שגיאה לא ידועה");
  });
});
