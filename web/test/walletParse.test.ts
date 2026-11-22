import { describe, it, expect } from "vitest";
import { parseSms, parseWallet, parseWhen, splitMessages } from "../src/walletParse";

describe("mobile-money SMS", () => {
  it("M-Pesa, English", () => {
    const x = parseSms("SK41ABCD12 Confirmed. On 22/11/26 at 2:15 PM Tsh205,000.00 received from 255754123456 - JOHN DOE. New M-Pesa balance is Tsh1,250,000.00.")!;
    expect(x.txn_id).toBe("SK41ABCD12");
    expect(x.amount).toBe(205000);
    expect(x.sender_name).toBe("John Doe");
    expect(x.phone_tail).toBe("3456");
    expect(x.at).toBe("2026-11-22T11:15:00.000Z");
    expect(x.provider).toBe("mpesa");
  });
  it("M-Pesa, Swahili", () => {
    const x = parseSms("SK41ABCD13 Imethibitishwa. Tarehe 21/11/2026 saa 9:05 AM umepokea Tsh 170,000.00 kutoka 255765987654 - ASHA JUMA MWAKA. Salio jipya la M-Pesa ni Tsh 300,000.00")!;
    expect(x.txn_id).toBe("SK41ABCD13");
    expect(x.amount).toBe(170000);
    expect(x.sender_name).toBe("Asha Juma Mwaka");
    expect(x.phone_tail).toBe("7654");
  });
  it("Mixx by Yas with a labelled code and the name before the number", () => {
    const x = parseSms("Mixx by Yas: Umepokea TSh 205,000 kutoka JOHN PETER - 255713111222. Salio jipya ni TSh 400,000. Muamala: 23456789012. 22/11/2026 14:15")!;
    expect(x.txn_id).toBe("23456789012");
    expect(x.sender_name).toBe("John Peter");
    expect(x.phone_tail).toBe("1222");
    expect(x.provider).toBe("mixx");
  });
  it("ignores money sent out", () => {
    expect(parseSms("SK41ABCD14 Confirmed. Tsh50,000.00 sent to 255754000000 - SHOP on 22/11/26 at 3:00 PM.")).toBeNull();
    expect(parseSms("SK41ABCD15 Imethibitishwa. Umetuma Tsh 50,000 kwa JOHN.")).toBeNull();
  });
  it("splits several pasted messages and drops duplicates", () => {
    const text = `SK41ABCD12 Confirmed. On 22/11/26 at 2:15 PM Tsh205,000.00 received from 255754123456 - JOHN DOE.
SK41ABCD16 Confirmed. On 22/11/26 at 4:00 PM Tsh100,000.00 received from 255754999888 - MARY ANN.

SK41ABCD12 Confirmed. On 22/11/26 at 2:15 PM Tsh205,000.00 received from 255754123456 - JOHN DOE.`;
    expect(splitMessages(text).length).toBe(3);
    expect(parseWallet(text).map((x) => x.txn_id)).toEqual(["SK41ABCD12", "SK41ABCD16"]);
  });
  it("no date in the message: today, flagged as a guess", () => {
    const x = parseSms("Umepokea Tsh 20,000 kutoka 0754123456 JOHN. Kumbukumbu: QWE123RTY9", "+03:00", new Date("2026-11-22T10:00:00Z"))!;
    expect(x.date_guessed).toBe(true);
    expect(x.txn_id).toBe("QWE123RTY9");
  });
});

describe("statement CSV", () => {
  it("M-Pesa business statement columns", () => {
    const csv = `Receipt No.,Completion Time,Initiation Time,Details,Transaction Status,Paid In,Withdrawn,Balance
SK41ABCD12,2026-11-22 14:15:03,2026-11-22 14:15:00,Pay Merchant from 255754123456 - JOHN DOE,Completed,"205,000.00",,"1,250,000.00"
SK41ABCD17,2026-11-22 15:00:00,2026-11-22 15:00:00,Merchant Payment to SUPPLIER,Completed,,"50,000.00","1,200,000.00"
SK41ABCD18,2026-11-22 16:00:00,2026-11-22 16:00:00,Pay Merchant from 255754000111 - ALI,Failed,"10,000.00",,""`;
    const x = parseWallet(csv);
    expect(x.length).toBe(1);
    expect(x[0]).toMatchObject({ txn_id: "SK41ABCD12", amount: 205000, sender_name: "John Doe", phone_tail: "3456", source: "csv" });
    expect(x[0].at).toBe("2026-11-22T11:15:03.000Z");
  });
  it("dates", () => {
    expect(parseWhen("22/11/2026 2:15 PM")).toBe("2026-11-22T11:15:00.000Z");
    expect(parseWhen("nothing")).toBeNull();
  });
});
