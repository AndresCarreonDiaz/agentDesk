// The pure parts of the playbook: lesson wording in both styles and the strict "same mistake again" check.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Change } from "./core.js";
import { exampleInLesson, renderLesson, repeatedMistake } from "./playbook.js";

const missing: Change = { kind: "missing_field", method: "POST", path: "/api/cart/items", field: "sku", success: "string" };
const retyped: Change = { kind: "type", method: "POST", path: "/api/cart/items", field: "qty", failed: "string", success: "number" };
const example = { sku: "MUG-BLUE", qty: 1 };

test("field style is today's lesson", () => {
  assert.equal(renderLesson("field", [missing], () => example), "POST /api/cart/items: include sku (string)");
});

test("example style shows one body per route, and keeps field wording where it has no example", () => {
  assert.equal(
    renderLesson("example", [missing, retyped], () => example),
    'POST /api/cart/items: send a body like {"sku":"MUG-BLUE","qty":1}',
  );
  assert.equal(renderLesson("example", [missing], () => null), "POST /api/cart/items: include sku (string)");
});

test("the example body reads back from the lesson text", () => {
  const text = `for add_to_cart: ${renderLesson("example", [missing], () => ({ sku: "a; b}", qty: 1 }))}`;
  assert.deepEqual(exampleInLesson(text, "POST", "/api/cart/items"), { sku: "a; b}", qty: 1 });
  assert.equal(exampleInLesson("POST /api/cart/items: include sku (string)", "POST", "/api/cart/items"), null);
});

test("a repeated mistake needs the same field on the same route", () => {
  const lesson = "for add_to_cart: POST /api/cart/items: include sku (string)";
  assert.equal(repeatedMistake(lesson, "POST", "/api/cart/items", { qty: "number" }), "sku");
  assert.equal(repeatedMistake(lesson, "POST", "/api/cart/items", { sku: "string", qty: "number" }), null);
  assert.equal(repeatedMistake(lesson, "POST", "/api/cart", { qty: "number" }), null);
  const typed = "POST /api/cart/items: send qty as number, not string";
  assert.equal(repeatedMistake(typed, "POST", "/api/cart/items", { qty: "string" }), "qty");
  assert.equal(repeatedMistake(typed, "POST", "/api/cart/items", { qty: "number" }), null);
});
