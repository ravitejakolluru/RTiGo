import test from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatINR, languages, transactionTypeLabel, translate } from "./i18n.js";

test("all supported languages format money as Indian rupees with Indian digit grouping", () => {
  assert.deepEqual(languages.map(({ code }) => code), ["en", "hi", "te", "kn", "ta"]);
  for (const { code } of languages) {
    assert.equal(formatINR(123456.78, code), "₹1,23,456.78");
  }
});

test("all displayed dates use dd/mm/yy format consistently", () => {
  assert.equal(formatDate("2026-10-20"), "20/10/26");
  assert.equal(formatDate("2026-01-05T00:00:00.000Z"), "05/01/26");
  assert.equal(formatDate(new Date("2026-12-31T23:00:00.000Z")), "31/12/26");
  assert.equal(formatDate("invalid"), "");
});

test("dashboard navigation labels are translated in every supported language", () => {
  for (const { code } of languages.filter(({ code }) => code !== "en")) {
    assert.notEqual(translate("Overview", code), "Overview");
    assert.notEqual(translate("Account settings", code), "Account settings");
  }
});

test("income form field labels are translated in every supported language", () => {
  for (const { code } of languages) {
    for (const key of [
      "Application app",
      "e.g. PhonePe, Paytm, Google Pay",
      "Received From (Self/person)",
      "Self or person name",
    ]) {
      const translated = translate(key, code);
      assert.ok(translated);
      if (code !== "en") assert.notEqual(translated, key);
    }
  }
});

test("public report labels and external-sharing guidance are translated", () => {
  for (const { code } of languages) {
    for (const key of [
      "Amount received",
      "Amount spent",
      "Available balance now",
      "Financial summary",
      "Monthly email reports",
      "Sent to your registered email on the 1st of each month for the previous full month, with next month’s unpaid bills and a fresh PDF password in the same email.",
      "To share outside this computer, deploy the site and set APP_ORIGIN to its public HTTPS address.",
    ]) {
      const translated = translate(key, code);
      assert.ok(translated);
      if (code !== "en") assert.notEqual(translated, key);
    }
  }
});

test("authentication timeout and email-delivery errors have translated messages", () => {
  for (const { code } of languages) {
    for (const key of [
      "The request timed out. Please check your connection and try again.",
      "Email delivery is temporarily unavailable. Please try again later.",
      "If this account exists, its reset email could not be delivered right now. Please try again later.",
    ]) {
      const translated = translate(key, code);
      assert.ok(translated);
      if (code !== "en") assert.notEqual(translated, key);
    }
  }
});

test("transaction types use credit, debit, and withdraw labels in every language", () => {
  assert.equal(transactionTypeLabel("income"), "Credit");
  assert.equal(transactionTypeLabel("expense"), "Debit");
  assert.equal(transactionTypeLabel("withdrawal"), "Withdraw");
  for (const { code } of languages) {
    for (const kind of ["income", "expense", "withdrawal"]) {
      const label = transactionTypeLabel(kind);
      if (code !== "en") assert.notEqual(translate(label, code), label);
    }
  }
});
