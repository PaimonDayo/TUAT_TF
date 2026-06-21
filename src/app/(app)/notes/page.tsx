import { Header } from "@/components/layout/Header";
import { NotesView } from "@/components/features/NotesView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getNotesData } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const [{ mine }, profile, data] = await Promise.all([
    searchParams,
    getCurrentProfile(),
    getNotesData(),
  ]);
  const permissions = permissionsOf(profile.roles);

  return (
    <>
      <Header title="ノート" large />
      <NotesView
        currentUser={{
          id: profile.id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          blocks: profile.blocks,
          grade: profile.grade,
        }}
        notes={data.notes}
        isAdmin={permissions.manageMembers}
        mine={mine === "1"}
      />
    </>
  );
}
