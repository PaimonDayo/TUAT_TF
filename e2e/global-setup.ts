import { setupE2EUsers } from "./support/users";

export default async function globalSetup() {
  await setupE2EUsers();
}