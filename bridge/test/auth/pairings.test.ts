import { describe, expect, test } from "bun:test";
import {
  approveByUserCode,
  closePairing,
  EMPTY_PAIRING_BOOK,
  openPairing,
  PAIRING_TTL_MS,
  pendingPairings,
  pollPairing,
} from "../../src/auth/pairings";
import { hashSecret } from "../../src/auth/tokens";

const T0 = 1_000_000;
const deviceA = hashSecret("device-a");
const deviceB = hashSecret("device-b");

describe("pairing book", () => {
  test("a fresh challenge polls as pending until approved by its user code", () => {
    const book = openPairing(EMPTY_PAIRING_BOOK, deviceA, "ABCD-EFGH", "pending", T0);
    expect(pollPairing(book, deviceA, T0 + 1).kind).toBe("pending");

    const approved = approveByUserCode(book, "ABCD-EFGH", T0 + 2);
    if (approved.kind !== "approved") throw new Error("expected approval");
    expect(pollPairing(approved.book, deviceA, T0 + 3).kind).toBe("approved");
  });

  test("a pre-approved pairing polls as approved immediately", () => {
    const book = openPairing(EMPTY_PAIRING_BOOK, deviceA, "ABCD-EFGH", "approved", T0);
    expect(pollPairing(book, deviceA, T0).kind).toBe("approved");
  });

  test("pairings expire after the TTL", () => {
    const book = openPairing(EMPTY_PAIRING_BOOK, deviceA, "ABCD-EFGH", "approved", T0);
    expect(pollPairing(book, deviceA, T0 + PAIRING_TTL_MS).kind).toBe("unknown");
    expect(approveByUserCode(book, "ABCD-EFGH", T0 + PAIRING_TTL_MS).kind).toBe("unknown");
  });

  test("approving an unknown code changes nothing", () => {
    const book = openPairing(EMPTY_PAIRING_BOOK, deviceA, "ABCD-EFGH", "pending", T0);
    expect(approveByUserCode(book, "ZZZZ-ZZZZ", T0).kind).toBe("unknown");
    expect(pollPairing(book, deviceA, T0).kind).toBe("pending");
  });

  test("a closed pairing cannot be exchanged again", () => {
    const book = openPairing(EMPTY_PAIRING_BOOK, deviceA, "ABCD-EFGH", "approved", T0);
    expect(pollPairing(closePairing(book, deviceA), deviceA, T0).kind).toBe("unknown");
  });

  test("only pending, unexpired pairings are listed for approval", () => {
    const withPending = openPairing(EMPTY_PAIRING_BOOK, deviceA, "ABCD-EFGH", "pending", T0);
    const book = openPairing(withPending, deviceB, "JKLM-NPQR", "approved", T0);
    expect(pendingPairings(book, T0).map((pairing) => pairing.userCode)).toEqual(["ABCD-EFGH"]);
    expect(pendingPairings(book, T0 + PAIRING_TTL_MS)).toEqual([]);
  });
});
