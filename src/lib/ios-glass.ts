/** Match iPhone/iPad Safari and installed web apps, including iPad desktop UA. */
export function isIOSGlassDevice(device: { userAgent: string; platform: string; maxTouchPoints: number }) {
  return /iPad|iPhone|iPod/.test(device.userAgent) ||
    (device.platform === "MacIntel" && device.maxTouchPoints > 1);
}
