import assert from "node:assert/strict";
import test from "node:test";

import { inferTcin, selectReplayableRequests } from "../src/helper/network-flow.js";

type RecordedRequests = Parameters<typeof selectReplayableRequests>[0];

function request(overrides: Partial<RecordedRequests[number]>): RecordedRequests[number] {
  return {
    id: 1,
    offsetMs: 0,
    method: "POST",
    url: "https://carts.target.com/web_checkouts/v1/cart_items",
    resourceType: "fetch",
    headers: {},
    ...overrides
  };
}

test("selectReplayableRequests keeps cart mutations and drops telemetry", () => {
  const selected = selectReplayableRequests([
    request({
      url: "https://carts.target.com/web_checkouts/v1/cart_items",
      postData: '{"cart_item":{"tcin":"12345678","quantity":1}}'
    }),
    request({
      url: "https://api.target.com/telemetry_data/v1/traces",
      postData: '{"name":"cart"}'
    }),
    request({
      method: "GET",
      url: "https://carts.target.com/web_checkouts/v1/cart"
    }),
    request({
      url: "https://carts.target.com/web_checkouts/v1/place_order",
      postData: '{"placeOrder":true}'
    })
  ]);

  assert.equal(selected.length, 1);
  assert.match(selected[0].url, /cart_items/);
});

test("inferTcin reads Target product URLs", () => {
  assert.equal(
    inferTcin("https://www.target.com/p/example-product/-/A-95082118"),
    "95082118"
  );
});
