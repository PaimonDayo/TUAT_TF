import { ImageUploadError } from "./image-storage";

// The PC runs one Next process. Refuse excess work before buffering or decoding;
// no unbounded request queue and no background retry after a refused upload.
export function createImageUploadAdmission() {
  let active = 0;
  const users = new Set<string>();
  const resources = new Set<string>();
  const windows = new Map<string, { started: number; count: number }>();
  return (userId: string, resource?: string, now = Date.now()): (() => void) => {
    for (const [id, window] of windows) if (now - window.started >= 60_000) windows.delete(id);
    const window = windows.get(userId);
    if (active >= 2 || users.has(userId) || (resource && resources.has(resource)) || (window?.count ?? 0) >= 20 ||
        (!window && windows.size >= 2048)) {
      throw new ImageUploadError(429, "画像の処理が混み合っています。少し待ってからお試しください");
    }
    windows.set(userId, { started: window?.started ?? now, count: (window?.count ?? 0) + 1 });
    active++;
    users.add(userId);
    if (resource) resources.add(resource);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      users.delete(userId);
      if (resource) resources.delete(resource);
    };
  };
}

export const admitImageUpload = createImageUploadAdmission();
