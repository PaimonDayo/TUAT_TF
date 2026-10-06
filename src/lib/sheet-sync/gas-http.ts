// ContentService returns a receipt through a separate, read-only URL.
// Repeat only receipt reads: a rejected or lost POST must never be replayed here.
export async function fetchGasResponse(url: string, payload: string, signal?: AbortSignal): Promise<Response> {
  let response = await fetch(url, {
    method: "POST", signal, cache: "no-store", redirect: "manual",
    headers: { "Content-Type": "application/json;charset=utf-8" }, body: payload,
  });
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;

  const location = response.headers.get("location");
  let receiptUrl: URL;
  try { receiptUrl = new URL(location ?? "", url); } catch { throw new Error("スプレッドシートの応答先を確認できませんでした。送信結果を確認するまで再送を保留してください。"); }
  if (!location || receiptUrl.protocol !== "https:" || receiptUrl.hostname !== "script.googleusercontent.com"
    || receiptUrl.username || receiptUrl.password) {
    throw new Error("スプレッドシートの応答先を確認できませんでした。送信結果を確認するまで再送を保留してください。");
  }
  await response.body?.cancel();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(receiptUrl.toString(), { method: "GET", signal, cache: "no-store", redirect: "error" });
      if (![404, 502, 503, 504].includes(response.status) || attempt === 2) {
        // Headers can arrive before the connection fails while reading the receipt.
        const text = await response.text();
        return new Response([204, 205, 304].includes(response.status) ? null : text, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
      }
      await response.body?.cancel();
    } catch (error) {
      if (signal?.aborted || attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return response;
}
