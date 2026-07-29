import { cleanupE2EUsers } from "./support/users";

export default async function globalTeardown() {
  await cleanupE2EUsers();
}