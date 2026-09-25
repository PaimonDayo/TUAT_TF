import { expect, it, vi } from "vitest";
import { createCoalescedFetch } from "./coalesced-fetch";

it("post-save reads do not join a snapshot started during the write", async () => {
  let finishWrite!: (value: Response) => void;
  let finishRead!: (value: Response) => void;
  const upstream = vi.fn<typeof fetch>((_input, init) => init?.method === "POST"
    ? new Promise(resolve => { finishWrite = resolve; })
    : new Promise(resolve => { finishRead = resolve; }));
  const fetcher = createCoalescedFetch(upstream);
  const write = fetcher("https://example.test/posts", { method: "POST" });
  const during = fetcher("https://example.test/posts");
  await Promise.resolve();
  const firstRead = finishRead;
  finishWrite(new Response("saved")); await write;
  const after = fetcher("https://example.test/posts");
  await Promise.resolve();
  expect(upstream).toHaveBeenCalledTimes(3);
  firstRead(new Response("old")); finishRead(new Response("new"));
  expect(await (await during).text()).toBe("old");
  expect(await (await after).text()).toBe("new");
});

it("shares simultaneous reads with independently consumable bodies, but does not cache", async () => {
  const upstream = vi.fn(async () => new Response("data"));
  const fetcher = createCoalescedFetch(upstream);
  const responses = await Promise.all(Array.from({ length: 10 }, () => fetcher("https://example.test/rest/v1/posts")));
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(await Promise.all(responses.map(r => r.text()))).toEqual(Array(10).fill("data"));
  await fetcher("https://example.test/rest/v1/posts");
  expect(upstream).toHaveBeenCalledTimes(2);
});

it("isolates users, query parameters, count headers and caller cancellation", async () => {
  const upstream = vi.fn(async () => new Response("data"));
  const fetcher = createCoalescedFetch(upstream);
  await Promise.all([
    fetcher("https://example.test/posts", { headers: { authorization: "Bearer a" } }),
    fetcher("https://example.test/posts", { headers: { authorization: "Bearer b" } }),
    fetcher("https://example.test/posts?q=1"),
    fetcher("https://example.test/posts", { headers: { prefer: "count=exact" } }),
    fetcher("https://example.test/posts", { signal: new AbortController().signal }),
    fetcher("https://example.test/posts", { signal: new AbortController().signal }),
  ]);
  expect(upstream).toHaveBeenCalledTimes(6);
});

it("never shares writes or reads across a write", async () => {
  const upstream = vi.fn(async () => new Response("data"));
  const fetcher = createCoalescedFetch(upstream);
  await Promise.all([
    fetcher("https://example.test/posts"),
    fetcher("https://example.test/posts", { method: "POST", body: "a" }),
    fetcher("https://example.test/posts", { method: "POST", body: "a" }),
    fetcher("https://example.test/posts"),
  ]);
  expect(upstream).toHaveBeenCalledTimes(4);
});

it("retries after a shared failure", async () => {
  const upstream = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(new Response("ok"));
  const fetcher = createCoalescedFetch(upstream);
  const results = await Promise.allSettled([fetcher("https://example.test"), fetcher("https://example.test")]);
  expect(results.every(r => r.status === "rejected")).toBe(true);
  expect(await (await fetcher("https://example.test")).text()).toBe("ok");
  expect(upstream).toHaveBeenCalledTimes(2);
});
