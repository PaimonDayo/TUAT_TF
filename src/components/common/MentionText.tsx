import Link from "next/link";
import { Linkify } from "@/components/common/Linkify";
import type { TweetMention } from "@/types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function MentionText({ text, mentions }: { text: string; mentions?: TweetMention[] }) {
  const valid = (mentions ?? []).filter((mention) => mention.display_name);
  if (!valid.length) return <Linkify text={text} />;
  const byLabel = new Map(valid.map((mention) => [`@${mention.display_name}`, mention]));
  const pattern = new RegExp(`(${[...byLabel.keys()].map(escapeRegExp).join("|")})`, "g");
  return (
    <>
      {text.split(pattern).map((part, index) => {
        const mention = byLabel.get(part);
        return mention ? (
          <Link key={`${part}-${index}`} href={`/members/${mention.profile_id}`} prefetch={false} className="font-semibold text-accent" onClick={(event) => event.stopPropagation()}>
            {part}
          </Link>
        ) : <Linkify key={index} text={part} />;
      })}
    </>
  );
}
