declare module "web-push" {
  type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
  type VapidDetails = { subject: string; publicKey: string; privateKey: string };
  const webPush: {
    generateVAPIDKeys(): { publicKey: string; privateKey: string };
    getVapidHeaders(audience: string, subject: string, publicKey: string, privateKey: string,
      contentEncoding: "aes128gcm"): Record<string, string>;
    generateRequestDetails(subscription: Subscription, payload: string, options: {
      vapidDetails: VapidDetails; TTL: number; contentEncoding: "aes128gcm";
    }): { endpoint: string; method: string; headers: Record<string, string | number>; body: Buffer };
  };
  export default webPush;
}
